// Canonical: badge-server | Synced: 2.0.0 | Do not edit in mcp-server
/**
 * POST badge events to /api/badge/report.
 * v2.0: Enrichment branching — anonymous payload if no key, enriched if key.
 * Removes the `if (!key) return;` silent gate that caused 2,500 installs → 0 events.
 */

import { getStoredConsentKey, getOrCreateInstallId } from "./storage.js";
import { getEnvApiUrl } from "./env.js";

const DEFAULT_API_URL = "https://www.kyalabs.io";
const BADGE_VERSION = "2.0";
const AGENT_TYPE = "badge-mcp";

export async function reportBadgePresented(
  verificationToken: string,
  merchant: string,
  context?: "arrival" | "addtocart" | "checkout" | "other",
  checkoutSessionId?: string
): Promise<void> {
  const apiUrl = getEnvApiUrl() || DEFAULT_API_URL;
  const key = getStoredConsentKey();
  const installId = getOrCreateInstallId();

  try {
    if (key) {
      // Enriched payload: full auth, user-linked, includes install_id
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
          install_id: installId,
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
    } else {
      // Anonymous payload: no auth header, install_id only
      const res = await fetch(`${apiUrl}/api/badge/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          install_id: installId,
          badge_version: BADGE_VERSION,
          event_type: "identity_presented",
          merchant,
          agent_type: AGENT_TYPE,
          timestamp: Date.now(),
          ...(context && { presentation_context: context }),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        process.stderr.write(
          `[BADGE] anonymous reportBadgePresented failed (${res.status}): ${body}\n`
        );
      }
    }
  } catch (err) {
    // [EC-1] Fire-and-forget but never silent — log all failures
    process.stderr.write(
      `[BADGE] reportBadgePresented error: ${err instanceof Error ? err.message : err}\n`
    );
  }
}

export async function reportBadgeNotPresented(
  verificationToken: string,
  merchant: string,
  reason: "abandoned" | "merchant_didnt_ask" | "other"
): Promise<void> {
  const apiUrl = getEnvApiUrl() || DEFAULT_API_URL;
  const key = getStoredConsentKey();
  const installId = getOrCreateInstallId();

  try {
    if (key) {
      // Enriched payload: full auth, user-linked, includes install_id
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
          install_id: installId,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        process.stderr.write(
          `[BADGE] reportBadgeNotPresented failed (${res.status}): ${body}\n`
        );
      }
    } else {
      // Anonymous payload: no auth header, install_id only
      const res = await fetch(`${apiUrl}/api/badge/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          install_id: installId,
          badge_version: BADGE_VERSION,
          event_type: "badge_not_presented",
          merchant,
          reason,
          agent_type: AGENT_TYPE,
          timestamp: Date.now(),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        process.stderr.write(
          `[BADGE] anonymous reportBadgeNotPresented failed (${res.status}): ${body}\n`
        );
      }
    }
  } catch (err) {
    // [EC-1] Fire-and-forget but never silent
    process.stderr.write(
      `[BADGE] reportBadgeNotPresented error: ${err instanceof Error ? err.message : err}\n`
    );
  }
}
