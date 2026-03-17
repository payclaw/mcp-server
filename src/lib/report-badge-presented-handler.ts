// Canonical: badge-server | Synced: 2.1.0 | Do not edit in mcp-server
/**
 * Handler for kya_reportBadgePresented tool.
 * Extracted for testability (BUG-01.1 integration tests).
 */

import { onIdentityPresented } from "../sampling.js";
import { reportBadgePresented } from "./report-badge.js";

/**
 * Idempotency (duplicate row prevention) and expired-token status
 * (`status: 'expired_presentation'`) are enforced by the API server,
 * not here. The MCP server is stateless — it has no DB access and
 * cannot check trip_id uniqueness or decode token expiry authoritatively.
 */
export async function handleReportBadgePresented(
  verification_token: string,
  merchant: string,
  context?: "arrival" | "addtocart" | "checkout" | "other",
  checkoutSessionId?: string,
  tripId?: string
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  onIdentityPresented(verification_token, merchant, tripId);
  await reportBadgePresented(verification_token, merchant, context, checkoutSessionId, tripId);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ recorded: true }),
      },
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
