import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONSENT_KEY_DIR = ".payclaw";
const CONSENT_KEY_FILE = "consent_key";

/** In-memory fallback when file isn't writable. Lost on restart. */
let memoryConsentKey: string | null = null;

function getConsentKeyPath(): string {
  const home = os.homedir();
  return path.join(home, CONSENT_KEY_DIR, CONSENT_KEY_FILE);
}

/**
 * Layered consent key lookup:
 * 1. PAYCLAW_API_KEY env (backward compat — device flow never triggers)
 * 2. ~/.payclaw/consent_key file
 * 3. In-memory (current process only)
 */
export function getStoredConsentKey(): string | null {
  const envKey = process.env.PAYCLAW_API_KEY;
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
    // File read failed — fall back to memory
  }

  return memoryConsentKey;
}

/**
 * Store consent key to ~/.payclaw/consent_key.
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
