# Changelog

## [0.8.0] - 2026-03-07 — PRD-3: UCP-Aware Identity

### Added
- `merchantUrl` parameter on `getAgentIdentity` — when provided, fetches merchant's `/.well-known/ucp` manifest and checks for `io.payclaw.common.identity` capability
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
- **F20/F21**: Zod and MCP SDK ranges now identical between `@payclaw/badge` and `@payclaw/mcp-server` — zod `^3.24.0 || ^4.0.0`, SDK `^1.27.1`

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
