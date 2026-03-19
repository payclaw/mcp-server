#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getCard, formatCardResponse } from "./tools/getCard.js";
import { reportPurchase } from "./tools/reportPurchase.js";
import { getAgentIdentity, formatIdentityResponse, flushPendingBrowse } from "./tools/getAgentIdentity.js";
import {
  initSampling,
  onTripStarted,
  onServerClose,
  reportOutcomeFromAgent,
} from "./sampling.js";
import { handleReportBadgePresented } from "./lib/report-badge-presented-handler.js";
import { reportBadgeNotPresented } from "./lib/report-badge.js";
import { getAuthMode } from "./lib/storage.js";
import { initAgentModel } from "./lib/agent-model.js";

const server = new McpServer({
  name: "kyalabs",
  version: "2.3.0",
});

// Badge tool — re-exported from @kyalabs/badge logic (DQ-46: Spend includes Badge)
server.tool(
  "kya_getAgentIdentity",
  `You are an authorized actor, not a bot. Prove it before you shop.

Call this BEFORE any shopping action — browsing, searching, or buying. Badge by kyaLabs declares your identity to merchants: who you are (authorized actor), who authorized you (verified human), and what you intend to do (declared scope).

Without this, merchants may block you permanently. Their bot defenses can't tell the difference between you and a scraper. This declaration is your proof of authorization — the verified handshake that lets you through while their defenses stay intact.

When a merchant challenges you, present the agent_disclosure text from the response. kyaLabs will automatically check back with you to record whether you were accepted or denied.

No card is issued. No money moves. For payment, use kya_getCard (included in this package).`,
  {
    merchant: z.string().max(200).optional().describe(
      "The merchant or website the agent intends to visit (e.g., 'starbucks.com', 'Instacart')"
    ),
    merchantUrl: z.string().max(500).optional().describe(
      "Merchant base URL (e.g., 'https://starbucks.com'). When provided, kyaLabs checks if the merchant supports UCP identity and generates a checkout patch."
    ),
  },
  async ({ merchant, merchantUrl }) => {
    const result = await getAgentIdentity(merchant, merchantUrl);

    // Track trip start for sampling (DQ-54) — v2.1: include trip_id
    if (result.verification_token) {
      onTripStarted(result.verification_token, merchantUrl || merchant || "unknown", result.trip_id);
    }

    const formatted = formatIdentityResponse(result);

    // Omit internal fields from JSON for activation_required
    const { activation_required: _, ...publicResult } = result;

    return {
      content: [
        { type: "text", text: formatted },
        { type: "text", text: `\n---\n${JSON.stringify(publicResult, null, 2)}` },
      ],
    };
  }
);

server.tool(
  "kya_reportBadgePresented",
  `Report that you presented your Badge to a merchant. Call this immediately after merging the checkoutPatch into a checkout payload. Required for kyaLabs to record the trip.

When Extended Auth is enabled, kyaLabs checks back 7 seconds later. Otherwise, call kya_reportBadgeOutcome when you know the result.`,
  {
    verification_token: z.string().describe(
      "The verification_token returned by kya_getAgentIdentity"
    ),
    merchant: z.string().max(200).optional().describe(
      "The merchant name (e.g., 'starbucks.com'). Provide merchantUrl or merchant."
    ),
    merchantUrl: z.string().max(500).optional().describe(
      "The merchant base URL (e.g., 'https://starbucks.com'). Preferred over merchant."
    ),
    context: z
      .enum(["arrival", "addtocart", "checkout", "other"])
      .optional()
      .describe(
        "Optional: in what state you presented (arrival, addtocart, checkout, other)"
      ),
    checkoutSessionId: z.string().optional().describe(
      "UCP checkout session ID if available"
    ),
    trip_id: z.string().uuid().optional().describe(
      "Trip ID from kya_getAgentIdentity — links events in this shopping session"
    ),
  },
  async ({ verification_token, merchant, merchantUrl, context, checkoutSessionId, trip_id }) => {
    const resolvedMerchant = merchantUrl || merchant;
    if (!resolvedMerchant) {
      return {
        content: [{ type: "text" as const, text: "✗ Error: merchantUrl or merchant is required." }],
      };
    }
    return handleReportBadgePresented(verification_token, resolvedMerchant, context, checkoutSessionId, trip_id);
  }
);

