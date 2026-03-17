// Canonical: mcp-server | Synced: 2.1.0 | Do not edit in badge-server
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { parseResponse } from "./lib/parse-outcome.js";
import { getStoredConsentKey, getOrCreateInstallId } from "./lib/storage.js";
import { getEnvExtendedAuth, getEnvApiUrl } from "./lib/env.js";
import { getAgentModel } from "./lib/agent-model.js";

const SAMPLING_DELAY_MS = 7000; // 7 seconds after identity_presented
const SAMPLING_TIMEOUT_MS = 15000; // 15 seconds to respond
const DEFAULT_API_URL = "https://www.kyalabs.io";
const BADGE_VERSION = "2.0";
const AGENT_TYPE = "mcp-server";

export interface ActiveTrip {
  token: string;
  merchant: string;
  startedAt: number;
  presented: boolean;
  presentedAt?: number;
  outcome?: string;
  samplingTimer?: ReturnType<typeof setTimeout>;
  /** v2.1: Trip ID linking all events in a shopping session */
  tripId?: string;
}

// In-memory state — max 100 active trips
const activeTrips = new Map<string, ActiveTrip>();
const MAX_TRIPS = 100;
const REAPER_INTERVAL_MS = 60000;
const STALE_TRIP_MS = 15 * 60 * 1000; // 15 minutes

let reaperStarted = false;
let serverRef: Server | null = null;
let samplingAvailable = false;

export function initSampling(server: Server): void {
  serverRef = server;

  // Extended Auth: only use sampling (agent confirmation prompt) when explicitly enabled.
  // Otherwise, agent reports outcome via kya_reportBadgeOutcome.
  const useExtendedAuth = getEnvExtendedAuth();
  samplingAvailable = useExtendedAuth; // Will catch errors on first attempt if enabled

  if (!reaperStarted) {
    reaperStarted = true;
    if (process.env.VITEST !== "true") {
      setInterval(() => reapStaleTrips(), REAPER_INTERVAL_MS);
    }
  }
}

export function onTripStarted(token: string, merchant: string, tripId?: string): void {
  // Resolve any existing trip for a different merchant (agent moved on = success)
  for (const [key, trip] of activeTrips) {
    if (trip.presented && !trip.outcome && trip.merchant !== merchant) {
      resolveTrip(key, "accepted", "agent_moved_to_new_merchant");
    }
  }

  // Evict oldest if at capacity
  if (activeTrips.size >= MAX_TRIPS) {
    const oldest = [...activeTrips.entries()].sort(
      (a, b) => a[1].startedAt - b[1].startedAt
    )[0];
    if (oldest) {
      resolveTrip(oldest[0], "inconclusive", "evicted_capacity");
    }
  }

  activeTrips.set(token, {
    token,
    merchant,
    startedAt: Date.now(),
    presented: false,
    tripId,
  });
}

export function onIdentityPresented(token: string, merchant: string, tripId?: string): void {
  const trip = activeTrips.get(token);
  if (!trip) {
    // Trip not tracked (started before server restart) — create it
    activeTrips.set(token, {
      token,
      merchant,
      startedAt: Date.now(),
      presented: true,
      presentedAt: Date.now(),
      tripId,
    });
  } else {
    trip.presented = true;
    trip.presentedAt = Date.now();
    if (tripId) trip.tripId = tripId;
  }

  // Schedule sampling after delay
  const t = activeTrips.get(token)!;
  if (t.samplingTimer) clearTimeout(t.samplingTimer);
  t.samplingTimer = setTimeout(() => sampleAgent(token, merchant), SAMPLING_DELAY_MS);
}

async function sampleAgent(token: string, merchant: string): Promise<void> {
  const trip = activeTrips.get(token);
  if (!trip || trip.outcome) return; // Already resolved

  if (!serverRef || !samplingAvailable) {
    resolveTrip(token, "no_sampling", "sampling_unavailable");
    return;
  }

  try {
    const result = await Promise.race([
      serverRef.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `You just presented your Badge identity at ${merchant}. Did the merchant deny or block you? Reply with just YES or NO.`,
            },
          },
        ],
        maxTokens: 10,
      }),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("sampling_timeout")), SAMPLING_TIMEOUT_MS)
      ),
    ]);

    if (!result) {
      resolveTrip(token, "inconclusive", "sampling_timeout");
      return;
    }

    // Parse response
    const content = result.content;
    let text = "";
    if (content && typeof content === "object" && "text" in content) {
      text = (content as { text: string }).text;
    } else if (Array.isArray(content)) {
      text = content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join(" ");
    } else if (typeof content === "string") {
      text = content;
    }

    const outcome = parseResponse(text);
    resolveTrip(token, outcome, text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("sampling_timeout")) {
      resolveTrip(token, "inconclusive", "sampling_timeout");
    } else if (
      msg.includes("not supported") ||
      msg.includes("Method not found") ||
      msg.includes("capability")
    ) {
      samplingAvailable = false;
      resolveTrip(token, "no_sampling", msg);
    } else {
      resolveTrip(token, "inconclusive", msg);
    }
  }
}

