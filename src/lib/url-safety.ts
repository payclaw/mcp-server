/**
 * URL safety utilities — SSRF prevention for outbound HTTP requests.
 *
 * Extracted from ucp-manifest.ts for reuse across tools that make
 * external HTTP calls (kya_web_fetch, UCP manifest fetcher, etc.).
 */

/**
 * Check if a URL points to a public origin safe to fetch.
 * Blocks localhost, loopback, RFC1918 private ranges, link-local,
 * IPv6 private ranges, and non-HTTPS schemes (except in tests).
 */
export function isPublicOrigin(origin: string): boolean {
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
