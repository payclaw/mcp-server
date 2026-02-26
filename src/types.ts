export interface BillingAddress {
  line1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface MockCard {
  number: string;
  exp_month: number;
  exp_year: number;
  cvv: string;
  billing_name: string;
  billing_address: BillingAddress;
}

export type IntentStatus = "pending" | "completed" | "failed";

export interface PaymentIntent {
  intent_id: string;
  merchant: string;
  estimated_amount: number;
  description: string;
  status: IntentStatus;
  actual_amount?: number;
  created_at: number;
}

// --- API response types ---

export interface ApiIntentResponse {
  id: string;
  status: string;
  merchant_url: string;
  estimated_amount_cents: number;
  policy_result: Record<string, unknown> | null;
  created_at: string;
}

export interface ApiCardResponse {
  card_number: string;
  exp_month: number;
  exp_year: number;
  cvv: string;
  last_four: string;
  cardholder_name: string;
  intent_id: string;
}

export interface ApiTransactionResponse {
  id: string;
  intent_id: string;
  amount_cents: number;
  intent_match: boolean | null;
  intent_mismatch_reason: string | null;
  status: string;
}

export interface ApiBalanceResponse {
  balance_cents: number;
  held_cents: number;
  available_cents: number;
  balance_limit_cents: number;
}
