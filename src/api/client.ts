/**
 * MCP-server API client — uses shared identity utilities with enhanced
 * security hardening (SEC-009/010/013/014) and payment endpoints.
 */

import type {
  ApiIntentResponse,
  ApiCardResponse,
  ApiTransactionResponse,
  ApiBalanceResponse,
  ApiAgentIdentityResponse,
} from "../types.js";
import { getStoredConsentKey, getEnvApiUrl } from "@kyalabs/shared-identity";

export class BadgeApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "BadgeApiError";
  }
}

/** MCP-safe logging — writes to stderr so it doesn't interfere with stdio protocol. */
function log(level: "info" | "warn" | "error", msg: string): void {
  process.stderr.write(`[kyaLabs:${level}] ${msg}\n`);
}

/** SEC-010: Default timeout for all API requests (30 seconds) */
const REQUEST_TIMEOUT_MS = 30_000;

function getConfig() {
  const baseUrl = getEnvApiUrl() || getBaseUrl();
  const apiKey = getStoredConsentKey();
  if (!baseUrl) throw new BadgeApiError("kyaLabs API URL is not configured.");
  if (!apiKey) throw new BadgeApiError("kyaLabs API key is not configured.");

  // SEC-009: Require HTTPS in production
  if (!baseUrl.startsWith("https://") && !baseUrl.startsWith("http://localhost")) {
    throw new BadgeApiError(
      "kyaLabs API URL must use HTTPS for security.",
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const method = init.method || "GET";
  // SEC-013: Log path only (no query params that might contain tokens)
  const urlPath = new URL(url).pathname;
  log("info", `${method} ${urlPath}`);

  // SEC-010: Add timeout to prevent indefinite hangs
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    // SEC-014: Use manual redirect to preserve Authorization header across redirects.
    // Node fetch strips Authorization on cross-origin redirects (e.g. kyalabs.io → www.kyalabs.io).
    res = await fetch(url, { ...init, redirect: "manual", signal: controller.signal });

    // Follow redirects manually, preserving auth headers
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (location) {
        const redirectUrl = new URL(location, url).href;
        log("warn", `${method} ${urlPath} → ${res.status} redirect to ${new URL(redirectUrl).host} (re-sending with auth)`);
        res = await fetch(redirectUrl, { ...init, redirect: "manual", signal: controller.signal });
      }
    }
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      log("error", `${method} ${urlPath} → timeout`);
      throw new BadgeApiError("Request timed out. Please try again.");
    }
    log("error", `${method} ${urlPath} → network error`);
    // SEC-013: Generic error message — don't leak URL or config details
    throw new BadgeApiError("Could not reach the kyaLabs API. Please check your configuration.");
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 401) {
    log("error", `${method} ${urlPath} → 401 unauthorized`);
    throw new BadgeApiError(
      "kyaLabs session has expired. To continue, add a permanent API key to your MCP config:\n\n" +
      "  1. Get a key: https://www.kyalabs.io/dashboard/keys\n" +
      "  2. Add to your MCP config: KYA_API_KEY=pk_live_...\n\n" +
      "Permanent keys don't expire. See: https://www.kyalabs.io/docs/mcp-setup",
      401,
    );
  }

  if (!res.ok) {
    const rawBody = await res.text();
    let body: string;
    try {
      const json = JSON.parse(rawBody) as { error?: string; message?: string };
      body = json.error ?? json.message ?? JSON.stringify(json);
    } catch {
      body = rawBody;
    }
    log("error", `${method} ${urlPath} → ${res.status}: ${body.slice(0, 200)}`);
    throw new BadgeApiError(body, res.status);
  }

  log("info", `${method} ${urlPath} → ${res.status}`);
  return (await res.json()) as T;
}

// --- Payment endpoints (mcp-server only) ---

export async function createIntent(
  merchantUrl: string,
  estimatedAmountCents: number,
  description: string,
): Promise<ApiIntentResponse> {
  const { baseUrl, apiKey } = getConfig();
  return request<ApiIntentResponse>(`${baseUrl}/api/intents`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      merchant_url: merchantUrl,
      estimated_amount_cents: estimatedAmountCents,
      description,
    }),
  });
}

export async function getCard(intentId: string): Promise<ApiCardResponse> {
  const { baseUrl, apiKey } = getConfig();
  return request<ApiCardResponse>(
    `${baseUrl}/api/cards?intent_id=${encodeURIComponent(intentId)}`,
    { method: "GET", headers: authHeaders(apiKey) },
  );
}

export async function reportTransaction(
  intentId: string,
  merchantName: string | undefined,
  merchantUrl: string | undefined,
  amountCents: number,
): Promise<ApiTransactionResponse> {
  const { baseUrl, apiKey } = getConfig();
  return request<ApiTransactionResponse>(`${baseUrl}/api/transactions`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      intent_id: intentId,
      merchant_name: merchantName,
      merchant_url: merchantUrl,
      amount_cents: amountCents,
    }),
  });
}

export async function getBalance(): Promise<ApiBalanceResponse> {
  const { baseUrl, apiKey } = getConfig();
  return request<ApiBalanceResponse>(`${baseUrl}/api/wallet/balance`, {
    method: "GET",
    headers: authHeaders(apiKey),
  });
}

// --- Identity endpoints ---

export async function getAgentIdentity(
  sessionId?: string,
  merchant?: string,
  tripId?: string,
  installId?: string,
): Promise<ApiAgentIdentityResponse> {
  const { baseUrl, apiKey } = getConfig();
  return request<ApiAgentIdentityResponse>(`${baseUrl}/api/agent-identity`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      session_id: sessionId,
      ...(merchant ? { merchant } : {}),
      ...(tripId ? { trip_id: tripId } : {}),
      ...(installId ? { install_id: installId } : {}),
    }),
  });
}

export function isApiMode(): boolean {
  return !!getEnvApiUrl() || !!getStoredConsentKey();
}

/** Base URL for API calls. Defaults to https://www.kyalabs.io (canonical, avoids redirect). */
export function getBaseUrl(): string {
  const url = getEnvApiUrl();
  if (url && url.trim().length > 0) {
    return url.trim().replace(/\/+$/, "");
  }
  return "https://www.kyalabs.io";
}

export { type IntrospectResult, introspectBadgeToken } from "@kyalabs/shared-identity";

/**
 * Call agent-identity with a Bearer token (API key or OAuth access token).
 */
export async function getAgentIdentityWithToken(
  baseUrl: string,
  token: string,
  merchant?: string,
  tripId?: string,
  installId?: string,
): Promise<ApiAgentIdentityResponse> {
  return request<ApiAgentIdentityResponse>(`${baseUrl}/api/agent-identity`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(merchant ? { merchant } : {}),
      ...(tripId ? { trip_id: tripId } : {}),
      ...(installId ? { install_id: installId } : {}),
    }),
  });
}
