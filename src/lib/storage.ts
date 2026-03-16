// Canonical: badge-server | Synced: 2.0.0 | Do not edit in mcp-server
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { getEnvApiKey } from "./env.js";

const CONSENT_KEY_DIR = ".kya";
const CONSENT_KEY_FILE = "consent_key";
const INSTALL_ID_FILE = "install_id";

/** Legacy directory — checked for migration only. */
const LEGACY_CONSENT_KEY_DIR = ".payclaw";

/** In-memory fallback when file isn't writable. Lost on restart. */
let memoryConsentKey: string | null = null;

/** Cached install_id — survives across calls within the same process. */
let cachedInstallId: string | null = null;

function getConsentKeyPath(): string {
  const home = os.homedir();
  return path.join(home, CONSENT_KEY_DIR, CONSENT_KEY_FILE);
}

function getLegacyConsentKeyPath(): string {
  const home = os.homedir();
  return path.join(home, LEGACY_CONSENT_KEY_DIR, CONSENT_KEY_FILE);
}

/**
 * Layered consent key lookup:
 * 1. KYA_API_KEY env (backward compat — device flow never triggers)
 * 2. ~/.kya/consent_key file (with migration from ~/.payclaw/consent_key)
 * 3. In-memory (current process only)
 */
export function getStoredConsentKey(): string | null {
  const envKey = getEnvApiKey();
  if (envKey && envKey.trim().length > 0) {
    return envKey.trim();
  }

  const filePath = getConsentKeyPath();
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (content.length > 0) {
        return content;
      }
    }
  } catch {
    // File read failed — fall back to legacy check
  }

  // Migration: check legacy ~/.payclaw/consent_key
  const legacyPath = getLegacyConsentKeyPath();
  try {
    if (fs.existsSync(legacyPath)) {
      const content = fs.readFileSync(legacyPath, "utf8").trim();
      if (content.length > 0) {
        // Best-effort copy to new location
        try {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { mode: 0o700, recursive: true });
          }
          fs.writeFileSync(filePath, content, { mode: 0o600, flag: "w" });
        } catch {
          // Copy failed — still return the key
        }
        return content;
      }
    }
  } catch {
    // Legacy read failed — fall back to memory
  }

  return memoryConsentKey;
}

/**
 * Returns a human-readable description of the active auth mode.
 * Used for startup logging — never exposes full key values.
 */
export function getAuthMode(): string {
  const envKey = getEnvApiKey();
  if (envKey && envKey.trim().length > 0) {
    const masked = envKey.trim().substring(0, 8) + "****";
    return `API key (${masked})`;
  }

  const filePath = getConsentKeyPath();
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (content.length > 0) {
        return "consent key (~/.kya/consent_key)";
      }
    }
  } catch {
    // File read failed
  }

  if (memoryConsentKey) {
    return "consent key (in-memory)";
  }

  return "none (device flow will trigger on first tool call)";
}

/**
 * Store consent key to ~/.kya/consent_key.
 * Creates directory if needed. Falls back to memory if file write fails.
 */
export async function storeConsentKey(token: string): Promise<void> {
  const trimmed = token.trim();
  if (trimmed.length === 0) return;

  memoryConsentKey = trimmed;

  const filePath = getConsentKeyPath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    }
    fs.writeFileSync(filePath, trimmed, { mode: 0o600, flag: "w" });
  } catch {
    // File write failed — key is in memory, will be lost on restart
  }
}

/** Test-only: reset cached install_id between tests. */
export function _resetInstallIdCache(): void {
  if (process.env.VITEST !== "true") return;
  cachedInstallId = null;
}

/**
 * Get or create a persistent install_id (UUID v4) at ~/.kya/install_id.
 * Used for anonymous badge event reporting — survives restarts, not tied to sessions.
 *
 * [EC-5] This function NEVER throws. If filesystem operations fail,
 * it falls back to an in-memory UUID (lost on restart but still functional).
 */
export function getOrCreateInstallId(): string {
  if (cachedInstallId) return cachedInstallId;

  try {
    const home = os.homedir();
    const idPath = path.join(home, CONSENT_KEY_DIR, INSTALL_ID_FILE);

    // Try to read existing install_id
    try {
      if (fs.existsSync(idPath)) {
        const content = fs.readFileSync(idPath, "utf8").trim();
        if (content.length > 0) {
          cachedInstallId = content;
          return cachedInstallId;
        }
      }
    } catch {
      // File read failed — will generate new ID below
    }

    // Generate new install_id
    const id = crypto.randomUUID();

    // Best-effort write to disk
    try {
      const dir = path.join(home, CONSENT_KEY_DIR);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(idPath, id, { mode: 0o600 });
    } catch {
      // Write failed — ID lives in memory only (lost on restart)
    }

    cachedInstallId = id;
    return cachedInstallId;
  } catch {
    // [EC-5] Outer catch: homedir() or any unexpected error
    // Always return a valid UUID, even if ephemeral
    const fallbackId = crypto.randomUUID();
    cachedInstallId = fallbackId;
    return fallbackId;
  }
}
