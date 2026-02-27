# @payclaw/mcp-server

The PayClaw MCP server lets AI agents make real purchases using disposable virtual cards — without ever touching your real credit card.

[![npm version](https://img.shields.io/npm/v/@payclaw/mcp-server.svg)](https://www.npmjs.com/package/@payclaw/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What is PayClaw?

PayClaw issues virtual cards for AI agents with spend limits, merchant restrictions, and intent-based authorization. When your agent needs to buy something, it declares what it wants, PayClaw checks the rules, and issues a scoped card. Your real card is never involved.

## Quick Start

### 1. Get your API key

Sign up at [payclaw.io](https://payclaw.io) and generate an API key from your dashboard.

### 2. Install

```bash
npm install -g @payclaw/mcp-server
```

### 3. Configure

Add PayClaw to your MCP client config.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "payclaw": {
      "command": "npx",
      "args": ["@payclaw/mcp-server"],
      "env": {
        "PAYCLAW_API_KEY": "pk_live_your_key_here",
        "PAYCLAW_API_URL": "https://payclaw.io"
      }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "payclaw": {
      "command": "npx",
      "args": ["@payclaw/mcp-server"],
      "env": {
        "PAYCLAW_API_KEY": "pk_live_your_key_here",
        "PAYCLAW_API_URL": "https://payclaw.io"
      }
    }
  }
}
```

**OpenClaw** (via ClawHub):

```bash
clawhub install payclaw
```

### 4. Use it

Tell your agent to buy something. That's it.

> "Buy me two large pepperoni pizzas from Domino's, keep it under $30."

The agent will call `payclaw_getCard`, get a virtual card, complete checkout, and report back.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PAYCLAW_API_KEY` | ✅ | Your API key from the PayClaw dashboard (`pk_live_...` or `pk_test_...`) |
| `PAYCLAW_API_URL` | optional | PayClaw API URL (`https://payclaw.io` for production). If omitted, runs in offline mock mode. |

> **Offline/dev mode:** If `PAYCLAW_API_URL` is not set, the server runs with a local mock store ($500 starting balance, fake card). Useful for testing MCP integration without a PayClaw account.

---

## Tools

### `payclaw_getCard`

Request a virtual card for making a purchase. The agent must declare what it intends to buy.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `merchant` | string | ✅ | Merchant website or name (e.g., `"dominos.com"`) |
| `estimated_amount` | number | ✅ | Estimated purchase amount in USD (e.g., `25.00`) |
| `description` | string | ✅ | What you're buying (e.g., `"2 large pepperoni pizzas"`) |

**Returns:**

```json
{
  "status": "approved",
  "card": {
    "number": "4xxx xxxx xxxx 1234",
    "exp_month": 12,
    "exp_year": 2028,
    "cvv": "123",
    "billing_name": "PAYCLAW USER"
  },
  "intent_id": "int_abc123",
  "remaining_balance": 475.00,
  "instructions": "Use this card to complete the purchase. After the transaction, call payclaw_reportPurchase with the intent_id and actual amount charged."
}
```

**Possible statuses:**
- `approved` — card issued, proceed with purchase
- `pending_approval` — user confirmation required (Always Ask mode); prompt the user to approve the spend in their PayClaw dashboard, then retry
- `denied` — policy check failed (insufficient balance, merchant not whitelisted, etc.)
- `error` — configuration issue (missing API key, API unreachable, etc.)

### `payclaw_reportPurchase`

Report the outcome after completing a purchase. This creates the audit trail.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intent_id` | string | ✅ | The `intent_id` from `getCard` |
| `success` | boolean | ✅ | Whether the purchase completed |
| `actual_amount` | number | | Actual amount charged |
| `merchant_name` | string | | Merchant name on receipt |
| `items` | string | | What was purchased |
| `order_confirmation` | string | | Order/confirmation number |

**Returns:**

```json
{
  "status": "recorded",
  "intent_match": true,
  "transaction_id": "txn_abc123",
  "remaining_balance": 451.53,
  "actual_amount": 23.47
}
```

---

## How It Works

```
You: "Buy me a pizza from Domino's, about $25"
         │
         ▼
Agent calls payclaw_getCard({
  merchant: "dominos.com",
  estimated_amount: 25.00,
  description: "Pizza order"
})
         │
         ▼
PayClaw checks:
  ✅ Balance sufficient?
  ✅ Merchant on whitelist?
  ✅ Within spend limits?
         │
         ▼
Virtual card issued → Agent completes checkout
         │
         ▼
Agent calls payclaw_reportPurchase({
  intent_id: "int_abc123",
  success: true,
  actual_amount: 23.47,
  items: "2 Large Pepperoni Pizzas"
})
         │
         ▼
PayClaw auto-audits: declared vs actual ✅ match
Transaction logged to your dashboard
```

## Security

- **Your real card is never exposed.** Agents operate on isolated virtual cards with capped balances.
- **Intent-based authorization.** Agents must declare what they're buying before card access is granted.
- **Post-purchase audit.** Every transaction is auto-compared against the declared intent. Mismatches are flagged.
- **Mandatory MFA.** All accounts require authenticator app (TOTP) — no exceptions.
- **API keys are hashed, not stored.** Same approach as Stripe. [Read our security docs →](https://payclaw.io/docs/security)
- **$500 balance ceiling.** Maximum exposure per account is hard-capped.
- **Instant revocation.** Kill your API key or freeze your card from the dashboard at any time.
- **Built on PCI-compliant infrastructure.** Card credentials are never stored on PayClaw servers.

## Compatibility

Works with any MCP-compatible client:

- ✅ Claude Desktop
- ✅ Cursor
- ✅ OpenClaw (via ClawHub)
- ✅ Any MCP client supporting stdio transport

## Development

```bash
# Clone the repo
git clone https://github.com/payclaw/mcp-server.git
cd mcp-server
npm install

# Run with mock store (no PayClaw account needed)
PAYCLAW_API_KEY=pk_test_anything npm run dev

# Run against real API
PAYCLAW_API_KEY=pk_live_your_key PAYCLAW_API_URL=https://payclaw.io npm run dev

# Build
npm run build
```

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE) for details.

---

**PayClaw** — Virtual cards for AI agents. [payclaw.io](https://payclaw.io)
