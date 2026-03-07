// Canonical: mcp-server | Synced: 0.7.3 | Structurally divergent — badge-server has badge-only subset
import type {
  ApiIntentResponse,
  ApiCardResponse,
  ApiTransactionResponse,
  ApiBalanceResponse,
  ApiAgentIdentityResponse,
} from "../types.js";
import { getStoredConsentKey } from "../lib/storage.js";

class PayClawApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "PayClawApiError";
  }
}

/** MCP-safe logging — writes to stderr so it doesn't interfere with stdio protocol. */
function log(level: "info" | "warn" | "error", msg: string): void {
  process.stderr.write(`[PayClaw:${level}] ${msg}\n`);
}

/** SEC-010: Default timeout for all API requests (30 seconds) */
const REQUEST_TIMEOUT_MS = 30_000;

function getConfig() {
  const baseUrl = process.env.PAYCLAW_API_URL || getBaseUrl();
  const apiKey = getStoredConsentKey();
  if (!baseUrl) throw new PayClawApiError("PayClaw API URL is not configured.");
  if (!apiKey) throw new PayClawApiError("PayClaw API key is not configured.");

  // SEC-009: Require HTTPS in production
  if (!baseUrl.startsWith("https://") && !baseUrl.startsWith("http://localhost")) {
    throw new PayClawApiError(
      "PayClaw API URL must use HTTPS for security.",
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
    // Node fetch strips Authorization on cross-origin redirects (e.g. payclaw.io → www.payclaw.io).
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
    if (err instanceof Error && err.name === "AbortError") {
      log("error", `${method} ${urlPath} → timeout`);
      throw new PayClawApiError("Request timed out. Please try again.");
    }
    log("error", `${method} ${urlPath} → network error`);
    // SEC-013: Generic error message — don't leak URL or config details
    throw new PayClawApiError("Could not reach the PayClaw API. Please check your configuration.");
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 401) {
    log("error", `${method} ${urlPath} → 401 unauthorized`);
    throw new PayClawApiError(
      "Authentication failed. Please check your API key.",
      401,
    );
  }

  if (!res.ok) {
    let body: string;
    try {
      const json = (await res.json()) as { error?: string; message?: string };
      body = json.error ?? json.message ?? JSON.stringify(json);
    } catch {
      body = await res.text();
    }
    log("error", `${method} ${urlPath} → ${res.status}: ${body.slice(0, 200)}`);
    throw new PayClawApiError(body, res.status);
  }

  log("info", `${method} ${urlPath} → ${res.status}`);
  return (await res.json()) as T;
}

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

export async function getAgentIdentity(
  sessionId?: string,
  merchant?: string,
): Promise<ApiAgentIdentityResponse> {
  const { baseUrl, apiKey } = getConfig();
  return request<ApiAgentIdentityResponse>(`${baseUrl}/api/agent-identity`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      session_id: sessionId,
      ...(merchant ? { merchant } : {}),
    }),
  });
}

export function isApiMode(): boolean {
  return !!process.env.PAYCLAW_API_URL || !!getStoredConsentKey();
}

/** Base URL for API calls. Defaults to https://www.payclaw.io (canonical, avoids redirect). */
export function getBaseUrl(): string {
  const url = process.env.PAYCLAW_API_URL;
  if (url && url.trim().length > 0) {
    return url.trim().replace(/\/+$/, "");
  }
  return "https://www.payclaw.io";
}

/**
 * Call agent-identity with a Bearer token (API key or OAuth access token).
 * Used when consent key comes from device flow (OAuth token) instead of PAYCLAW_API_KEY.
 */
export async function getAgentIdentityWithToken(
  baseUrl: string,
  token: string,
  merchant?: string
): Promise<ApiAgentIdentityResponse> {
  return request<ApiAgentIdentityResponse>(`${baseUrl}/api/agent-identity`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(merchant ? { merchant } : {}),
    }),
  });
}