function resolveTrip(token: string, outcome: string, detail: string): void {
  const trip = activeTrips.get(token);
  if (!trip) return;

  if (trip.samplingTimer) clearTimeout(trip.samplingTimer);
  trip.outcome = outcome;

  // Report to API — include trip_id when available
  reportOutcome(token, outcome, trip.merchant, detail, trip.tripId).catch((err) => {
    process.stderr.write(
      `[BADGE] Failed to report outcome: ${err}\n`
    );
  });

  // Evict from memory after reporting
  activeTrips.delete(token);
}

async function reportOutcome(
  token: string,
  outcome: string,
  merchant: string,
  detail: string,
  tripId?: string
): Promise<void> {
  const apiUrl = getEnvApiUrl() || DEFAULT_API_URL;
  const key = getStoredConsentKey();
  const installId = getOrCreateInstallId();
  const eventType = outcome === "denied" ? "trip_failure" : "trip_success";

  try {
    if (key) {
      // Enriched payload: full auth, user-linked, includes install_id
      const res = await fetch(`${apiUrl}/api/badge/report`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          verification_token: token,
          event_type: eventType,
          merchant,
          detail: detail.slice(0, 500),
          outcome,
          install_id: installId,
          ...(tripId && { trip_id: tripId }),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        process.stderr.write(
          `[BADGE] Report failed (${res.status}): ${body}\n`
        );
      }
    } else {
      // Anonymous payload: no auth header, install_id only
      const res = await fetch(`${apiUrl}/api/badge/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          install_id: installId,
          badge_version: BADGE_VERSION,
          event_type: eventType,
          merchant,
          detail: detail.slice(0, 500),
          outcome,
          agent_type: AGENT_TYPE,
          agent_model: getAgentModel(),
          timestamp: Date.now(),
          ...(tripId && { trip_id: tripId }),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        process.stderr.write(
          `[BADGE] anonymous report failed (${res.status}): ${body}\n`
        );
      }
    }
  } catch (err) {
    process.stderr.write(
      `[BADGE] reportOutcome error: ${err instanceof Error ? err.message : err}\n`
    );
  }
}

function reapStaleTrips(): void {
  const now = Date.now();
  let reaped = 0;
  for (const [token, trip] of activeTrips) {
    if (now - trip.startedAt > STALE_TRIP_MS) {
      const ageMin = Math.round((now - trip.startedAt) / 60000);
      if (trip.presented && !trip.outcome) {
        process.stderr.write(`[kyaLabs] Reaped stale trip: ${token.slice(0, 10)}** (${trip.merchant.slice(0, 64)}, age: ${ageMin}m)\n`);
        resolveTrip(token, "inconclusive", "stale_trip_reaped");
        reaped++;
      } else {
        activeTrips.delete(token);
        reaped++;
      }
    }
  }
  if (activeTrips.size > 0 || reaped > 0) {
    process.stderr.write(`[kyaLabs] Active trips: ${activeTrips.size} | Reaped: ${reaped}\n`);
  }
}

// Called when MCP client disconnects
export function onServerClose(): void {
  for (const [token, trip] of activeTrips) {
    if (trip.presented && !trip.outcome) {
      // Agent disconnected — outcome unknown
      resolveTrip(token, "inconclusive", "server_close");
    }
  }
  activeTrips.clear();
}

/** Test-only: reset state between tests. No-op when VITEST not set. */
export function resetSamplingState(): void {
  if (process.env.VITEST !== "true") return;
  for (const trip of activeTrips.values()) {
    if (trip.samplingTimer) clearTimeout(trip.samplingTimer);
  }
  activeTrips.clear();
  serverRef = null;
  samplingAvailable = true;
  reaperStarted = false;
}

/** Test-only: get trip for assertions. Returns undefined when VITEST not set. */
export function getActiveTrip(token: string): ActiveTrip | undefined {
  if (process.env.VITEST !== "true") return undefined;
  return activeTrips.get(token);
}

/**
 * Report outcome from agent (kya_reportBadgeOutcome tool).
 * Agent-only path — no sampling prompt. Resolves trip and POSTs to API.
 * When token not in activeTrips (e.g. after restart), looks up by merchant or POSTs directly.
 */
export function reportOutcomeFromAgent(
  token: string,
  merchant: string,
  outcome: "accepted" | "denied" | "inconclusive",
  tripId?: string
): void {
  if (activeTrips.has(token)) {
    // Attach trip_id to the active trip before resolving
    if (tripId) activeTrips.get(token)!.tripId = tripId;
    resolveTrip(token, outcome, "agent_reported");
    return;
  }
  // Token may be from before restart — try to find a unique trip by merchant
  let matchToken: string | null = null;
  let matchCount = 0;
  for (const [t, trip] of activeTrips) {
    if (trip.merchant === merchant && trip.presented && !trip.outcome) {
      matchToken = t;
      matchCount++;
      if (matchCount > 1) break;
    }
  }
  if (matchCount === 1 && matchToken) {
    if (tripId) activeTrips.get(matchToken)!.tripId = tripId;
    resolveTrip(matchToken, outcome, "agent_reported");
    return;
  }
  // No matching trip — still report to API so outcome is recorded
  reportOutcome(token, outcome, merchant, "agent_reported", tripId).catch((err) => {
    process.stderr.write(`[BADGE] Failed to report outcome: ${err}\n`);
  });
}
