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
});
