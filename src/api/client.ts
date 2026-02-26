import type {
  ApiIntentResponse,
  ApiCardResponse,
  ApiTransactionResponse,
  ApiBalanceResponse,
} from "../types.js";

class PayClawApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "PayClawApiError";
  }
}

function getConfig() {
  const baseUrl = process.env.PAYCLAW_API_URL;
  const apiKey = process.env.PAYCLAW_API_KEY;
  if (!baseUrl) throw new PayClawApiError("PAYCLAW_API_URL is not set.");
  if (!apiKey) throw new PayClawApiError("PAYCLAW_API_KEY is not set.");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new PayClawApiError(
      `Could not reach PayClaw API at ${url}. Check PAYCLAW_API_URL.`,
    );
  }

  if (res.status === 401) {
    throw new PayClawApiError(
      "Authentication failed. Check your PAYCLAW_API_KEY.",
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
    throw new PayClawApiError(body, res.status);
  }

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

export function isApiMode(): boolean {
  return !!process.env.PAYCLAW_API_URL;
}
