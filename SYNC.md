# Code Sync Contract

`@payclaw/mcp-server` and `@payclaw/badge` share ~60% of source code. This document defines canonical ownership to prevent divergence.

## Canonical Ownership

### badge-server owns (canonical copy lives there)

| File | Notes |
|------|-------|
| `src/lib/device-auth.ts` | fetchWithTimeout, HTTPS validation, interval sanitization |
| `src/lib/storage.ts` | Shared auth storage |
| `src/lib/report-badge.ts` | Badge reporting |
| `src/lib/parse-outcome.ts` | Outcome parsing |
| `src/lib/report-badge-presented-handler.ts` | Badge presentation handler |

### mcp-server owns (canonical copy lives here)

| File | Notes |
|------|-------|
| `src/tools/getAgentIdentity.ts` | Superset — has spend fields + pendingActivation dedup |
| `src/sampling.ts` | Has VITEST guard + test helpers |
| `src/api/client.ts` | Has spend endpoints (structurally different) |

## Sync Process

1. Make changes in the **canonical** repo
2. Copy the file to the other repo
3. Adjust import paths if needed (usually identical)
4. Run `npm run build && npm test` in both repos
5. Update the `Synced:` version in file headers

## Header Format

Shared files carry a header comment:
```typescript
// Canonical: badge-server | Synced: 0.7.3 | Do not edit in mcp-server
```

## Version

Last sync: **0.7.3** (MCPDuro Mar 6, Tier 3)
