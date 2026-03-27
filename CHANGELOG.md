# Changelog

## [2.6.1] - 2026-03-27

### Fixed
- Server ping now defers 2s so `agent_client` is detected from MCP handshake (was always "unknown")
- Ping includes `server_type: "mcp-server"` to distinguish from `@kyalabs/badge` pings

## [2.6.0] - 2026-03-26 — Badge 2.0 + Shared Identity + Server Ping

### Added
- `kya_web_fetch` tool — fetch with automatic Kya-Token header injection + SSRF protection
- `kya_getHeaders` tool — identity headers for Playwright/browser automation
- Anonymous server ping on MCP startup (opt-out: `KYA_PING=false`)
- Badge token enrollment in `getAgentIdentity` flow (credential bridge)

### Changed
- Shared identity code extracted to `@kyalabs/shared-identity` (~2,400 lines removed)
- `kya_reportBadgeOutcome` and `kya_reportBadgeNotPresented` deprecated (outcomes auto-tracked)
- `NEXT_STEP_TEXT` updated to reference `kya_web_fetch`
- Added `"type": "module"` to package.json
- SSRF protection: full 127.0.0.0/8 loopback, RFC6598 CGN, IPv4-mapped IPv6
- Streaming body reader with precise byte-level truncation
- README data philosophy updated with server ping disclosure

## [2.3.0] - 2026-03-17 — Merchant Signal Awareness

### Added
- `fetchSignalStatus(domain, apiUrl)` in `src/lib/signal-status.ts` — queries `/api/merchant/signal-status` (synced from badge-server canonical)
- `merchant_signals` field in `IdentityResult` — returned from `getAgentIdentity`
- `signal_context_received` event fired from `getAgentIdentity` when merchant has active signals
- `extractDomain()` helper in `getAgentIdentity.ts`

### Notes
- Requires App PR: migration 044 + `/api/merchant/signal-status` endpoint

## [2.2.0] - 2026-03-17 — assurance_level via Introspect

### Added
- `introspectBadgeToken(token)` in `src/api/client.ts` — POST `/api/oauth/introspect`, 3s timeout, graceful null on failure
- `IntrospectResult` interface
- `registerTripAssuranceLevel(token, level)` exported from `sampling.ts`
- `assuranceLevelStore` in `sampling.ts` — FIFO-evicted at MAX_TRIPS cap
- `assurance_level` in `IdentityResult` and `trip_success`/`trip_failure` payloads

### Notes
- `browse_declared` does NOT carry assurance_level — fires before token exists
- Mock tokens (`pc_v1_sand*`) skip introspect

## [0.8.2] - 2026-03-07 — Fix auth header stripped on redirect

### Fixed
- **"Invalid request origin" on all MCP API calls** — `kyalabs.io` redirects to `www.kyalabs.io`, and Node.js `fetch()` strips the `Authorization` header on cross-origin redirects per the Fetch spec. The MCP server was sending `Bearer pc_v1_...` but it was silently dropped, causing every request to fall through to session auth (CSRF rejection).
- Default base URL changed from `https://kyalabs.io` to `https://www.kyalabs.io` (canonical, no redirect).
- API client now uses `redirect: "manual"` and re-sends requests with auth headers preserved on any redirect (defense-in-depth).
- `getConfig()` now falls back to `getBaseUrl()` default when `PAYCLAW_API_URL` env var is not set, instead of throwing.

## [0.8.1] - 2026-03-07 — Spend availability fix + hold expiry

### Fixed
- **spend_available: false on funded wallets** — `callWithOAuthToken` silently caught API errors and fell back to hardcoded `spend_available: false`, killing agent trips before `getCard` was ever called. Fallback now returns `spend_available: undefined` with a CTA to try `getCard` directly.
- **Zombie holds blocking available balance** — expired `balance_holds` were never released after their 2h TTL. Added `release_expired_holds()` DB function, called before every balance read and intent creation.

### Added
- **MCP stderr logging** — API requests log method + path + status to stderr. Tool calls (`getCard`, `getAgentIdentity`) log params and results. OAuth fallback errors are now visible instead of silently swallowed.

## [0.8.0] - 2026-03-07 — PRD-3: UCP-Aware Identity

