import { createIntent, getBalance, MOCK_CARD } from "../mock/store.js";
import * as api from "../api/client.js";

export interface GetCardInput {
  merchant: string;
  estimated_amount: number;
  description: string;
}

async function getCardViaApi(input: GetCardInput): Promise<object> {
  const { merchant, estimated_amount, description } = input;
  const estimatedCents = Math.round(estimated_amount * 100);

  const balance = await api.getBalance();
  if (estimatedCents > balance.available_cents) {
    return {
      status: "denied",
      reason: "insufficient_balance",
      message: `Requested $${estimated_amount.toFixed(2)} but only $${(balance.available_cents / 100).toFixed(2)} available.`,
      remaining_balance: balance.available_cents / 100,
    };
  }

  const intent = await api.createIntent(merchant, estimatedCents, description);

  if (intent.status !== "approved") {
    return {
      status: "denied",
      reason: typeof intent.policy_result === "object" && intent.policy_result ? (intent.policy_result as Record<string, unknown>).reason ?? "denied" : "denied",
      message: `Intent denied: ${typeof intent.policy_result === "object" && intent.policy_result ? (intent.policy_result as Record<string, unknown>).reason ?? intent.status : intent.status}`,
      remaining_balance: balance.available_cents / 100,
    };
  }

  const card = await api.getCard(intent.id);

  return {
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
      status: "denied",
      reason: "insufficient_balance",
      message: `Requested $${estimated_amount.toFixed(2)} but only $${balance.toFixed(2)} available.`,
      remaining_balance: balance,
    };
  }

  const intent = createIntent(merchant, estimated_amount, description);

  return {
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
      status: "error",
      message: "PAYCLAW_API_KEY environment variable is not set.",
    };
  }

  if (api.isApiMode()) {
    try {
      return await getCardViaApi(input);
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return getCardViaMock(input);
}
