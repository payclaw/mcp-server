#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getCard } from "./tools/getCard.js";
import { reportPurchase } from "./tools/reportPurchase.js";

const server = new McpServer({
  name: "payclaw",
  version: "0.1.1",
});

server.tool(
  "payclaw_getCard",
  "Get a PayClaw virtual card to make a purchase on behalf of the user. Returns card details and an intent_id. Call payclaw_reportPurchase after the transaction.",
  {
    // SEC-011: Input bounds — max 500 chars for merchant, $500 max amount, 1000 chars description
    merchant: z.string().max(500).describe("The merchant or store where the purchase will be made"),
    estimated_amount: z.number().positive().max(500).describe("Estimated purchase amount in USD (max $500)"),
    description: z.string().max(1000).describe("Brief description of what is being purchased"),
  },
  async ({ merchant, estimated_amount, description }) => {
    const result = await getCard({ merchant, estimated_amount, description });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "payclaw_reportPurchase",
  "Report the outcome of a purchase after using a PayClaw card from payclaw_getCard. Must be called after every purchase attempt.",
  {
    // SEC-011: Input bounds on all string/number fields
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
  process.stderr.write("PayClaw MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
