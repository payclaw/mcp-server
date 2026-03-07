/**
 * UCP manifest fetcher — checks if a merchant supports io.payclaw.common.identity.
 *
 * Fetches {merchantUrl}/.well-known/ucp, caches per domain for 5 minutes.
 * Never throws — returns null on any error.
 */

const EXTENSION_NAME = "io.payclaw.common.identity";
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

function isPublicOrigin(origin: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }

  // Block non-https (except in tests)
  if (!origin.startsWith("https://") && !process.env.VITEST) return false;

  // Block localhost and loopback
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return false;
  if (hostname.endsWith(".localhost")) return false;

  // Block private/reserved IPv4 ranges
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 10) return false;                          // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return false;   // 172.16.0.0/12
    if (a === 192 && b === 168) return false;             // 192.168.0.0/16
    if (a === 169 && b === 254) return false;             // 169.254.0.0/16 (link-local + metadata)
    if (a === 0) return false;                            // 0.0.0.0/8
  }

  // Block IPv6 loopback/link-local
  if (hostname.startsWith("[")) {
    const inner = hostname.slice(1, -1).toLowerCase();
    if (inner === "::1" || inner.startsWith("fe80:") || inner.startsWith("fc") || inner.startsWith("fd")) return false;
  }

  return true;
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

export interface PayClawCapability {
  version: string;
  required: boolean;
}

export function findPayClawCapability(manifest: UCPManifest): PayClawCapability | null {
  const caps = manifest.capabilities;
  if (!caps || !(EXTENSION_NAME in caps)) return null;

  const entry = caps[EXTENSION_NAME];
  // Handle both array-wrapped and plain object forms
  const cap: UCPCapability | undefined = Array.isArray(entry) ? entry[0] : entry;
  if (!cap || typeof cap.version !== "string") return null;

  return {
    version: cap.version,
    required: cap.config?.required === true,
  };
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