### Added
- `merchantUrl` parameter on `getAgentIdentity` — when provided, fetches merchant's `/.well-known/ucp` manifest and checks for `io.kyalabs.common.identity` capability
- `checkoutPatch` in identity response — agent merges into checkout payload when merchant supports UCP
- `ucpCapable`, `requiredByMerchant`, `ucpWarning` fields on identity result
- `merchantUrl` parameter on `reportBadgePresented` (preferred over `merchant`)
- `checkoutSessionId` parameter on `reportBadgePresented` for UCP checkout session tracking
- `ucp-manifest.ts` — SSRF-protected manifest fetcher with per-domain caching (5 min TTL), HTTPS enforcement, private IP blocking
- UCP display in `formatIdentityResponse` — shows capability status, requirement, and action instructions

### Changed
- `reportBadgePresented` now requires `merchantUrl` or `merchant` (validates at least one provided)
- `reportBadgePresented` returns `{ recorded: true }` JSON in first content block for machine parsing
- Trip tracking uses `merchantUrl` when available (falls back to `merchant`)
- Canonical header updated to `Synced: PRD-3` on `getAgentIdentity.ts`

### Refs
- PRD-3: UCP-Aware Identity (2026-03-07)

## [0.7.6] - 2026-03-06 — Tier 6: Stress Test Readiness

### Added
- **F22**: `reportOutcomeFromAgent` recovery logic — orphaned tokens (e.g. after restart) now searched by merchant, with direct API POST fallback
- **F23**: Multi-merchant trip lifecycle tests — verifies `agent_moved_to_new_merchant` resolution, three-merchant chains, merchant fallback search, and direct API POST for orphaned tokens
- **F24**: Operational logging in `reapStaleTrips()` — logs active trip count and per-trip reap events with truncated token and merchant
- **F25**: Pipeline verification script (`internalops/tests/badge-stress-test-v1.1/verify-pipeline.ts`) — end-to-end check from MCP tool calls through API to Supabase views

### Refs
- MCPDuro_Mar6 Tier 6

## [0.7.5] - 2026-03-06 — Tier 5: Dependency Alignment

### Changed
- **F20/F21**: Zod and MCP SDK ranges now identical between `@kyalabs/badge` and `@kyalabs/mcp-server` — zod `^3.24.0 || ^4.0.0`, SDK `^1.27.1`

### Refs
- MCPDuro_Mar6 Tier 5

## [0.7.4] - 2026-03-06 — Tier 4: Data Quality & UX

### Fixed
- **F15**: `onServerClose` now resolves trips as `"inconclusive"` instead of `"accepted"` — server disconnect is not proof of merchant acceptance
- **F18**: `tool-contract.md` updated to reflect badge-server's current tool signatures (identical to mcp-server since 0.7)

### Refs
- MCPDuro_Mar6 Tier 4

## [0.7.3] - 2026-03-06 — Tiers 2 & 3: Auth Flow Fixes + Code Sync

### Added
- **F5**: Auth mode startup logging — stderr shows which auth mode is active on launch (API key, consent key, or none)
- **F13**: `pendingActivation` dedup guard — concurrent `getAgentIdentity` calls reuse the same device flow instead of spawning duplicates
- **F9**: `SYNC.md` documenting canonical file ownership between badge-server and mcp-server
- **F9**: Canonical ownership header comments on all shared source files

### Fixed
- **F7**: `identityFromOAuthToken` error fallback now correctly reports `principal_verified: false` and `status: "pending"` (was falsely claiming verified on API failure)
- **F8**: `isApiMode()` now returns `true` when a stored consent key exists (device-flow users no longer fall to mock/local mode)
- **F10**: `device-auth.ts` now uses `fetchWithTimeout` (10s AbortController timeout) — prevents indefinite hangs on network issues
- **F11**: `device-auth.ts` `getBaseUrl()` validates HTTPS (or localhost) — blocks sending OAuth tokens over HTTP in production
- **F12**: `device-auth.ts` sanitizes `interval` and `expires_in` from server response — prevents tight spin loops on malformed data

### Refs
- MCPDuro_Mar6 Tiers 2 & 3

## [0.7.2] - 2026-03-06

### Fixed
- **F3**: Synced version strings across `package.json`, `server.json`, and `index.ts` (were inconsistent: 0.7.0/0.7.1)
- **F4**: `getCard` and `reportPurchase` error message now guides both API-key and device-flow users (was: "PAYCLAW_API_KEY environment variable is not set")

### Refs
- MCPDuro_Mar6 Tier 1 hotfixes
