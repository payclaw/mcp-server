import { createIntent, getBalance, MOCK_CARD } from "../mock/store.js";
import * as api from "../api/client.js";

export interface GetCardInput {
  merchant: string;
  estimated_amount: number;
  description: string;
}

/**
 * Minimal merchant normalization — add https:// if no protocol present.
 *
 * The merchant field is human-readable intent text, not a validated URL.
 * The user reads and approves it before any card is issued. Lithic captures
 * the actual merchant at authorization time. Heavy URL normalization adds
 * complexity with no security or UX benefit.
 *
 * See DQ-35.
 */
function normalizeMerchantUrl(merchant: string): string {
  const trimmed = merchant.trim().replace(/^\/\//, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

async function getCardViaApi(input: GetCardInput): Promise<object> {
  const { merchant, estimated_amount, description } = input;
  const merchantUrl = normalizeMerchantUrl(merchant);
  const estimatedCents = Math.round(estimated_amount * 100);

  // Always create the intent — let the server-side policy engine decide.
  // This ensures denied intents are recorded in the database and visible
  // in the user's dashboard activity feed.
  const intent = await api.createIntent(merchantUrl, estimatedCents, description);

  if (intent.status !== "approved" && intent.status !== "pending_approval") {
    const balance = await api.getBalance();
    return {
      product_name: "PayClaw",
      status: "denied",
      intent_id: intent.id,
      reason: typeof intent.policy_result === "object" && intent.policy_result ? (intent.policy_result as Record<string, unknown>).reason ?? "denied" : "denied",
      message: `PayClaw denied: ${typeof intent.policy_result === "object" && intent.policy_result ? (intent.policy_result as Record<string, unknown>).reason ?? intent.status : intent.status}`,
      remaining_balance: balance.available_cents / 100,
    };
  }

  // V1: Intent comes back as pending_approval — agent needs user to approve
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
    card: {
      number: card.card_number,
      exp_month: card.exp_month,
      exp_year: card.exp_year,
      cvv: card.cvv,
      billing_name: card.cardholder_name,
    },
    remaining_balance: (balance.available_cents - estimatedCents) / 100,
    instructions:
      "Use this card to complete the purchase. After the transaction, call payclaw_reportPurchase with the intent_id and actual amount charged.",
  };
}

function getCardViaMock(input: GetCardInput): object {
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
    card: MOCK_CARD,
    remaining_balance: balance,
    instructions:
      "Use this card to complete the purchase. After the transaction, call payclaw_reportPurchase with the intent_id and actual amount charged.",
  };
}

export async function getCard(input: GetCardInput): Promise<object> {
  if (!process.env.PAYCLAW_API_KEY) {
    return {
      product_name: "PayClaw",
      status: "error",
      message: "PAYCLAW_API_KEY environment variable is not set.",
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
