import { createIntent, getBalance, MOCK_CARD } from "../mock/store.js";
import * as api from "../api/client.js";
import { getStoredConsentKey } from "../lib/storage.js";

export interface GetCardInput {
  merchant: string;
  estimated_amount: number;
  description: string;
}

export interface CardResult {
  product_name: string;
  status: string;
  intent_id?: string;
  card?: {
    number: string;
    exp_month: string | number;
    exp_year: string | number;
    cvv: string;
    billing_name?: string;
    last_four?: string;
  };
  merchant?: string;
  amount?: number;
  identity?: unknown;
  badge_warning?: string;
  remaining_balance?: number;
  instructions?: string;
  message?: string;
  reason?: string;
  merchant_url?: string;
  estimated_amount?: number;
  approve_endpoint?: string;
}

/**
 * Minimal merchant normalization — add https:// if no protocol present.
 */
function normalizeMerchantUrl(merchant: string): string {
  const trimmed = merchant.trim().replace(/^\/\//, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/**
 * Format card result as human-readable text for CLI/agent display.
 */
export function formatCardResponse(r: CardResult, merchant?: string, amount?: number): string {
  if (r.status === "error") {
    return `✗ CARD ERROR\n\n  ${r.message}`;
  }

  if (r.status === "denied") {
    return [
      `✗ CARD DENIED`,
      ``,
      `  Reason:     ${r.reason || r.message || 'Denied by policy'}`,
      `  Balance:    $${r.remaining_balance?.toFixed(2) ?? 'N/A'}`,
      ``,
      `  Fund your PayClaw balance at payclaw.io/dashboard to try again.`,
    ].join('\n');
  }

  if (r.status === "pending_approval") {
    return [
      `⏳ APPROVAL REQUIRED`,
      ``,
      `  Merchant:   ${merchant || r.merchant_url || 'Unknown'}`,
      `  Amount:     $${(amount || r.estimated_amount || 0).toFixed(2)}`,
      ``,
      `  Your user needs to approve this purchase before a card is issued.`,
      `  Ask them to approve $${(amount || r.estimated_amount || 0).toFixed(2)} at ${merchant || r.merchant_url || 'the merchant'}.`,
    ].join('\n');
  }

  if (r.status === "approved" && r.card) {
    const lastFour = r.card.last_four || r.card.number?.slice(-4) || '****';
    const lines = [
      `✓ VIRTUAL VISA ISSUED`,
      ``,
      `  Card:       •••• ${lastFour}`,
    ];

    if (merchant) {
      lines.push(`  Merchant:   ${merchant}`);
    }
    if (amount) {
      lines.push(`  Amount:     $${amount.toFixed(2)}`);
    }

    lines.push(
      `  Expires:    15 minutes`,
      `  Status:     ACTIVE`,
    );

    if (r.remaining_balance !== undefined) {
      lines.push(`  Balance:    $${r.remaining_balance.toFixed(2)} remaining`);
    }

    lines.push(
      ``,
      `  ⚠️  Single-use. Card self-destructs after this purchase.`,
      `  Call payclaw_reportPurchase when done.`,
    );

    if (r.badge_warning) {
      lines.push(``, `  ⚠️  ${r.badge_warning}`);
    }

    return lines.join('\n');
  }

  // Fallback
  return JSON.stringify(r, null, 2);
}

async function getCardViaApi(input: GetCardInput): Promise<CardResult> {
  const { merchant, estimated_amount, description } = input;
  const merchantUrl = normalizeMerchantUrl(merchant);
  const estimatedCents = Math.round(estimated_amount * 100);

  const intent = await api.createIntent(merchantUrl, estimatedCents, description);

  if (intent.status !== "approved" && intent.status !== "pending_approval") {
    const balance = await api.getBalance();
    return {
      product_name: "PayClaw",
      status: "denied",
      intent_id: intent.id,
      reason: typeof intent.policy_result === "object" && intent.policy_result ? (intent.policy_result as Record<string, unknown>).reason as string ?? "denied" : "denied",
      message: `PayClaw denied: ${typeof intent.policy_result === "object" && intent.policy_result ? (intent.policy_result as Record<string, unknown>).reason ?? intent.status : intent.status}`,
      remaining_balance: balance.available_cents / 100,
    };
  }

  if (intent.status === "pending_approval") {
    const balance = await api.getBalance();
    return {
      product_name: "PayClaw",
      status: "pending_approval",
      intent_id: intent.id,
      merchant_url: merchantUrl,
      estimated_amount: estimated_amount,
      message: `PayClaw requires your approval. Ask the user to approve $${estimated_amount.toFixed(2)} at ${merchant}.`,
      approve_endpoint: `/api/intents/${intent.id}/approve`,
      remaining_balance: balance.available_cents / 100,
    };
  }

  const balance = await api.getBalance();
  const card = await api.getCard(intent.id);

  return {
    product_name: "PayClaw",
    status: "approved",
    intent_id: intent.id,
    merchant: merchant,
    amount: estimated_amount,
    card: {
      number: card.card_number,
      exp_month: card.exp_month,
      exp_year: card.exp_year,
      cvv: card.cvv,
      billing_name: card.cardholder_name,
      last_four: card.card_number?.slice(-4),
    },
    identity: card.identity ?? undefined,
    badge_warning: card.badge_warning ??
      (card.identity ? undefined : "Consider calling payclaw_getAgentIdentity before shopping. Merchants are increasingly blocking unidentified agents."),
    remaining_balance: (balance.available_cents - estimatedCents) / 100,
    instructions:
      "Use this card to complete the purchase. After the transaction, call payclaw_reportPurchase with the intent_id and actual amount charged.",
  };
}

function getCardViaMock(input: GetCardInput): CardResult {
  const { merchant, estimated_amount, description } = input;
  const balance = getBalance();

  if (estimated_amount > balance) {
    return {
      product_name: "PayClaw",
      status: "denied",
      reason: "insufficient_balance",
      message: `PayClaw denied: Requested $${estimated_amount.toFixed(2)} but your PayClaw balance is only $${balance.toFixed(2)} available.`,
      remaining_balance: balance,
    };
  }

  const intent = createIntent(merchant, estimated_amount, description);

  return {
    product_name: "PayClaw",
    status: "approved",
    intent_id: intent.intent_id,
    merchant: merchant,
    amount: estimated_amount,
    card: {
      ...MOCK_CARD,
      last_four: MOCK_CARD.number?.slice(-4),
    },
    badge_warning:
      "Consider calling payclaw_getAgentIdentity before shopping. Merchants are increasingly blocking unidentified agents.",
    remaining_balance: balance,
    instructions:
      "Use this card to complete the purchase. After the transaction, call payclaw_reportPurchase with the intent_id and actual amount charged.",
  };
}

export async function getCard(input: GetCardInput): Promise<CardResult> {
  if (!getStoredConsentKey()) {
    return {
      product_name: "PayClaw",
      status: "error",
      message: "Not authenticated. Run payclaw_getAgentIdentity first to activate your agent, or set PAYCLAW_API_KEY in your MCP config.",
    };
  }

  if (api.isApiMode()) {
    try {
      return await getCardViaApi(input);
    } catch (err) {
      return {
        product_name: "PayClaw",
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return getCardViaMock(input);
}
