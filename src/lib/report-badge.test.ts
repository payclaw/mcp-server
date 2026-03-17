import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  reportBadgePresented,
  reportBadgeNotPresented,
} from "./report-badge.js";
import * as storage from "./storage.js";

vi.mock("./storage.js", () => ({
  getStoredConsentKey: vi.fn(),
  getOrCreateInstallId: vi.fn(() => "inst-aaaa-bbbb-cccc-dddddddddddd"),
}));

describe("reportBadgePresented", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.KYA_API_KEY;
    delete process.env.KYA_API_URL;
  });

  // --- Authenticated mode (existing behavior + enrichment) ---

  it("POSTs with Authorization header when consent key available", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");

    await reportBadgePresented("tok123", "merchant.com");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/badge/report"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer pk_test_xxx",
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("POSTs when OAuth consent key exists", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("oauth_access_token_xyz");

    await reportBadgePresented("tok456", "other.com");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer oauth_access_token_xyz",
        }),
      })
    );
  });

  it("includes install_id in authenticated payload (enriched)", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");

    await reportBadgePresented("tok", "m.com");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.install_id).toBe("inst-aaaa-bbbb-cccc-dddddddddddd");
  });

  it("uses KYA_API_URL when set", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");
    process.env.KYA_API_URL = "https://custom-payclaw.example";

    await reportBadgePresented("tok", "m");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom-payclaw.example/api/badge/report",
      expect.any(Object)
    );
  });

  it("uses kyalabs.io when KYA_API_URL unset", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");
    delete process.env.KYA_API_URL;

    await reportBadgePresented("tok", "m");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://www.kyalabs.io/api/badge/report",
      expect.any(Object)
    );
  });

  it("includes presentation_context in body when context provided", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");

    await reportBadgePresented("tok", "m", "checkout");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.presentation_context).toBe("checkout");
    expect(body.event_type).toBe("identity_presented");
  });

  // --- Anonymous mode (THE CORE BUG FIX) ---

  it("POSTs anonymous payload when no key — fetch IS called (core bug fix)", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue(null);

    await reportBadgePresented("tok789", "merchant.com");

    // THE FIX: fetch MUST be called (not silently returned)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("anonymous request has NO Authorization header", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue(null);

    await reportBadgePresented("tok", "m.com");

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("anonymous body contains install_id, badge_version, event_type, merchant, timestamp", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue(null);

    await reportBadgePresented("tok", "amazon.com");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.install_id).toBe("inst-aaaa-bbbb-cccc-dddddddddddd");
    expect(body.badge_version).toBe("2.0");
    expect(body.event_type).toBe("identity_presented");
    expect(body.merchant).toBe("amazon.com");
    expect(typeof body.timestamp).toBe("number");
    expect(body.agent_type).toBe("mcp-server");
  });

  it("anonymous mode includes presentation_context when provided", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue(null);

    await reportBadgePresented("tok", "m", "arrival");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.presentation_context).toBe("arrival");
  });

  // --- Resilience ---

  it("does not throw when fetch rejects", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");
    mockFetch.mockRejectedValue(new Error("network error"));

    await expect(reportBadgePresented("tok", "m")).resolves.toBeUndefined();
  });

  it("does not throw when POST returns 500", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => "server error" });

    await expect(reportBadgePresented("tok", "m")).resolves.toBeUndefined();
  });

  it("anonymous mode does not throw on fetch failure (fire-and-forget preserved)", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue(null);
    mockFetch.mockRejectedValue(new Error("network error"));

    await expect(reportBadgePresented("tok", "m")).resolves.toBeUndefined();
  });
});

describe("reportBadgeNotPresented", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // --- Authenticated mode ---

  it("POSTs with event_type badge_not_presented and reason", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");

    await reportBadgeNotPresented("tok", "merchant.com", "abandoned");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/badge/report"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer pk_test_xxx",
        }),
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event_type).toBe("badge_not_presented");
    expect(body.reason).toBe("abandoned");
  });

  it("supports all valid reasons", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");

    await reportBadgeNotPresented("t", "m", "merchant_didnt_ask");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).reason).toBe("merchant_didnt_ask");

    await reportBadgeNotPresented("t", "m", "other");
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).reason).toBe("other");
  });

  it("includes install_id in authenticated payload", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");

    await reportBadgeNotPresented("tok", "m.com", "abandoned");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.install_id).toBe("inst-aaaa-bbbb-cccc-dddddddddddd");
  });

  // --- Anonymous mode (THE CORE BUG FIX) ---

  it("POSTs anonymous payload with install_id when no key (core bug fix)", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue(null);

    await reportBadgeNotPresented("tok", "merchant.com", "abandoned");

    // THE FIX: fetch MUST be called
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("anonymous request has no Authorization header", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue(null);

    await reportBadgeNotPresented("tok", "m.com", "other");

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it("anonymous body contains install_id, badge_version, reason, timestamp", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue(null);

    await reportBadgeNotPresented("tok", "target.com", "merchant_didnt_ask");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.install_id).toBe("inst-aaaa-bbbb-cccc-dddddddddddd");
    expect(body.badge_version).toBe("2.0");
    expect(body.event_type).toBe("badge_not_presented");
    expect(body.reason).toBe("merchant_didnt_ask");
    expect(body.merchant).toBe("target.com");
    expect(typeof body.timestamp).toBe("number");
  });
});
