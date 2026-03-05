import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reportBadgePresented } from "./report-badge.js";
import * as storage from "./storage.js";

vi.mock("./storage.js", () => ({
  getStoredConsentKey: vi.fn(),
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
    delete process.env.PAYCLAW_API_KEY;
    delete process.env.PAYCLAW_API_URL;
  });

  it("POSTs when PAYCLAW_API_KEY set", async () => {
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
        body: JSON.stringify({
          verification_token: "tok123",
          event_type: "identity_presented",
          merchant: "merchant.com",
        }),
      })
    );
  });

  it("POSTs when only stored consent key exists (OAuth)", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("oauth_access_token_xyz");
    process.env.PAYCLAW_API_KEY = "";

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

  it("skips POST when no key at all", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue(null);

    await reportBadgePresented("tok789", "merchant.com");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses PAYCLAW_API_URL when set", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");
    process.env.PAYCLAW_API_URL = "https://api.payclaw.io";

    await reportBadgePresented("tok", "m");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.payclaw.io/api/badge/report",
      expect.any(Object)
    );
  });

  it("uses api.payclaw.io when PAYCLAW_API_URL unset", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");
    delete process.env.PAYCLAW_API_URL;

    await reportBadgePresented("tok", "m");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.payclaw.io/api/badge/report",
      expect.any(Object)
    );
  });

  it("does not throw when fetch rejects", async () => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_test_xxx");
    mockFetch.mockRejectedValue(new Error("network error"));

    await expect(reportBadgePresented("tok", "m")).resolves.toBeUndefined();
  });
});
