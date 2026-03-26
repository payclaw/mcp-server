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
  if (hostname === "localhost" || hostname === "::1") return false;
  if (hostname.endsWith(".localhost")) return false;

  // Block private/reserved IPv4 ranges
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 127) return false;                          // 127.0.0.0/8 (loopback)
    if (a === 10) return false;                           // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return false;    // 172.16.0.0/12
    if (a === 192 && b === 168) return false;              // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return false;   // 100.64.0.0/10 (RFC6598 CGN)
    if (a === 169 && b === 254) return false;              // 169.254.0.0/16 (link-local + metadata)
    if (a === 0) return false;                             // 0.0.0.0/8
  }

  // Block IPv6 loopback/link-local/mapped
  if (hostname.startsWith("[")) {
    const inner = hostname.slice(1, -1).toLowerCase();
    if (inner === "::1" || inner.startsWith("fe80:") || inner.startsWith("fc") || inner.startsWith("fd")) return false;

    // Unwrap IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:XXYY:ZZWW hex form)
    const mappedDotted = inner.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedDotted) {
      return isPublicOrigin(origin.replace(/\[.*\]/, mappedDotted[1]));
    }
    const mappedHex = inner.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPublicOrigin(origin.replace(/\[.*\]/, ipv4));
    }
  }

  return true;
}
