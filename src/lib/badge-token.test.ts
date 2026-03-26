import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./storage.js", () => ({
  getStoredConsentKey: vi.fn(),
  getOrCreateInstallId: vi.fn(() => "inst-aaaa-bbbb-cccc-dddddddddddd"),
}));

vi.mock("./env.js", () => ({
  getEnvApiUrl: vi.fn(() => ""),
}));

import {
  enrollAndCacheBadgeToken,
  getCachedBadgeToken,
  _resetBadgeTokenCache,
} from "./badge-token.js";
import { getStoredConsentKey } from "./storage.js";

const mockGetKey = vi.mocked(getStoredConsentKey);
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _resetBadgeTokenCache();
  mockGetKey.mockReturnValue("pk_test_abc123");
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("enrollAndCacheBadgeToken", () => {
  it("calls /api/badge/enroll and returns kya_* token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        badge_token: "kya_abc123def456",
        merchant: "etsy.com",
        enrolled: true,
      }),
    });

    const token = await enrollAndCacheBadgeToken("etsy.com");
    expect(token).toBe("kya_abc123def456");

    // Verify the enroll API was called correctly
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/badge/enroll");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.merchant).toBe("etsy.com");
    expect(body.install_id).toBe("inst-aaaa-bbbb-cccc-dddddddddddd");
  });

  it("caches token per merchant", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ badge_token: "kya_cached" }),
    });

    await enrollAndCacheBadgeToken("etsy.com");
    const cached = getCachedBadgeToken("etsy.com");
    expect(cached).toBe("kya_cached");
  });

  it("returns cached token on second call (no API hit)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ badge_token: "kya_first_call" }),
    });

    await enrollAndCacheBadgeToken("etsy.com");
    const second = await enrollAndCacheBadgeToken("etsy.com");

    expect(second).toBe("kya_first_call");
    expect(mockFetch).toHaveBeenCalledTimes(1); // Only one API call
  });

  it("enrolls separately per merchant", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ badge_token: "kya_etsy" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ badge_token: "kya_walmart" }),
      });

    await enrollAndCacheBadgeToken("etsy.com");
    await enrollAndCacheBadgeToken("walmart.com");

    expect(getCachedBadgeToken("etsy.com")).toBe("kya_etsy");
    expect(getCachedBadgeToken("walmart.com")).toBe("kya_walmart");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns null on enroll API failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: "Rate limit exceeded" }),
    });

    const token = await enrollAndCacheBadgeToken("etsy.com");
    expect(token).toBeNull();
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    const token = await enrollAndCacheBadgeToken("etsy.com");
    expect(token).toBeNull();
  });

  it("returns null when no consent key", async () => {
    mockGetKey.mockReturnValue(null);

    const token = await enrollAndCacheBadgeToken("etsy.com");
    expect(token).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("getCachedBadgeToken", () => {
  it("returns null for unknown merchant", () => {
    expect(getCachedBadgeToken("unknown.com")).toBeNull();
  });

  it("returns last enrolled merchant token when no merchant specified", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ badge_token: "kya_latest" }),
    });

    await enrollAndCacheBadgeToken("etsy.com");
    expect(getCachedBadgeToken()).toBe("kya_latest");
  });
});
