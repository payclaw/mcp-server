# Changelog

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
