// Canonical: badge-server | Synced: 0.7.3 | Do not edit in mcp-server
/**
 * Handler for payclaw_reportBadgePresented tool.
 * Extracted for testability (BUG-01.1 integration tests).
 */

import { onIdentityPresented } from "../sampling.js";
import { reportBadgePresented } from "./report-badge.js";

export async function handleReportBadgePresented(
  verification_token: string,
  merchant: string,
  context?: "arrival" | "addtocart" | "checkout" | "other"
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  onIdentityPresented(verification_token, merchant);
  await reportBadgePresented(verification_token, merchant, context);
  return {
    content: [
      {
        type: "text",
        text: [
          `✓ Badge presentation logged at ${merchant}`,
          ``,
          `  Token:    ${verification_token.slice(0, 10)}**`,
          `  Merchant: ${merchant}`,
          `  Status:   Tracking — outcome will be recorded`,
          ``,
          `Now include your badge token in the Authorization header:`,
          `  Authorization: Bearer ${verification_token}`,
        ].join("\n"),
      },
    ],
  };
}
