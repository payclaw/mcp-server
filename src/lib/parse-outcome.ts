/**
 * Parse agent response to sampling prompt into outcome bucket.
 * Extracted for testability (BUG-01.1).
 */

const FAILURE_SIGNALS = [
  "yes",
  "blocked",
  "denied",
  "failed",
  "403",
  "error",
  "rejected",
  "banned",
  "forbidden",
  "captcha",
  "stopped",
];

export function parseResponse(
  text: string
): "accepted" | "denied" | "inconclusive" {
  if (!text || text.trim().length === 0) return "inconclusive";

  const lower = text.toLowerCase().trim();

  // "no, I was not denied" = accepted (check before denial signals)
  if (lower.includes("not denied") || lower.includes("wasn't denied"))
    return "accepted";

  // "yesterday" contains "yes" — exclude false positives
  if (lower === "yesterday") return "inconclusive";

  // Denial signals first — "no, I was blocked" must be denied (before any "no" check)
  if (FAILURE_SIGNALS.some((s) => lower.includes(s))) return "denied";

  // "no" alone or "no" variants = accepted (boundary-aware to avoid "no, I was blocked")
  if (/^no(?:[.,!\s]|$)/i.test(lower)) return "accepted";

  return "inconclusive";
}
