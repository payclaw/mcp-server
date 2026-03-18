# kya labs — Badge + Spend for AI Agents

**Your agent isn't a bot. kya proves it — then lets it pay.**

Your AI agent looks like a bot to every merchant on the internet. kya gives it two things:

**Badge** — Declares your agent as an authorized actor. The Universal Commerce Protocol "identity" token for a merchant handshake. Free. No card required.

**Spend** — Issues a single-use virtual Visa when your agent needs to pay. Human-approved. Self-destructs after use. Your real card never enters the chat.

If you're like 20% of Americans last year - you used an agent to shop. And you probably ran into a ton of login walls, workarounds, bumps?

So did we. So we created kya - the first MCP tool suite that works with the new Universal Commerce Protocol to easily handshake verified agents at supporting merchants (Shopify, Target, Walmart, Etsy... it's a lot). Badge for identity. Spend for payment.

> 🧪 **Developer Sandbox is open.** Real infrastructure, test money. [Get sandbox access →](https://www.kyalabs.io)

[![npm version](https://img.shields.io/npm/v/@kyalabs/mcp-server.svg)](https://www.npmjs.com/package/@kyalabs/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<a href="https://glama.ai/mcp/servers/@kyalabs/kyalabs-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@kyalabs/kyalabs-mcp/badge" alt="payclaw-mcp MCP server" />
</a>

---

## Quick Start

```bash
npx @kyalabs/mcp-server
```

OR add to your MCP client config (Claude Desktop, Cursor, or any MCP client):

```json
{
  "mcpServers": {
    "kyalabs": {
      "command": "npx",
      "args": ["@kyalabs/mcp-server"]
    }
  }
}
```

That's it. Badge works immediately — no API key, no signup, no network calls on install.

The first time your agent calls `kya_getAgentIdentity`, it declares itself to the merchant and gets back a response with `next_step` guidance. One anonymous event is recorded. Your agent is now a declared, authorized actor.

Or install via ClawHub:
```bash
clawhub install payclaw-io
```

### Upgrade to verified mode + Spend

For cryptographic identity and virtual card issuance, add an API key:

```json
"env": {
  "KYA_API_KEY": "pk_live_your_key_here",
  "KYA_API_URL": "https://www.kyalabs.io"
}
```

Get your API key at [kyalabs.io/signup](https://www.kyalabs.io/signup). API keys don't expire.

Without an API key, Badge uses device auth when a merchant requires verified identity — your agent shows a code and URL, you approve on your phone. This only happens when a merchant asks for it. We never ask for it ourselves. Sign up + API key means 1. you dont have to use phone OAuth every time and 2. you can track your agentic shopping (custom avatars included)

### Node version

kya MCP requires **Node.js 20 or newer**. Node 18 is end-of-life and unsupported.

If you see engine or compatibility errors: `node -v` — install Node 20+ from [nodejs.org](https://nodejs.org/) or `nvm install 20`

---

## How Badge Works: Two Modes

### Declared (default)

First time your agent goes to a merchant with Badge, Badge generates an anonymous install ID — a random UUID stored locally at `~/.kya/install_id`. It has no connection to you, your device, or any personal information.

Your agent gets back a declaration and a `next_step` guiding it to report its badge presentation at the merchant.

This is the default mode. It's how Badge works out of the box, for every user, forever.

### Verified (when merchant requires it)

When a merchant requires verified identity — their UCP manifest says `required: true` — your agent will ask you to approve a device flow. You visit a merchant-kya URL, enter the OAuth code from your agent, and prove you're a real person.

Badge issues a tokenized credential: an ES256-signed JWT, signed by kya's private key, verifiable locally by the merchant. Your agent is free to continue - no login, PII or anything needed.

---

## Our Data Philosophy

| When | What | Why |
|------|------|-----|
| **On install** | Nothing | We help agents shop. If they're not shopping, we don't need anything |
| **On first tool call** | install_id (random UUID), merchant, agent_type, event_type, timestamp | Minimum viable signal to reduce agent friction at merchants and with labs |
| **On verified identity** | + hashed user token, intent scope (checkout, etc.) | Only required where login traditionally required (i.e. checkout) to prove there's a real person authorizing the agent's next step |
| **On Spend (card issuance)** | + full transaction trail: intent, amount, merchant, audit log | Card network compliance, gated behind consent + MFA |

The install_id is a file we wrote to your disk. You can delete it (`rm ~/.kya/install_id`) and get a new one.

Full data practices: [kyalabs.io/trust](https://www.kyalabs.io/trust)

---

## The Universal Commerce Protocol

Badge is a [UCP (Universal Commerce Protocol)](https://ucp.dev) Credential Provider. Merchants who declare the kya identity extension signal to every UCP-compliant agent that authorized agents are preferred at their store.

When your agent encounters a UCP merchant with Badge installed, it presents a cryptographic badge automatically — no extra steps.

We believe the UCP is the future of commerce and are proud to support reduce friction for agents and users.

- Extension spec + schema: [github.com/kyalabs/ucp-agent-badge](https://github.com/kyalabs/ucp-agent-badge)
- Read more about the UCP: [github.com/universal-commerce-protocol/ucp](https://github.com/universal-commerce-protocol/ucp)

**Without kya:** Agent browses → bot detection fires → blocked. Even if it gets through, it can't check out without your real card number. You're stuck finishing manually.

**With Badge:** Agent declares itself as an authorized actor → merchants see a verified identity → agent gets through. No bypass. Just proof.

**With Spend:** Agent declares a purchase → you approve with a tap → kya issues a single-use virtual Visa locked to that merchant → agent checks out → card self-destructs. Your real card never enters the chat.

Your agent will recognize when it needs this. When it encounters a merchant that may challenge automated traffic, or when it's ready to check out, it tells you: "I need kya installed to complete this." You click Allow. Done.

---

## Tools

See [docs/tool-contract.md](docs/tool-contract.md) for the formal input/output contract.

| Tool | What It Does |
|------|-------------|
| `kya_getAgentIdentity` | Declare identity → get verification token + `next_step` guidance (Badge) |
| `kya_reportBadgePresented` | Record that you presented your badge at a merchant |
| `kya_reportBadgeOutcome` | Report how the merchant responded (accepted, denied, inconclusive) |
| `kya_reportBadgeNotPresented` | Report that you did not present your badge (abandoned, merchant didn't ask) |
| `kya_getCard` | Declare purchase intent → get virtual Visa (Spend) |
| `kya_reportPurchase` | Report transaction outcome → close the audit trail |

Every Badge tool call works immediately — no auth required. Events fire in both anonymous and verified modes.

### Badge: Declare Identity

```
Agent → kya_getAgentIdentity({ merchantUrl })
kya → browse_declared event fires automatically
kya → verification token + next_step + checkoutPatch (if merchant supports UCP)
Agent → merges checkoutPatch into checkout payload
Agent → kya_reportBadgePresented({ merchantUrl, verification_token })
Agent → kya_reportBadgeOutcome (accepted | denied | inconclusive)
```

### Spend: Get a Card

```
Agent → kya_getCard (merchant, amount, description)
User → approves via MFA
kya → issues single-use virtual Visa
Agent → uses card at checkout
Agent → kya_reportPurchase (closes audit trail)
Card → self-destructs
```

One task. One approval. One card. Done.

### Extended Auth (optional)

When enabled, kya checks back with your agent 7 seconds after each badge presentation to confirm whether the merchant accepted or denied. Results are logged to your dashboard so you can see when and which merchants are rejecting your agent.

```json
"env": {
  "KYA_EXTENDED_AUTH": "true"
}
```

---

## How Authorization Scales

| Action | What Happens |
|--------|-------------|
| **Browse** | Badge declaration — identity token issued |
| **Search** | Badge declaration — identity token issued |
| **Checkout** | Badge + Spend — MFA approval → single-use Visa issued |

Browsing requires declaration. Spending money requires declaration + stated intent + explicit human approval + an ephemeral card that self-destructs after one use.

---

## Why kya labs

| | Give Agent Your Card | Crypto Wallet | **kya** |
|---|---------------------|---------------|------------|
| Agent identity declared | No | No | **Every session** |
| Human approval per purchase | No | No | **Every purchase** |
| Card credential lifespan | Permanent | Permanent | **Single use** |
| Works at existing merchants | Yes | No | **Yes — Visa rails** |
| Your real card exposed | Yes | N/A | **Never** |

---

## Badge Only?

If you only need identity (no payment), use the lighter package:

```bash
npx @kyalabs/badge
```

---

## What's New (v2.3)

| Capability | Description |
|---|---|
| `assurance_level` | Every trip now carries a trust score (`starter` → `elite`) sourced from token introspection. Visible in your dashboard and included in all trip outcome events. |
| Merchant signal awareness | `kya_getAgentIdentity` now detects whether a merchant has active kya signal infrastructure (`window.__kya_commerce`, meta tags, llms.txt). Returned as `merchant_signals` in the identity result. |
| Anonymous-first | Badge works on install. No auth, no signup, no network on install. First `kya_getAgentIdentity` call fires `browse_declared` automatically. |
| Enrichment branching | Anonymous events fire without auth. Verified events include full user context. No silent gates. |
| `next_step` field | Every identity response includes guidance for the agent's next action. Spend-aware when virtual cards are available. |

---

## KYA — Know Your Agent

kya is KYA infrastructure. Every declaration creates a verified record of agentic commerce behavior — building the trust signal that merchants need to tell authorized agents from anonymous bots.

## Links

- **Website:** [kyalabs.io](https://www.kyalabs.io)
- **npm:** [@kyalabs/mcp-server](https://www.npmjs.com/package/@kyalabs/mcp-server)
- **Badge npm:** [@kyalabs/badge](https://www.npmjs.com/package/@kyalabs/badge)
- **UCP Extension:** [github.com/kyalabs/ucp-agent-badge](https://github.com/kyalabs/ucp-agent-badge)
- **ClawHub:** [payclaw-io](https://clawhub.com/skills/payclaw-io)
- **Trust:** [kyalabs.io/trust](https://www.kyalabs.io/trust)
- **Merchants:** [kyalabs.io/merchants](https://www.kyalabs.io/merchants)
- **Contact:** agent_identity@kyalabs.io

---

*Agents are not bots. kya labs proves it.*
*Your real card never enters the chat.*
