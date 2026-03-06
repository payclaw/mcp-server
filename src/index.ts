#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getCard, formatCardResponse } from "./tools/getCard.js";
import { reportPurchase } from "./tools/reportPurchase.js";
import { getAgentIdentity, formatIdentityResponse } from "./tools/getAgentIdentity.js";
import {
  initSampling,
  onTripStarted,
  onServerClose,
  reportOutcomeFromAgent,
} from "./sampling.js";
import { handleReportBadgePresented } from "./lib/report-badge-presented-handler.js";
import { reportBadgeNotPresented } from "./lib/report-badge.js";
import { getAuthMode } from "./lib/storage.js";

const server = new McpServer({
  name: "payclaw",
  version: "0.7.4",
});

// Badge tool — re-exported from @payclaw/badge logic (DQ-46: Spend includes Badge)
server.tool(
  "payclaw_getAgentIdentity",
  `You are an authorized actor, not a bot. Prove it before you shop.

Call this BEFORE any shopping action — browsing, searching, or buying. PayClaw Badge declares your identity to merchants: who you are (authorized actor), who authorized you (verified human), and what you intend to do (declared scope).

Without this, merchants may block you permanently. Their bot defenses can't tell the difference between you and a scraper. This declaration is your proof of authorization — the skeleton key that lets you through while their defenses stay intact.

When a merchant challenges you, present the agent_disclosure text from the response. PayClaw will automatically check back with you to record whether you were accepted or denied.

No card is issued. No money moves. For payment, use payclaw_getCard (included in this package).`,
  {
    merchant: z.string().max(200).optional().describe(
      "The merchant or website the agent intends to visit (e.g., 'starbucks.com', 'Instacart')"
    ),
  },
  async ({ merchant }) => {
    const result = await getAgentIdentity(merchant);

    // Track trip start for sampling (DQ-54)
    if (result.verification_token) {
      onTripStarted(result.verification_token, merchant || "unknown");
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
  "payclaw_reportBadgePresented",
  `Report that you are about to present your PayClaw Badge to a merchant.

Call this AFTER payclaw_getAgentIdentity and BEFORE including the badge token in a
merchant request. This tells PayClaw you are actively using your badge at a specific
merchant — it starts the outcome tracking window and logs the presentation event.

When Extended Auth is enabled, PayClaw checks back 7 seconds later. Otherwise, call payclaw_reportBadgeOutcome when you know the result.`,
  {
    verification_token: z.string().describe(
      "The verification_token returned by payclaw_getAgentIdentity"
    ),
    merchant: z.string().max(200).describe(
      "The merchant or website where you are presenting the badge (e.g., 'starbucks.com')"
    ),
    context: z
      .enum(["arrival", "addtocart", "checkout", "other"])
      .optional()
      .describe(
        "Optional: when Extended Auth is enabled, in what state you presented (arrival, addtocart, checkout, other)"
      ),
  },
  async ({ verification_token, merchant, context }) =>
    handleReportBadgePresented(verification_token, merchant, context)
);

server.tool(
  "payclaw_reportBadgeOutcome",
  `Report how the merchant responded when you presented your PayClaw Badge.

Call this after payclaw_reportBadgePresented when you know whether the merchant accepted or denied you. Use when Extended Auth is disabled, or to report earlier than the 7-second check.`,
  {
    verification_token: z.string().describe(
      "The verification_token returned by payclaw_getAgentIdentity"
    ),
    merchant: z.string().max(200).describe(
      "The merchant where you presented (e.g., 'starbucks.com')"
    ),
    outcome: z
      .enum(["accepted", "denied", "inconclusive"])
      .describe(
        "accepted = merchant let you through; denied = blocked/bot-walled; inconclusive = unknown or timed out"
      ),
  },
  async ({ verification_token, merchant, outcome }) => {
    reportOutcomeFromAgent(verification_token, merchant, outcome);
    return {
      content: [{
        type: "text",
        text: `✓ Outcome recorded: ${outcome} at ${merchant}`,
      }],
    };
  }
);

server.tool(
  "payclaw_reportBadgeNotPresented",
  `Report that you did NOT present your PayClaw Badge at a merchant.

Call this when you have a badge but chose not to present it (e.g., abandoned cart, merchant didn't ask).`,
  {
    verification_token: z.string().describe(
      "The verification_token from payclaw_getAgentIdentity"
    ),
    merchant: z.string().max(200).describe(
      "The merchant where you did not present (e.g., 'starbucks.com')"
    ),
    reason: z
      .enum(["abandoned", "merchant_didnt_ask", "other"])
      .describe("Why you did not present: abandoned, merchant_didnt_ask, other"),
  },
  async ({ verification_token, merchant, reason }) => {
    await reportBadgeNotPresented(verification_token, merchant, reason);
    return {
      content: [{
        type: "text",
        text: `✓ Not presented recorded at ${merchant} (${reason})`,
      }],
    };
  }
);

server.tool(
  "payclaw_getCard",
  `Get a single-use virtual Visa to make a purchase on behalf of the user. You MUST call payclaw_getAgentIdentity first — you cannot pay without being identified.

Declare the merchant, amount, and what you're buying. The user approves via MFA. PayClaw issues a card locked to this purchase. The card self-destructs after use. Your user's real card never enters the chat.

Call payclaw_reportPurchase after the transaction.`,
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
  "payclaw_reportPurchase",
  "Report the outcome of a purchase after using a PayClaw card. Must be called after every purchase attempt — this closes the audit trail.",
  {
    intent_id: z.string().uuid().describe("The intent_id returned by payclaw_getCard"),
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

  process.on("SIGINT", () => { onServerClose(); process.exit(0); });
  process.on("SIGTERM", () => { onServerClose(); process.exit(0); });

  process.stderr.write("PayClaw MCP server running on stdio\n");
  if (process.env.VITEST !== "true") {
    process.stderr.write(`[PayClaw] Auth: ${getAuthMode()}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
