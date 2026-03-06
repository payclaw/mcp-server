# Changelog

## [0.7.4] - 2026-03-06 — Tier 4: Data Quality & UX

### Fixed
- **F15**: `onServerClose` now resolves trips as `"inconclusive"` instead of `"accepted"` — server disconnect is not proof of merchant acceptance
- **F18**: `tool-contract.md` updated to reflect badge-server's current tool signatures (identical to mcp-server since 0.7)

### Refs
- MCPDuro_Mar6 Tier 4

## [0.7.3] - 2026-03-06 — Tier 3: Code Sync

### Added
- **F13**: `pendingActivation` dedup guard — concurrent `getAgentIdentity` calls reuse the same device flow instead of spawning duplicates
- **F9**: `SYNC.md` documenting canonical file ownership between badge-server and mcp-server
- **F9**: Canonical ownership header comments on all shared source files

### Fixed
- **F10**: `device-auth.ts` now uses `fetchWithTimeout` (10s AbortController timeout) — prevents indefinite hangs on network issues
- **F11**: `device-auth.ts` `getBaseUrl()` validates HTTPS (or localhost) — blocks sending OAuth tokens over HTTP in production
- **F12**: `device-auth.ts` sanitizes `interval` and `expires_in` from server response — prevents tight spin loops on malformed data

### Refs
- MCPDuro_Mar6 Tier 3

## [Unreleased] - Tier 2: Auth Flow Fixes

### Added
- **F5**: Auth mode startup logging — stderr shows which auth mode is active on launch (API key, consent key, or none)

### Fixed
- **F7**: `identityFromOAuthToken` error fallback now correctly reports `principal_verified: false` and `status: "pending"` (was falsely claiming verified on API failure)
- **F8**: `isApiMode()` now returns `true` when a stored consent key exists (device-flow users no longer fall to mock/local mode)

### Refs
- MCPDuro_Mar6 Tier 2

## [0.7.2] - 2026-03-06

### Fixed
- **F3**: Synced version strings across `package.json`, `server.json`, and `index.ts` (were inconsistent: 0.7.0/0.7.1)
- **F4**: `getCard` and `reportPurchase` error message now guides both API-key and device-flow users (was: "PAYCLAW_API_KEY environment variable is not set")

### Refs
- MCPDuro_Mar6 Tier 1 hotfixes
