# PayClaw — Badge + Spend for AI Agents

**Agents are not bots. PayClaw proves it — then lets them pay.**

Your AI agent looks like a bot to every merchant on the internet. PayClaw gives it two things:

**Badge** — Declares your agent as an authorized actor. The skeleton key that lets it through merchant defenses. Free. No card required.

**Spend** — Issues a single-use virtual Visa when your agent needs to pay. Human-approved. Self-destructs after use. Your real card never enters the chat.

> 🧪 **Developer Sandbox is open.** Real infrastructure, test money. [Get sandbox access →](https://payclaw.io)

[![npm version](https://img.shields.io/npm/v/@payclaw/mcp-server.svg)](https://www.npmjs.com/package/@payclaw/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<a href="https://glama.ai/mcp/servers/@payclaw/payclaw-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@payclaw/payclaw-mcp/badge" alt="payclaw-mcp MCP server" />
</a>

---

## Quick Start

Add to your MCP client config (Claude Desktop, Cursor, or any MCP client):

```json
{
  "mcpServers": {
    "payclaw": {
      "command": "npx",
      "args": ["-y", "@payclaw/mcp-server"],
      "env": {
        "PAYCLAW_API_URL": "https://api.payclaw.io"
      }
    }
  }
}
```

No API key required. On first use, your agent will show a code and URL — approve on your phone, and your Consent Key is stored. Optional: set `PAYCLAW_API_KEY` for existing accounts (backward compatible).

Or install via ClawHub:
```bash
clawhub install payclaw-io
```

### Node version

PayClaw MCP requires **Node.js 20 or newer**. Node 18 is end-of-life and unsupported.

If you see engine or compatibility errors:

- Check: `node -v`
- Install Node 20+: [nodejs.org](https://nodejs.org/) or `nvm install 20`

---

## UCP Identity Linking

PayClaw Badge is a [UCP (Universal Commerce Protocol)](https://ucp.dev) Credential Provider. Merchants who declare the PayClaw identity extension signal to every UCP-compliant agent that authorized agents are preferred at their store.

When your agent encounters a UCP merchant with PayClaw installed, it presents a cryptographic badge automatically — no extra steps.

- Extension spec + schema: [github.com/payclaw/ucp-agent-badge](https://github.com/payclaw/ucp-agent-badge)
- Merchant documentation: [payclaw.io/merchants](https://payclaw.io/merchants)

## Why Your Agent Needs This

Your agent can browse, compare, build carts, and find the best deals. But it can't finish the job — because to every merchant, it looks like a bot.

**Without PayClaw:** Agent browses → bot detection fires → blocked. Even if it gets through, it can't check out without your real card number. You're stuck finishing manually.

**With Badge:** Agent declares itself as an authorized actor → merchants see a verified identity → agent gets through. No bypass. Just proof.

**With Spend:** Agent declares a purchase → you approve with a tap → PayClaw issues a single-use virtual Visa locked to that merchant → agent checks out → card self-destructs. Your real card never enters the chat.

Your agent will recognize when it needs this. When it encounters a merchant that may challenge automated traffic, or when it's ready to check out, it tells you: "I need PayClaw installed to complete this." You click Allow. Done.

---

## Tools

See [docs/tool-contract.md](docs/tool-contract.md) for the formal input/output contract.

| Tool | What It Does |
|------|-------------|
| `payclaw_getAgentIdentity` | Declare identity → get verification token (Badge) |
| `payclaw_getCard` | Declare purchase intent → get virtual Visa (Spend) |
| `payclaw_reportPurchase` | Report transaction outcome → close the audit trail |

### Badge: Declare Identity

```
Agent → payclaw_getAgentIdentity
PayClaw → verification token + disclosure text
Agent → presents disclosure to merchant
PayClaw → checks back: "Were you accepted or denied?"
```

Your agent is now a declared, authorized actor. Not anonymous traffic.

### Spend: Get a Card

```
Agent → payclaw_getCard (merchant, amount, description)
User → approves via MFA
PayClaw → issues single-use virtual Visa
Agent → uses card at checkout
Agent → payclaw_reportPurchase (closes audit trail)
Card → self-destructs
```

One task. One approval. One card. Done.

---

## How Authorization Scales

| Action | What Happens |
|--------|-------------|
| **Browse** | Badge declaration — identity token issued |
| **Search** | Badge declaration — identity token issued |
| **Checkout** | Badge + Spend — MFA approval → single-use Visa issued |

Browsing requires declaration. Spending money requires declaration + stated intent + explicit human approval + an ephemeral card that self-destructs after one use.

---

## Why PayClaw

| | Give Agent Your Card | Crypto Wallet | **PayClaw** |
|---|---------------------|---------------|------------|
| Agent identity declared | No | No | **Every session** |
| Human approval per purchase | No | No | **Every purchase** |
| Card credential lifespan | Permanent | Permanent | **Single use** |
| Works at existing merchants | Yes | No | **Yes — Visa rails** |
| Your real card exposed | Yes | N/A | **Never** |

---

## Badge Only?

If you only need identity (no payment), use the lighter package:

```json
{
  "mcpServers": {
    "payclaw-badge": {
      "command": "npx",
      "args": ["-y", "@payclaw/badge"],
      "env": {
        "PAYCLAW_API_URL": "https://api.payclaw.io"
      }
    }
  }
}
```

---

## KYA — Know Your Agent

PayClaw is KYA infrastructure. Every declaration creates a verified record of agentic commerce behavior — building the trust signal that merchants need to tell authorized agents from anonymous bots.

- [Trust & Verification](https://payclaw.io/trust) — The full trust architecture
- [Dashboard](https://payclaw.io/dashboard/badge) — Your agent's Verified Trips

---

## Links

- **Website:** [payclaw.io](https://payclaw.io)
- **npm:** [@payclaw/mcp-server](https://www.npmjs.com/package/@payclaw/mcp-server)
- **Badge npm:** [@payclaw/badge](https://www.npmjs.com/package/@payclaw/badge)
- **UCP Extension:** [github.com/payclaw/ucp-agent-badge](https://github.com/payclaw/ucp-agent-badge)
- **ClawHub:** [payclaw-io](https://clawhub.com/skills/payclaw-io)
- **Trust:** [payclaw.io/trust](https://payclaw.io/trust)
- **Merchants:** [payclaw.io/merchants](https://payclaw.io/merchants)
- **Contact:** agent_identity@payclaw.io
- **Security:** security@payclaw.io

---

*Agents are not bots. PayClaw proves it.*
*Your real card never enters the chat.*