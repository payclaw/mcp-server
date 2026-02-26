import { PaymentIntent, MockCard } from "../types.js";
import { randomUUID } from "crypto";

const STARTING_BALANCE = 500;

let balance = STARTING_BALANCE;
const intents = new Map<string, PaymentIntent>();

export const MOCK_CARD: MockCard = {
  number: "4242424242424242",
  exp_month: 12,
  exp_year: 2028,
  cvv: "123",
  billing_name: "Test User",
  billing_address: {
    line1: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    country: "US",
  },
};

export function getBalance(): number {
  return balance;
}

export function deductBalance(amount: number): void {
  balance -= amount;
}

export function createIntent(
  merchant: string,
  estimated_amount: number,
  description: string
): PaymentIntent {
  const intent: PaymentIntent = {
    intent_id: randomUUID(),
    merchant,
    estimated_amount,
    description,
    status: "pending",
    created_at: Date.now(),
  };
  intents.set(intent.intent_id, intent);
  return intent;
}

export function getIntent(intent_id: string): PaymentIntent | undefined {
  return intents.get(intent_id);
}

export function updateIntent(intent: PaymentIntent): void {
  intents.set(intent.intent_id, intent);
}
