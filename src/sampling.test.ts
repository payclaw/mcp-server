import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  initSampling,
  onTripStarted,
  onIdentityPresented,
  onServerClose,
  resetSamplingState,
  getActiveTrip,
  reportOutcomeFromAgent,
} from "./sampling.js";
import * as storage from "./lib/storage.js";

vi.mock("./lib/storage.js", () => ({
  getStoredConsentKey: vi.fn(),
  storeConsentKey: vi.fn(),
}));

describe("sampling", () => {
  let originalVitest: string | undefined;
  const mockFetch = vi.fn();

  beforeEach(() => {
    originalVitest = process.env.VITEST;
    process.env.VITEST = "true";
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");
    resetSamplingState();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSamplingState(); // must run while VITEST is still "true"
    vi.unstubAllGlobals();
    if (originalVitest !== undefined) {
      process.env.VITEST = originalVitest;
    } else {
      delete process.env.VITEST;
    }
  });

  describe("onIdentityPresented", () => {
    it("with existing trip sets presented and schedules 7s timer", () => {
      vi.useFakeTimers();
      onTripStarted("tok1", "merchant.com");
      onIdentityPresented("tok1", "merchant.com");

      const trip = getActiveTrip("tok1");
      expect(trip).toBeDefined();
      expect(trip!.presented).toBe(true);
      expect(trip!.presentedAt).toBeDefined();

      // Advance 6s — sampling should not have fired yet
      vi.advanceTimersByTime(6000);
      expect(getActiveTrip("tok1")).toBeDefined();

      // Advance 1s more — sampling fires (needs serverRef mock; will resolve to no_sampling without it)
      vi.advanceTimersByTime(1000);
      // Without serverRef, sampleAgent resolves to no_sampling and evicts trip
      expect(getActiveTrip("tok1")).toBeUndefined();
    });

    it("with unknown token creates trip with presented true", () => {
      onIdentityPresented("tok2", "other.com");

      const trip = getActiveTrip("tok2");
      expect(trip).toBeDefined();
      expect(trip!.presented).toBe(true);
      expect(trip!.merchant).toBe("other.com");
    });

    it("duplicate calls reset 7s timer", () => {
      vi.useFakeTimers();
      onTripStarted("tok3", "m");
      onIdentityPresented("tok3", "m");
      vi.advanceTimersByTime(5000);
      onIdentityPresented("tok3", "m"); // reset timer
      vi.advanceTimersByTime(2000); // only 2s from reset — trip still present
      // Without serverRef, when sampling fires it evicts. Timer was reset so 7s from second call.
      // After 2s more from second call, 5+2=7s from first, but we reset so timer is 7s from second.
      // So after 2s from second call, we're at 2s — sampling hasn't fired
      const trip = getActiveTrip("tok3");
      expect(trip).toBeDefined();
    });

    it("after onTripStarted does not evict trip", () => {
      onTripStarted("tok4", "merchant.com");
      onIdentityPresented("tok4", "merchant.com");

      const trip = getActiveTrip("tok4");
      expect(trip).toBeDefined();
      expect(trip!.merchant).toBe("merchant.com");
      expect(trip!.presented).toBe(true);
    });
  });

  describe("onTripStarted only (agent never reports)", () => {
    it("sampling does not fire when reportBadgePresented never called", () => {
      vi.useFakeTimers();
      onTripStarted("tok5", "m");
      // Never call onIdentityPresented
      vi.advanceTimersByTime(10000);

      const trip = getActiveTrip("tok5");
      expect(trip).toBeDefined();
      expect(trip!.presented).toBe(false);
    });
  });

  describe("onServerClose", () => {
    it("resolves presented trips as accepted before 7s", () => {
      onTripStarted("tok6", "m");
      onIdentityPresented("tok6", "m");
      onServerClose();

      expect(getActiveTrip("tok6")).toBeUndefined();
    });
  });

  describe("sampleAgent edge cases", () => {
    it("createMessage not supported -> no_sampling, no crash", async () => {
      vi.useFakeTimers();
      const mockServer = {
        createMessage: vi.fn().mockRejectedValue(new Error("Method not found")),
      } as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server;
      initSampling(mockServer);
      onTripStarted("tok7", "m");
      onIdentityPresented("tok7", "m");

      vi.advanceTimersByTime(7000);
      await vi.runAllTimersAsync();

      expect(getActiveTrip("tok7")).toBeUndefined();
    });

    it("createMessage times out -> inconclusive, trip evicted", async () => {
      vi.useFakeTimers();
      const mockServer = {
        createMessage: vi.fn().mockImplementation(
          () => new Promise(() => {}) // never resolves
        ),
      } as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server;
      process.env.PAYCLAW_EXTENDED_AUTH = "true";
      initSampling(mockServer);
      onTripStarted("tok8", "m");
      onIdentityPresented("tok8", "m");

      vi.advanceTimersByTime(7000);
      await vi.advanceTimersByTimeAsync(16000); // past 15s timeout

      expect(getActiveTrip("tok8")).toBeUndefined();
      delete process.env.PAYCLAW_EXTENDED_AUTH;
    });

    it("reportOutcome with no key -> no fetch, no throw, trip evicted", async () => {
      vi.useFakeTimers();
      mockFetch.mockClear();
      vi.mocked(storage.getStoredConsentKey).mockReturnValue(null);

      process.env.PAYCLAW_EXTENDED_AUTH = "true";
      const mockServer = {
        createMessage: vi.fn().mockResolvedValue({
          content: { type: "text", text: "no" },
        }),
      } as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server;
      initSampling(mockServer);
      onTripStarted("tok9", "m");
      onIdentityPresented("tok9", "m");

      vi.advanceTimersByTime(7000);
      await vi.runAllTimersAsync();

      expect(getActiveTrip("tok9")).toBeUndefined();
      const reportCalls = mockFetch.mock.calls.filter((c) =>
        String(c[0]).includes("/api/badge/report")
      );
      expect(reportCalls).toHaveLength(0);
      delete process.env.PAYCLAW_EXTENDED_AUTH;
    });
  });

  describe("multi-merchant trip lifecycle", () => {
    it("starting trip B resolves presented trip A as agent_moved_to_new_merchant", () => {
      onTripStarted("tok_a", "amazon.com");
      onIdentityPresented("tok_a", "amazon.com");

      expect(getActiveTrip("tok_a")).toBeDefined();
      expect(getActiveTrip("tok_a")!.presented).toBe(true);

      onTripStarted("tok_b", "target.com");

      expect(getActiveTrip("tok_a")).toBeUndefined();
      const tripB = getActiveTrip("tok_b");
      expect(tripB).toBeDefined();
      expect(tripB!.merchant).toBe("target.com");
    });

    it("trip B can be presented and resolved after trip A is auto-resolved", () => {
      onTripStarted("tok_a", "amazon.com");
      onIdentityPresented("tok_a", "amazon.com");
      onTripStarted("tok_b", "target.com");
      onIdentityPresented("tok_b", "target.com");

      reportOutcomeFromAgent("tok_b", "target.com", "accepted");
      expect(getActiveTrip("tok_b")).toBeUndefined();
    });

    it("non-presented trip A is NOT resolved when trip B starts", () => {
      onTripStarted("tok_a", "amazon.com");
      onTripStarted("tok_b", "target.com");

      expect(getActiveTrip("tok_a")).toBeDefined();
      expect(getActiveTrip("tok_b")).toBeDefined();
    });

    it("same-merchant trip restart does not resolve existing trip", () => {
      onTripStarted("tok_a", "amazon.com");
      onIdentityPresented("tok_a", "amazon.com");
      onTripStarted("tok_b", "amazon.com");

      expect(getActiveTrip("tok_a")).toBeDefined();
      expect(getActiveTrip("tok_b")).toBeDefined();
    });

    it("three-merchant chain resolves each previous trip correctly", () => {
      onTripStarted("tok_1", "amazon.com");
      onIdentityPresented("tok_1", "amazon.com");

      onTripStarted("tok_2", "target.com");
      expect(getActiveTrip("tok_1")).toBeUndefined();
      onIdentityPresented("tok_2", "target.com");

      onTripStarted("tok_3", "walmart.com");
      expect(getActiveTrip("tok_2")).toBeUndefined();
      onIdentityPresented("tok_3", "walmart.com");

      expect(getActiveTrip("tok_3")).toBeDefined();
      expect(getActiveTrip("tok_3")!.merchant).toBe("walmart.com");
    });

    it("reportOutcomeFromAgent falls back to merchant search when token unknown", () => {
      onTripStarted("tok_a", "amazon.com");
      onIdentityPresented("tok_a", "amazon.com");

      reportOutcomeFromAgent("unknown_tok", "amazon.com", "accepted");
      expect(getActiveTrip("tok_a")).toBeUndefined();
    });

    it("reportOutcomeFromAgent with no matching trip still POSTs to API", () => {
      mockFetch.mockClear();

      reportOutcomeFromAgent("orphan_tok", "orphan.com", "denied");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/badge/report");
      expect(JSON.parse(opts.body)).toMatchObject({
        verification_token: "orphan_tok",
        merchant: "orphan.com",
        outcome: "denied",
      });
    });

    it("reportOutcomeFromAgent with ambiguous merchant match falls through to API POST", () => {
      mockFetch.mockClear();
      // Two trips at same merchant, both presented
      onTripStarted("tok_a", "amazon.com");
      onIdentityPresented("tok_a", "amazon.com");
      onTripStarted("tok_b", "amazon.com");
      onIdentityPresented("tok_b", "amazon.com");

      mockFetch.mockClear();
      reportOutcomeFromAgent("unknown_tok", "amazon.com", "accepted");

      // Should NOT resolve either trip (ambiguous) — falls through to direct POST
      expect(getActiveTrip("tok_a")).toBeDefined();
      expect(getActiveTrip("tok_b")).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(String(mockFetch.mock.calls[0][0])).toContain("/api/badge/report");
    });

    it("API report includes correct event_type and detail for moved merchant", () => {
      mockFetch.mockClear();
      onTripStarted("tok_a", "amazon.com");
      onIdentityPresented("tok_a", "amazon.com");

      onTripStarted("tok_b", "target.com");

      const reportCalls = mockFetch.mock.calls.filter((c) =>
        String(c[0]).includes("/api/badge/report")
      );
      expect(reportCalls.length).toBeGreaterThanOrEqual(1);
      const body = JSON.parse(reportCalls[0][1].body);
      expect(body.event_type).toBe("trip_success");
      expect(body.detail).toBe("agent_moved_to_new_merchant");
    });
  });
});
