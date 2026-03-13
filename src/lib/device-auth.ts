// Canonical: badge-server | Synced: 0.7.3 | Do not edit in mcp-server
import { storeConsentKey } from "./storage.js";

const DEFAULT_API_URL = "https://www.kyalabs.io";
const FETCH_TIMEOUT_MS = 10_000;

function getBaseUrl(): string {
  const url = process.env.PAYCLAW_API_URL;
  if (url && url.trim().length > 0) {
    const trimmed = url.trim().replace(/\/+$/, "");
    try {
      const parsed = new URL(trimmed);
      const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
      if (parsed.protocol === "https:" || (parsed.protocol === "http:" && isLoopback)) {
        return trimmed;
      }
    } catch {
      // fall through to DEFAULT_API_URL
    }
  }
  return DEFAULT_API_URL;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/**
 * Initiate device authorization flow.
 * POST /api/oauth/device/authorize — no auth required.
 */
export async function initiateDeviceAuth(): Promise<DeviceAuthResponse> {
  const baseUrl = getBaseUrl();
  const res = await fetchWithTimeout(`${baseUrl}/api/oauth/device/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ scope: "ucp:scopes:checkout_session" }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(res.status === 429 ? "Rate limited. Try again in a few minutes." : text || "Device auth failed");
  }

  const data = (await res.json()) as DeviceAuthResponse;
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error("Invalid device auth response");
  }
  const interval = Math.max(1, Number(data.interval) || 5);
  const expiresIn = Math.max(1, Number(data.expires_in) || 600);
  return { ...data, interval, expires_in: expiresIn };
}

export interface TokenSuccessResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  credential_provider?: string;
  badge_status?: string;
  assurance_level?: string;
}

export type ApprovalCallback = (tokens: TokenSuccessResponse) => void;

/**
 * Poll token endpoint until user approves or timeout.
 * On success: stores consent key and calls onApproval.
 * RFC 8628: slow_down adds 5s permanently to interval.
 */
export async function pollForApproval(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  onApproval?: ApprovalCallback
): Promise<TokenSuccessResponse> {
  const baseUrl = getBaseUrl();
  const deadline = Date.now() + expiresIn * 1000;
  let currentInterval = interval;

  while (Date.now() < deadline) {
    await sleep(currentInterval * 1000);

    const res = await fetchWithTimeout(`${baseUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
      }),
    });

    const data = (await res.json()) as { error?: string; access_token?: string } & TokenSuccessResponse;

    if (res.ok && data.access_token) {
      await storeConsentKey(data.access_token);
      onApproval?.(data as TokenSuccessResponse);
      return data as TokenSuccessResponse;
    }

    if (data.error === "slow_down") {
      currentInterval += 5;
    } else if (data.error !== "authorization_pending") {
      throw new Error(data.error ?? "Token request failed");
    }
  }

  throw new Error("expired_token");
}
