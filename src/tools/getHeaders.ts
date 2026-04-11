/**
 * kya_getHeaders — returns identity headers for browser automation.
 *
 * Agents using Playwright, Puppeteer, or Chrome extensions call this once
 * per session and attach the returned headers to their HTTP requests.
 *
 * Returns the preferred investor-path token for the current session.
 * Badge-global JWT is preferred when available; merchant-local kya_* is the
 * fallback lane when no global identity token has been cached yet.
 */

import { getCachedBadgeToken, enrollAndCacheBadgeToken } from "@kyalabs/shared-identity";
import { getLatestIdentitySession } from "./getAgentIdentity.js";

export interface GetHeadersSuccess {
  headers: { "Kya-Token": string };
}

export interface GetHeadersError {
  error: string;
  code: string;
}

export type GetHeadersResult = GetHeadersSuccess | GetHeadersError;

/**
 * Return the identity headers for the current session.
 * Uses the kya_* badge token from the most recent enrollment.
 * If no token is cached, attempts enrollment for the last known merchant.
 * Returns an error if no badge token is available (agent must call
 * kya_getAgentIdentity with a merchant first).
 */
export async function getHeaders(merchant?: string): Promise<GetHeadersResult> {
  const identitySession = getLatestIdentitySession();
  let token = identitySession?.verificationToken ?? getCachedBadgeToken(merchant);

  // Attempt enrollment if no cached token and merchant context available
  if (!token && merchant) {
    try {
      token = await enrollAndCacheBadgeToken(merchant);
    } catch {
      // Fall through to NO_IDENTITY
    }
  }

  if (!token) {
    return {
      error: "Call kya_getAgentIdentity with a merchant first to establish identity",
      code: "NO_IDENTITY",
    };
  }

  return {
    headers: { "Kya-Token": token },
  };
}
