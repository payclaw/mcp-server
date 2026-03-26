/**
 * Badge token cache — manages kya_* opaque tokens per merchant.
 *
 * Badge tokens are merchant-scoped credentials minted by /api/badge/enroll.
 * They are the credential type that merchants verify via /api/badge/verify.
 *
 * This is DIFFERENT from the consent key (pk_* / OAuth token) which authenticates
 * badge-server to the kya API. The consent key is for kya; the badge token is for merchants.
 *
 * Flow: consent key → authenticate to kya → enroll → kya_* badge token → Kya-Token header
 */

import { getStoredConsentKey, getOrCreateInstallId } from "./storage.js";
import { getEnvApiUrl } from "./env.js";

const DEFAULT_API_URL = "https://www.kyalabs.io";
const ENROLL_TIMEOUT_MS = 10_000;

/** Per-merchant badge token cache. Key = normalized merchant domain. */
const badgeTokenCache = new Map<string, string>();

/** Track the last enrolled merchant for getHeaders() (no merchant context). */
let lastEnrolledMerchant: string | null = null;

/**
 * Enroll at a merchant and cache the kya_* badge token.
 * Returns cached token if already enrolled for this merchant.
 * Returns null on failure (graceful — never throws).
 */
export async function enrollAndCacheBadgeToken(merchant: string): Promise<string | null> {
  // Check cache first
  const cached = badgeTokenCache.get(merchant);
  if (cached) return cached;

  // Need consent key to enroll
  const consentKey = getStoredConsentKey();
  if (!consentKey) return null;

  const apiUrl = getEnvApiUrl() || DEFAULT_API_URL;
  const installId = getOrCreateInstallId();

  try {
    const res = await fetch(`${apiUrl}/api/badge/enroll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${consentKey}`,
      },
      body: JSON.stringify({ merchant, install_id: installId }),
      signal: AbortSignal.timeout(ENROLL_TIMEOUT_MS),
    });

    if (!res.ok) {
      process.stderr.write(`[badge] enroll failed for ${merchant}: HTTP ${res.status}\n`);
      return null;
    }

    const data = (await res.json()) as { badge_token?: string };
    if (!data.badge_token) {
      process.stderr.write(`[badge] enroll response missing badge_token\n`);
      return null;
    }

    badgeTokenCache.set(merchant, data.badge_token);
    lastEnrolledMerchant = merchant;
    return data.badge_token;
  } catch {
    process.stderr.write(`[badge] enroll failed for ${merchant}: network error\n`);
    return null;
  }
}

/**
 * Get cached badge token for a merchant.
 * If no merchant specified, returns the most recently enrolled token.
 * Returns null if no token cached.
 */
export function getCachedBadgeToken(merchant?: string): string | null {
  if (merchant) {
    return badgeTokenCache.get(merchant) ?? null;
  }
  // No merchant — return last enrolled
  if (lastEnrolledMerchant) {
    return badgeTokenCache.get(lastEnrolledMerchant) ?? null;
  }
  return null;
}

/** Reset cache — for testing only. */
export function _resetBadgeTokenCache(): void {
  badgeTokenCache.clear();
  lastEnrolledMerchant = null;
}
