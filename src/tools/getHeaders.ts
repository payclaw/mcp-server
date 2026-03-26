/**
 * kya_getHeaders — returns identity headers for browser automation.
 *
 * Agents using Playwright, Puppeteer, or Chrome extensions call this once
 * per session and attach the returned headers to their HTTP requests.
 *
 * Returns the kya_* badge token (merchant-facing credential), NOT the
 * consent key (kya API credential). These are different credential types.
 */

import { getCachedBadgeToken } from "../lib/badge-token.js";

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
 * Returns an error if no badge token is cached (agent must call
 * kya_getAgentIdentity with a merchant first).
 */
export function getHeaders(): GetHeadersResult {
  const token = getCachedBadgeToken();
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
