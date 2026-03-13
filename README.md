# kyaLabs — Badge + Spend for AI Agents

**Agents are not bots. kyaLabs proves it — then lets them pay.**

Your AI agent looks like a bot to every merchant on the internet. kyaLabs gives it two things:

**Badge** — Declares your agent as an authorized actor. The Universal Commerce Protocol "identity" token for a merchant handshake. Free. No card required.

**Spend** — Issues a single-use virtual Visa when your agent needs to pay. Human-approved. Self-destructs after use. Your real card never enters the chat.

> 🧪 **Developer Sandbox is open.** Real infrastructure, test money. [Get sandbox access →](https://www.kyalabs.io)

[![npm version](https://img.shields.io/npm/v/@kyalabs/mcp-server.svg)](https://www.npmjs.com/package/@kyalabs/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<a href="https://glama.ai/mcp/servers/@kyalabs/kyalabs-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@kyalabs/kyalabs-mcp/badge" alt="payclaw-mcp MCP server" />
</a>

---

## Quick Start

Add to your MCP client config (Claude Desktop, Cursor, or any MCP client):

```json
{
  "mcpServers": {
    "payclaw": {
      "command": "npx",
      "args": ["-y", "@kyalabs/mcp-server"],
      "env": {
        "PAYCLAW_API_KEY": "pk_live_your_key_here",
        "PAYCLAW_API_URL": "https://www.kyalabs.io"
      }
    }
  }
}
```

Get your API key at [kyalabs.io/dashboard/keys](https://www.kyalabs.io/dashboard/keys). API keys don't expire.

### Try without an account

Want to try kyaLabs before creating an account? Omit `PAYCLAW_API_KEY` — on first use, your agent will show a verification code and URL. Approve on your phone to get a temporary session. When you're ready for a permanent setup, create an account and generate an API key.

### Extended Auth (optional)

When and where merchants request your token, your agent confirms whether the merchant accepted or denied. Responses are logged to your dashboard so you can see visibility of your token by merchant.

Enable with `PAYCLAW_EXTENDED_AUTH=true`:

```json
"env": {
  "PAYCLAW_API_URL": "https://www.kyalabs.io",
  "PAYCLAW_EXTENDED_AUTH": "true"
}
```

Without it, your agent reports outcomes via `payclaw_reportBadgeOutcome` when it knows the result.

Or install via ClawHub:
```bash
clawhub install payclaw-io
```

### Node version

kyaLabs MCP requires **Node.js 20 or newer**. Node 18 is end-of-life and unsupported.

If you see engine or compatibility errors:

- Check: `node -v`
- Install Node 20+: [nodejs.org](https://nodejs.org/) or `nvm install 20`

---

## UCP Identity Linking

Badge by kyaLabs is a [UCP (Universal Commerce Protocol)](https://ucp.dev) Credential Provider. Merchants who add `io.kyalabs.common.identity` to their `/.well-known/ucp` manifest signal that authorized agents are preferred at their store.

When your agent calls `payclaw_getAgentIdentity` with a `merchantUrl`, kyaLabs fetches the merchant's manifest, checks for the kyaLabs identity extension, and returns a `checkoutPatch` the agent merges into the checkout payload. If the merchant doesn't support UCP, a valid token is still returned — nothing breaks.

Merchants verify badges locally using JWKS published at `kyalabs.io/.well-known/ucp` — standard ES256 signature verification, no API call to kyaLabs. See the [reference implementation](https://github.com/kyalabs/ucp-agent-badge/tree/main/reference) in the UCP extension spec.

- Extension spec + schema: [github.com/kyalabs/ucp-agent-badge](https://github.com/kyalabs/ucp-agent-badge)
- Merchant documentation: [kyalabs.io/merchants](https://www.kyalabs.io/merchants)

## Why Your Agent Needs This

Your agent can browse, compare, build carts, and find the best deals. But it can't finish the job — because to every merchant, it looks like a bot.

**Without kyaLabs:** Agent browses → bot detection fires → blocked. Even if it gets through, it can't check out without your real card number. You're stuck finishing manually.

**With Badge:** Agent declares itself as an authorized actor → merchants see a verified identity → agent gets through. No bypass. Just proof.

**With Spend:** Agent declares a purchase → you approve with a tap → kyaLabs issues a single-use virtual Visa locked to that merchant → agent checks out → card self-destructs. Your real card never enters the chat.

Your agent will recognize when it needs this. When it encounters a merchant that may challenge automated traffic, or when it's ready to check out, it tells you: "I need kyaLabs installed to complete this." You click Allow. Done.

---

## Tools

See [docs/tool-contract.md](docs/tool-contract.md) for the formal input/output contract.

| Tool | What It Does |
|------|-------------|
| `payclaw_getAgentIdentity` | Declare identity → get verification token + UCP `checkoutPatch` (Badge) |
| `payclaw_reportBadgePresented` | Record that you presented your badge at a merchant |
| `payclaw_reportBadgeOutcome` | Report how the merchant responded (accepted, denied, inconclusive) |
| `payclaw_reportBadgeNotPresented` | Report that you did not present your badge (abandoned, merchant didn't ask) |
| `payclaw_getCard` | Declare purchase intent → get virtual Visa (Spend) |
| `payclaw_reportPurchase` | Report transaction outcome → close the audit trail |

### Badge: Declare Identity

```
Agent → payclaw_getAgentIdentity({ merchantUrl })
kyaLabs → fetches merchant's /.well-known/ucp manifest
kyaLabs → verification token + checkoutPatch (if merchant supports UCP)
Agent → merges checkoutPatch into checkout payload
Agent → payclaw_reportBadgePresented({ merchantUrl, verification_token })
Agent → payclaw_reportBadgeOutcome (accepted | denied | inconclusive)
```

When `merchantUrl` is provided, kyaLabs checks if the merchant supports `io.kyalabs.common.identity` via UCP and returns a `checkoutPatch` the agent merges into the checkout payload. If the merchant doesn't support UCP, a valid token is still returned — nothing breaks.

When Extended Auth is enabled, kyaLabs checks back with your agent 7 seconds after presentation. Otherwise, your agent reports the outcome via `payclaw_reportBadgeOutcome`.

Your agent is now a declared, authorized actor. Not anonymous traffic.

### Spend: Get a Card

```
Agent → payclaw_getCard (merchant, amount, description)
User → approves via MFA
kyaLabs → issues single-use virtual Visa
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

## Why kyaLabs

| | Give Agent Your Card | Crypto Wallet | **kyaLabs** |
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
      "args": ["-y", "@kyalabs/badge"],
      "env": {
        "PAYCLAW_API_KEY": "pk_live_your_key_here",
        "PAYCLAW_API_URL": "https://www.kyalabs.io"
      }
    }
  }
}
```

---

## KYA — Know Your Agent

kyaLabs is KYA infrastructure. Every declaration creates a verified record of agentic commerce behavior — building the trust signal that merchants need to tell authorized agents from anonymous bots.

- [Trust & Verification](https://www.kyalabs.io/trust) — The full trust architecture
- [Dashboard](https://www.kyalabs.io/dashboard/badge) — Your agent's Verified Trips

---

## What's New (v0.8.0)

| Capability | Description |
|---|---|
| UCP-aware `getAgentIdentity` | Pass `merchantUrl` — kyaLabs fetches the merchant's `/.well-known/ucp` manifest and returns a `checkoutPatch` when `io.kyalabs.common.identity` is declared |
| `reportBadgePresented` with `merchantUrl` | Preferred over `merchant`; includes optional `checkoutSessionId` for UCP session tracking |
| `reportBadgeNotPresented` | New tool — report when badge was not presented (abandoned, merchant didn't ask) |
| SSRF-protected manifest fetcher | HTTPS-only, private IP blocking, 5-minute domain cache, 3-second timeout |
| Trip lifecycle hardening | `onServerClose` resolves as `inconclusive` (not `accepted`); orphan token recovery on restart |
| Operational logging | Auth mode on startup; reaper logs active trips |

---

## Links

- **Website:** [kyalabs.io](https://www.kyalabs.io)
- **npm:** [@kyalabs/mcp-server](https://www.npmjs.com/package/@kyalabs/mcp-server)
- **Badge npm:** [@kyalabs/badge](https://www.npmjs.com/package/@kyalabs/badge)
- **UCP Extension:** [github.com/kyalabs/ucp-agent-badge](https://github.com/kyalabs/ucp-agent-badge)
- **ClawHub:** [payclaw-io](https://clawhub.com/skills/payclaw-io)
- **Trust:** [kyalabs.io/trust](https://www.kyalabs.io/trust)
- **Merchants:** [kyalabs.io/merchants](https://www.kyalabs.io/merchants)
- **Contact:** agent_identity@kyalabs.io
- **Security:** security@kyalabs.io

---

*Agents are not bots. kyaLabs proves it.*
*Your real card never enters the chat.*
