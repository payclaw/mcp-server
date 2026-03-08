# PayClaw MCP Tool Contract

Formal input/output contract for MCP tools in `@payclaw/mcp-server` and `@payclaw/badge`. Update this doc when tool inputs, outputs, or auth requirements change.

---

## Auth

- **API key (recommended):** Set `PAYCLAW_API_KEY` (`pk_live_*` or `pk_test_*`). Permanent — does not expire. Get one at [payclaw.io/dashboard/keys](https://www.payclaw.io/dashboard/keys). MCP calls `POST /api/agent-identity` with `Authorization: Bearer pk_...`.
- **Device flow (quick start):** No API key needed. OAuth device flow via `POST /api/oauth/device/authorize` and `POST /api/oauth/token`. Consent key stored after user approves at `/activate`. Sessions are temporary — switch to an API key for permanent access.
- **Extended Auth:** Set `PAYCLAW_EXTENDED_AUTH=true` so your agent confirms whether the merchant accepted or denied. Responses are logged to your dashboard so you can see visibility of your token by merchant. Default: agent reports via payclaw_reportBadgeOutcome.

---

## @payclaw/mcp-server (Badge + Spend)

### payclaw_getAgentIdentity

**Input:** `{ merchant?: string, merchantUrl?: string }` — Optional merchant name or base URL. When `merchantUrl` is provided, PayClaw fetches the merchant's `/.well-known/ucp` manifest and returns a `checkoutPatch` if `io.payclaw.common.identity` is declared.

**Output:** Text + JSON. Keys include `verification_token`, `agent_disclosure`, `assurance_level`, `ucpCapable`, `checkoutPatch` (when UCP-capable). If `activation_required`, user must complete device flow at `/activate`.

**App route:** `POST /api/agent-identity` (with Bearer token after auth).

---

### payclaw_reportBadgePresented

**Input:** `{ verification_token: string, merchant?: string, merchantUrl?: string, context?: "arrival" | "addtocart" | "checkout" | "other", checkoutSessionId?: string }` — Token from getAgentIdentity; `merchantUrl` (preferred) or `merchant` (at least one required); optional context; optional UCP checkout session ID.

**Output:** `{ recorded: true }` JSON in first content block + text confirmation. Starts outcome tracking. When Extended Auth is enabled, PayClaw checks back 7 seconds later. Otherwise, agent reports via payclaw_reportBadgeOutcome.

**App route:** `POST /api/badge/report` (with optional `presentation_context`).

---

### payclaw_reportBadgeNotPresented

**Input:** `{ verification_token: string, merchant: string, reason: "abandoned" | "merchant_didnt_ask" | "other" }` — Token; merchant where agent did not present; reason why.

**Output:** Text confirmation. Logs that badge was not presented.

**App route:** `POST /api/badge/report` (event_type: badge_not_presented).

---

### payclaw_reportBadgeOutcome

**Input:** `{ verification_token: string, merchant: string, outcome: "accepted" | "denied" | "inconclusive" }` — How the merchant responded when the agent presented the badge.

**Output:** Text confirmation. Agent-only path — no sampling prompt. Use when Extended Auth is disabled, or to report earlier than the 7-second confirmation.

**App route:** `POST /api/badge/report` (event_type: trip_success or trip_failure).

---

### payclaw_getCard

**Input:** `{ merchant: string, estimated_amount: number, description: string }` — Merchant, USD amount (max 500), purchase description.

**Output:** Text + JSON. Keys include `intent_id`, card details (number, expiry, cvv) when approved.

**App routes:** `POST /api/intents` → user approves → `GET /api/cards?intent_id=...`.

---

### payclaw_reportPurchase

**Input:** `{ intent_id: string, success: boolean, actual_amount?: number, merchant_name?: string, items?: string, order_confirmation?: string }`.

**Output:** JSON result. Closes audit trail.

**App route:** Internal (reconciliation).

---

## @payclaw/badge (Badge only)

Same tool signatures as mcp-server (synced since 0.7, PRD-3 parameters added in 0.8.0).

### payclaw_getAgentIdentity

**Input:** `{ merchant?: string, merchantUrl?: string }` — identical to mcp-server.

### payclaw_reportBadgePresented

**Input:** `{ verification_token: string, merchant?: string, merchantUrl?: string, context?: string, checkoutSessionId?: string }` — identical to mcp-server.

### payclaw_reportBadgeOutcome

**Input:** `{ verification_token: string, merchant: string, outcome: "accepted" | "denied" | "inconclusive" }` — report whether merchant accepted or denied the badge.

### payclaw_reportBadgeNotPresented

**Input:** `{ verification_token: string, merchant: string, reason: "abandoned" | "merchant_didnt_ask" | "other" }` — report that the badge was not presented.

### verify() (merchant-side)

**Import:** `import { verify } from '@payclaw/badge/verify'`

**Input:** `verify(token: string, options?: VerifyOptions)` — ES256 JWT verification via JWKS.

**Output:** `PayClawIdentity | null` — never throws. Returns `null` on any failure.

---

## References

- [app/docs/internal/api-overview.md](../../app/docs/internal/api-overview.md) — API routes
- [app/docs/1.0-state/04-mcp-servers.md](../../app/docs/1.0-state/04-mcp-servers.md) — Flows