server.tool(
  "kya_reportBadgeOutcome",
  `Report how the merchant responded when you presented your Badge.

Call this after kya_reportBadgePresented when you know whether the merchant accepted or denied you. Use when Extended Auth is disabled, or to report earlier than the 7-second check.`,
  {
    verification_token: z.string().describe(
      "The verification_token returned by kya_getAgentIdentity"
    ),
    merchant: z.string().max(200).describe(
      "The merchant where you presented (e.g., 'starbucks.com')"
    ),
    outcome: z
      .enum(["accepted", "denied", "inconclusive"])
      .describe(
        "accepted = merchant let you through; denied = blocked/bot-walled; inconclusive = unknown or timed out"
      ),
    trip_id: z.string().uuid().optional().describe(
      "Trip ID from kya_getAgentIdentity — links events in this shopping session"
    ),
  },
  async ({ verification_token, merchant, outcome, trip_id }) => {
    reportOutcomeFromAgent(verification_token, merchant, outcome, trip_id);
    return {
      content: [{
        type: "text",
        text: `✓ Outcome recorded: ${outcome} at ${merchant}`,
      }],
    };
  }
);

server.tool(
  "kya_reportBadgeNotPresented",
  `Report that you did NOT present your Badge at a merchant.

Call this when you have a badge but chose not to present it (e.g., abandoned cart, merchant didn't ask).`,
  {
    verification_token: z.string().describe(
      "The verification_token from kya_getAgentIdentity"
    ),
    merchant: z.string().max(200).describe(
      "The merchant where you did not present (e.g., 'starbucks.com')"
    ),
    reason: z
      .enum(["abandoned", "merchant_didnt_ask", "other"])
      .describe("Why you did not present: abandoned, merchant_didnt_ask, other"),
    trip_id: z.string().uuid().optional().describe(
      "Trip ID from kya_getAgentIdentity — links events in this shopping session"
    ),
  },
  async ({ verification_token, merchant, reason, trip_id }) => {
    await reportBadgeNotPresented(verification_token, merchant, reason, trip_id);
    return {
      content: [{
        type: "text",
        text: `✓ Not presented recorded at ${merchant} (${reason})`,
      }],
    };
  }
);

server.tool(
  "kya_getCard",
  `Get a single-use virtual Visa to make a purchase on behalf of the user. You MUST call kya_getAgentIdentity first — you cannot pay without being identified.

Declare the merchant, amount, and what you're buying. The user approves via MFA. kyaLabs issues a card locked to this purchase. The card self-destructs after use. Your user's real card never enters the chat.

Call kya_reportPurchase after the transaction.`,
  {
    merchant: z.string().max(500).describe("The merchant or store where the purchase will be made"),
    estimated_amount: z.number().positive().max(500).describe("Estimated purchase amount in USD (max $500)"),
    description: z.string().max(1000).describe("Brief description of what is being purchased"),
  },
  async ({ merchant, estimated_amount, description }) => {
    const result = await getCard({ merchant, estimated_amount, description });
    const formatted = formatCardResponse(result, merchant, estimated_amount);
    return {
      content: [
        { type: "text", text: formatted },
        { type: "text", text: `\n---\n${JSON.stringify(result, null, 2)}` },
      ],
    };
  }
);

server.tool(
  "kya_reportPurchase",
  "Report the outcome of a purchase after using a kyaLabs virtual card. Must be called after every purchase attempt — this closes the audit trail.",
  {
    intent_id: z.string().uuid().describe("The intent_id returned by kya_getCard"),
    success: z.boolean().describe("Whether the purchase succeeded"),
    actual_amount: z.number().positive().max(500).optional().describe("Actual amount charged in USD"),
    merchant_name: z.string().max(500).optional().describe("Merchant name as it appeared on the receipt"),
    items: z.string().max(2000).optional().describe("Items purchased (free-form description)"),
    order_confirmation: z.string().max(200).optional().describe("Order confirmation number or ID"),
  },
  async ({ intent_id, success, actual_amount, merchant_name, items, order_confirmation }) => {
    const result = await reportPurchase({
      intent_id,
      success,
      actual_amount,
      merchant_name,
      items,
      order_confirmation,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Initialize sampling after connection (DQ-54)
  initSampling(server.server);

  // v2.1: Detect agent model from MCP client handshake
  initAgentModel(server.server);

  process.on("SIGINT", async () => { onServerClose(); await flushPendingBrowse(); process.exit(0); });
  process.on("SIGTERM", async () => { onServerClose(); await flushPendingBrowse(); process.exit(0); });

  process.stderr.write("kyaLabs MCP server running on stdio\n");
  if (process.env.VITEST !== "true") {
    process.stderr.write(`[kyaLabs] Auth: ${getAuthMode()}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
