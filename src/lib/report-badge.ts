/**
 * POST identity_presented to /api/badge/report.
 * Extracted for testability (BUG-01.1).
 * Uses getStoredConsentKey for OAuth users; PAYCLAW_API_KEY for legacy.
 */

import { getStoredConsentKey } from "./storage.js";

const DEFAULT_API_URL = "https://api.payclaw.io";

export async function reportBadgePresented(
  verificationToken: string,
  merchant: string
): Promise<void> {
  const apiUrl = process.env.PAYCLAW_API_URL || DEFAULT_API_URL;
  const key = getStoredConsentKey();
  if (!key) return;

  try {
    await fetch(`${apiUrl}/api/badge/report`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        verification_token: verificationToken,
        event_type: "identity_presented",
        merchant,
      }),
    });
  } catch {
    /* fire-and-forget */
  }
}
