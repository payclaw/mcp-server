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

  // "no" alone or "no, I was not denied" = accepted
  if (lower === "no" || lower === "no." || lower === "no,") return "accepted";
  if (lower.includes("not denied") || lower.includes("wasn't denied"))
    return "accepted";
  if (lower.startsWith("no")) return "accepted";

  // Check for denial signals
  if (FAILURE_SIGNALS.some((s) => lower.includes(s))) return "denied";

  return "inconclusive";
}
