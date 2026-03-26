/**
 * kya_web_fetch — fetch with automatic Badge identity + shopping journal.
 *
 * Wraps native fetch with:
 * - Kya-Token header injection (identity delivery)
 * - Auto-declare event (shopping journal, fire-and-forget)
 * - SSRF protection (isPublicOrigin check)
 * - Response bounds (5MB max, 30s timeout)
 * - Manual redirects (prevents token leak to redirect targets)
 */

import { getOrCreateInstallId } from "../lib/storage.js";
import { getAgentModel } from "../lib/agent-model.js";
import { getEnvApiUrl } from "../lib/env.js";
import { isPublicOrigin } from "../lib/url-safety.js";
import { enrollAndCacheBadgeToken, getCachedBadgeToken } from "../lib/badge-token.js";
import { randomUUID } from "node:crypto";

const MAX_BODY_BYTES = 5_242_880; // 5MB
const FETCH_TIMEOUT_MS = 30_000;
const DECLARE_TIMEOUT_MS = 5_000;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_API_URL = "https://www.kyalabs.io";
const BADGE_VERSION = "2.5.0";
const AGENT_TYPE = "mcp-server";

/** Headers to keep from the response — everything else is stripped. */
const KEEP_HEADERS = new Set([
  "content-type",
  "content-length",
  "location",
  "cache-control",
]);

// --- Result types ---

export interface WebFetchSuccess {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  url: string;
}

export interface WebFetchError {
  error: string;
  code: string;
}

export type WebFetchResult = WebFetchSuccess | WebFetchError;

/**
 * Fetch a URL with Kya-Token identity header injected.
 * Auto-fires a browse_declared event (fire-and-forget).
 */
export async function webFetch(
  url: string,
  method?: string,
  headers?: Record<string, string>,
): Promise<WebFetchResult> {
  // 1. URL validation (before identity — need merchant from URL)
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Invalid URL", code: "INVALID_URL" };
  }

  // 2. Scheme check — HTTPS only (HTTP allowed in tests)
  const isHttps = parsed.protocol === "https:";
  const isTestHttp = parsed.protocol === "http:" && process.env.VITEST;
  if (!isHttps && !isTestHttp) {
    return { error: "URL must use HTTPS", code: "INVALID_URL" };
  }

  // 3. SSRF check
  if (!isPublicOrigin(url)) {
    return { error: "Cannot fetch private or internal URLs", code: "BLOCKED_URL" };
  }

  // 4. Identity check — get badge token for this merchant
  const merchant = parsed.hostname.replace(/^www\./, "");
  let token = getCachedBadgeToken(merchant);
  if (!token) {
    // Enroll on-the-fly for this merchant
    token = await enrollAndCacheBadgeToken(merchant);
  }
  if (!token) {
    return {
      error: "Call kya_getAgentIdentity with a merchant first to establish identity",
      code: "NO_IDENTITY",
    };
  }

  // 5. Method check
  const resolvedMethod = (method ?? "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(resolvedMethod)) {
    return {
      error: `Method ${resolvedMethod} not allowed. Use GET, HEAD, or OPTIONS.`,
      code: "METHOD_NOT_ALLOWED",
    };
  }

  // 6. Build request headers — our token wins over any agent-provided Kya-Token
  // Filter out case-variant kya-token headers to prevent agents from overriding
  const sanitizedHeaders: Record<string, string> = {};
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() !== "kya-token") {
        sanitizedHeaders[k] = v;
      }
    }
  }
  const requestHeaders: Record<string, string> = {
    ...sanitizedHeaders,
    "Kya-Token": token,
  };

  // 7. Execute fetch
  let response: Response;
  try {
    response = await fetch(url, {
      method: resolvedMethod,
      headers: requestHeaders,
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { error: "Request timed out", code: "TIMEOUT" };
    }
    return { error: "Failed to fetch URL", code: "FETCH_ERROR" };
  }

  // 8. Read body with size cap
  let body: string;
  let truncated = false;
  try {
    body = await response.text();
    if (body.length > MAX_BODY_BYTES) {
      body = body.slice(0, MAX_BODY_BYTES);
      truncated = true;
    }
  } catch (err) {
    process.stderr.write(`[badge] body read failed: ${err instanceof Error ? err.message : err}\n`);
    body = "";
  }

  // 9. Filter response headers
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of response.headers.entries()) {
    if (KEEP_HEADERS.has(key.toLowerCase())) {
      responseHeaders[key.toLowerCase()] = value;
    }
  }

  const result: WebFetchSuccess = {
    status: response.status,
    headers: responseHeaders,
    body,
    truncated,
    url: response.url || url,
  };

  // 11. Auto-declare (fire-and-forget)
  fireBrowseDeclared(merchant);

  return result;
}

/**
 * Fire browse_declared event — same pattern as getAgentIdentity.ts.
 * Anonymous path, fire-and-forget, errors logged to stderr.
 */
function fireBrowseDeclared(merchant: string): void {
  try {
    const apiUrl = getEnvApiUrl() || DEFAULT_API_URL;
    const installId = getOrCreateInstallId();

    const payload = {
      install_id: installId,
      badge_version: BADGE_VERSION,
      event_type: "browse_declared",
      merchant,
      agent_type: AGENT_TYPE,
      agent_model: getAgentModel(),
      trip_id: randomUUID(),
      timestamp: Date.now(),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DECLARE_TIMEOUT_MS);

    fetch(`${apiUrl}/api/badge/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then((res) => {
        clearTimeout(timer);
        if (!res.ok) {
          process.stderr.write(`[badge] browse_declared failed: HTTP ${res.status}\n`);
        }
      })
      .catch(() => {
        clearTimeout(timer);
        process.stderr.write("[badge] browse_declared failed: network error\n");
      });
  } catch {
    // Never propagate — fire-and-forget
  }
}
