// Canonical: badge-server | Synced: 2.1.0 | mcp-server syncs from here
/**
 * Detect the agent model (MCP client) running this server.
 *
 * Detection order:
 * 1. MCP client info from protocol handshake (clientInfo.name)
 * 2. KYA_AGENT_MODEL env var (explicit override)
 * 3. Fallback: "unknown"
 *
 * Values are raw client strings — normalization happens in DB views.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

let cachedModel: string | null = null;

/**
 * Initialize model detection from the MCP server's client handshake.
 * Call once after server.connect() completes.
 */
export function initAgentModel(server: Server): void {
  try {
    const clientInfo = server.getClientVersion();
    if (clientInfo?.name) {
      cachedModel = clientInfo.name;
    }
  } catch {
    // getClientVersion() may throw if called before handshake — safe to ignore
  }
}

/**
 * Get the detected agent model string.
 * Returns raw client name (e.g. "claude-desktop", "cursor", "continue").
 */
export function getAgentModel(): string {
  // 1. MCP client info (set during init)
  if (cachedModel) return cachedModel;

  // 2. Explicit env override
  const envModel = process.env.KYA_AGENT_MODEL?.trim();
  if (envModel) return envModel;

  // 3. Fallback
  return "unknown";
}
