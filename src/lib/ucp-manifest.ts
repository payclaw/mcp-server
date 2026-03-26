/**
 * UCP manifest fetcher — checks if a merchant supports io.kyalabs.common.identity.
 *
 * Fetches {merchantUrl}/.well-known/ucp, caches per domain for 5 minutes.
 * Never throws — returns null on any error.
 */

import { isPublicOrigin } from "./url-safety.js";

/** Current namespace — preferred for new merchant manifests and checkoutPatch. */
const EXTENSION_NAME = "io.kyalabs.common.identity";
/** Legacy namespace — accepted during transition (merchants may still publish this). */
const LEGACY_EXTENSION_NAME = "io.payclaw.common.identity";
const EXTENSION_NAMES = [EXTENSION_NAME, LEGACY_EXTENSION_NAME];
const FETCH_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedManifest {
  data: UCPManifest | null;
  fetchedAt: number;
}

interface UCPCapability {
  version: string;
  spec?: string;
  schema?: string;
  extends?: string;
  config?: { required?: boolean };
}

interface UCPManifest {
  capabilities?: Record<string, UCPCapability | UCPCapability[]>;
  [key: string]: unknown;
}

const manifestCache = new Map<string, CachedManifest>();

function normalizeDomain(url: string): string {
  try {
    const u = new URL(url.endsWith("/") ? url.slice(0, -1) : url);
    return u.origin;
  } catch {
    // Bare domain like "starbucks.com" — try with https://
    try {
      return new URL("https://" + url.replace(/\/+$/, "")).origin;
    } catch {
      return url.replace(/\/+$/, "");
    }
  }
}

export async function fetchUCPManifest(merchantUrl: string): Promise<UCPManifest | null> {
  const domain = normalizeDomain(merchantUrl);

  // SSRF protection: only fetch from public origins
  if (!isPublicOrigin(domain)) return null;

  // Check cache
  const cached = manifestCache.get(domain);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const res = await fetch(`${domain}/.well-known/ucp`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      manifestCache.set(domain, { data: null, fetchedAt: Date.now() });
      return null;
    }
    const data = (await res.json()) as UCPManifest;
    manifestCache.set(domain, { data, fetchedAt: Date.now() });
    return data;
  } catch {
    manifestCache.set(domain, { data: null, fetchedAt: Date.now() });
    return null;
  }
}

export interface BadgeCapability {
  version: string;
  required: boolean;
  /** The namespace key found in the manifest (may be current or legacy). */
  extensionName: string;
}

export function findBadgeCapability(manifest: UCPManifest): BadgeCapability | null {
  const caps = manifest.capabilities;
  if (!caps) return null;

  // Try current namespace first, fall back to legacy
  for (const name of EXTENSION_NAMES) {
    if (!(name in caps)) continue;
    const entry = caps[name];
    // Handle both array-wrapped and plain object forms
    const cap: UCPCapability | undefined = Array.isArray(entry) ? entry[0] : entry;
    if (!cap || typeof cap.version !== "string") continue;
    return {
      version: cap.version,
      required: cap.config?.required === true,
      extensionName: name,
    };
  }
  return null;
}

const COMPATIBLE_VERSIONS = ["2026-01-11"];

export function isVersionCompatible(version: string): boolean {
  return COMPATIBLE_VERSIONS.includes(version);
}

/**
 * Reset the manifest cache. Useful for testing.
 * @internal
 */
export function _resetManifestCache(): void {
  manifestCache.clear();
}
