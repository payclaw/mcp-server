import { getIntent, updateIntent, deductBalance, getBalance } from "../mock/store.js";
import { randomUUID } from "crypto";
import * as api from "../api/client.js";

export interface ReportPurchaseInput {
  intent_id: string;
  success: boolean;
  actual_amount?: number;
  merchant_name?: string;
  items?: string;
  order_confirmation?: string;
}

async function reportViaApi(input: ReportPurchaseInput): Promise<object> {
  const { intent_id, success, actual_amount, merchant_name } = input;

  if (!success) {
    const tx = await api.reportTransaction(intent_id, merchant_name, undefined, 0);
    const balance = await api.getBalance();
    return {
      status: "recorded",
      intent_match: null,
      transaction_id: tx.id,
      remaining_balance: balance.available_cents / 100,
      message: "Purchase reported as failed. No amount deducted.",
    };
  }

  const amountCents = actual_amount != null ? Math.round(actual_amount * 100) : 0;
  const tx = await api.reportTransaction(intent_id, merchant_name, undefined, amountCents);
  const balance = await api.getBalance();

  return {
    status: "recorded",
    intent_match: tx.intent_match,
    ...(tx.intent_mismatch_reason && { intent_mismatch_reason: tx.intent_mismatch_reason }),
    transaction_id: tx.id,
    remaining_balance: balance.available_cents / 100,
    actual_amount: amountCents / 100,
  };
}

function reportViaMock(input: ReportPurchaseInput): object {
  const { intent_id, success, actual_amount, merchant_name, items, order_confirmation } = input;

  const intent = getIntent(intent_id);
  if (!intent) {
    return {
      status: "error",
      message: `Intent ${intent_id} not found.`,
    };
  }

  if (intent.status !== "pending") {
    return {
      status: "error",
      message: `Intent ${intent_id} has already been reported (status: ${intent.status}).`,
    };
  }

  if (!success) {
    intent.status = "failed";
    updateIntent(intent);
    return {
      status: "recorded",
      intent_match: null,
      transaction_id: randomUUID(),
      remaining_balance: getBalance(),
      message: "Purchase reported as failed. No amount deducted.",
    };
  }

  const charged = actual_amount ?? intent.estimated_amount;
  const tolerance = intent.estimated_amount * 0.2;
  const diff = Math.abs(charged - intent.estimated_amount);
  const intent_match = diff <= tolerance ? "match" : "mismatch";

  deductBalance(charged);
  intent.status = "completed";
  intent.actual_amount = charged;
  updateIntent(intent);

  return {
    status: "recorded",
    intent_match,
    transaction_id: randomUUID(),
    remaining_balance: getBalance(),
    ...(merchant_name && { merchant_name }),
    ...(items && { items }),
    ...(order_confirmation && { order_confirmation }),
    estimated_amount: intent.estimated_amount,
    actual_amount: charged,
  };
}

export async function reportPurchase(input: ReportPurchaseInput): Promise<object> {
  if (api.isApiMode()) {
    try {
      return await reportViaApi(input);
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return reportViaMock(input);
}
