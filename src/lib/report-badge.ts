// Canonical: badge-server | Synced: PRD-3 | Do not edit in mcp-server
/**
 * POST identity_presented to /api/badge/report.
 * Extracted for testability (BUG-01.1).
 * Uses getStoredConsentKey for OAuth users; PAYCLAW_API_KEY for legacy.
 */

import { getStoredConsentKey } from "./storage.js";

const DEFAULT_API_URL = "https://payclaw.io";

export async function reportBadgePresented(
  verificationToken: string,
  merchant: string,
  context?: "arrival" | "addtocart" | "checkout" | "other",
  checkoutSessionId?: string
): Promise<void> {
  const apiUrl = process.env.PAYCLAW_API_URL || DEFAULT_API_URL;
  const key = getStoredConsentKey();
  if (!key) return;

  try {
    const res = await fetch(`${apiUrl}/api/badge/report`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        verification_token: verificationToken,
        event_type: "identity_presented",
        merchant,
        ...(context && { presentation_context: context }),
        ...(checkoutSessionId && { checkout_session_id: checkoutSessionId }),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      process.stderr.write(
        `[BADGE] reportBadgePresented failed (${res.status}): ${body}\n`
      );
    }
  } catch {
    /* fire-and-forget */
  }
}

export async function reportBadgeNotPresented(
  verificationToken: string,
  merchant: string,
  reason: "abandoned" | "merchant_didnt_ask" | "other"
): Promise<void> {
  const apiUrl = process.env.PAYCLAW_API_URL || DEFAULT_API_URL;
  const key = getStoredConsentKey();
  if (!key) return;

  try {
    const res = await fetch(`${apiUrl}/api/badge/report`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        verification_token: verificationToken,
        event_type: "badge_not_presented",
        merchant,
        reason,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      process.stderr.write(
        `[BADGE] reportBadgeNotPresented failed (${res.status}): ${body}\n`
      );
    }
  } catch {
    /* fire-and-forget */
  }
}
