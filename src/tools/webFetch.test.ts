import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/storage.js", () => ({
  getOrCreateInstallId: vi.fn(() => "inst-aaaa-bbbb-cccc-dddddddddddd"),
}));

vi.mock("../lib/agent-model.js", () => ({
  getAgentModel: vi.fn(() => "test-model"),
}));

vi.mock("../lib/env.js", () => ({
  getEnvApiUrl: vi.fn(() => ""),
}));

vi.mock("../lib/badge-token.js", () => ({
  getCachedBadgeToken: vi.fn(),
  enrollAndCacheBadgeToken: vi.fn(),
}));

import { webFetch } from "./webFetch.js";
import { getCachedBadgeToken, enrollAndCacheBadgeToken } from "../lib/badge-token.js";

const mockGetCached = vi.mocked(getCachedBadgeToken);
const mockEnroll = vi.mocked(enrollAndCacheBadgeToken);
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.VITEST = "true";
  mockGetCached.mockReturnValue("kya_test_badge_token");
  mockEnroll.mockResolvedValue("kya_test_badge_token");
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// --- Helper: mock a successful fetch response ---
function mockResponse(body: string, init?: { status?: number; headers?: Record<string, string> }) {
  const status = init?.status ?? 200;
  const headers = new Map(Object.entries(init?.headers ?? { "content-type": "text/html" }));
  return {
    ok: status >= 200 && status < 400,
    status,
    headers: {
      entries: () => headers.entries(),
      get: (k: string) => headers.get(k.toLowerCase()) ?? null,
    },
    text: () => Promise.resolve(body),
    url: "https://example.com",
  };
}

describe("webFetch", () => {
  // --- Identity checks ---

  describe("identity", () => {
    it("returns NO_IDENTITY when no badge token cached and enroll fails", async () => {
      mockGetCached.mockReturnValue(null);
      mockEnroll.mockResolvedValue(null);
      const result = await webFetch("https://example.com");
      expect(result).toMatchObject({ error: expect.stringContaining("kya_getAgentIdentity"), code: "NO_IDENTITY" });
    });

    it("enrolls on-the-fly when no cached token for merchant", async () => {
      mockGetCached.mockReturnValue(null);
      mockEnroll.mockResolvedValue("kya_enrolled_on_fly");
      mockFetch.mockResolvedValue(mockResponse("ok"));
      const result = await webFetch("https://example.com");
      expect(mockEnroll).toHaveBeenCalledWith("example.com");
      expect((result as any).status).toBe(200);
    });
  });

  // --- URL validation ---

  describe("URL validation", () => {
    it("rejects HTTP URLs", async () => {
      delete process.env.VITEST;
      const result = await webFetch("http://example.com");
      expect(result).toMatchObject({ code: "INVALID_URL" });
    });

    it("rejects ftp:// URLs", async () => {
      const result = await webFetch("ftp://example.com");
      expect(result).toMatchObject({ code: "INVALID_URL" });
    });

    it("rejects malformed URLs", async () => {
      const result = await webFetch("not-a-url");
      expect(result).toMatchObject({ code: "INVALID_URL" });
    });

    it("rejects localhost (SSRF)", async () => {
      const result = await webFetch("https://localhost");
      expect(result).toMatchObject({ code: "BLOCKED_URL" });
    });

    it("rejects 127.0.0.1 (SSRF)", async () => {
      const result = await webFetch("https://127.0.0.1");
      expect(result).toMatchObject({ code: "BLOCKED_URL" });
    });

    it("rejects RFC1918 10.x (SSRF)", async () => {
      const result = await webFetch("https://10.0.0.1");
      expect(result).toMatchObject({ code: "BLOCKED_URL" });
    });

    it("rejects RFC1918 192.168.x (SSRF)", async () => {
      const result = await webFetch("https://192.168.1.1");
      expect(result).toMatchObject({ code: "BLOCKED_URL" });
    });

    it("rejects AWS metadata 169.254.x (SSRF)", async () => {
      const result = await webFetch("https://169.254.169.254");
      expect(result).toMatchObject({ code: "BLOCKED_URL" });
    });
  });

  // --- Method checks ---

  describe("method", () => {
    it("defaults to GET", async () => {
      mockFetch.mockResolvedValue(mockResponse("<html>ok</html>"));
      await webFetch("https://example.com");
      expect(mockFetch.mock.calls[0][1].method).toBe("GET");
    });

    it("allows HEAD", async () => {
      mockFetch.mockResolvedValue(mockResponse(""));
      await webFetch("https://example.com", "HEAD");
      expect(mockFetch.mock.calls[0][1].method).toBe("HEAD");
    });

    it("allows OPTIONS", async () => {
      mockFetch.mockResolvedValue(mockResponse(""));
      await webFetch("https://example.com", "OPTIONS");
      expect(mockFetch.mock.calls[0][1].method).toBe("OPTIONS");
    });

    it("rejects POST", async () => {
      const result = await webFetch("https://example.com", "POST");
      expect(result).toMatchObject({ code: "METHOD_NOT_ALLOWED" });
    });

    it("rejects PUT", async () => {
      const result = await webFetch("https://example.com", "PUT");
      expect(result).toMatchObject({ code: "METHOD_NOT_ALLOWED" });
    });
  });

  // --- Fetch behavior ---

  describe("fetch behavior", () => {
    it("returns status, headers, body, truncated, url on success", async () => {
      mockFetch.mockResolvedValue(mockResponse("<html>hello</html>"));
      const result = await webFetch("https://example.com");
      expect(result).toMatchObject({
        status: 200,
        body: "<html>hello</html>",
        truncated: false,
        url: "https://example.com",
      });
      expect((result as any).headers).toBeDefined();
    });

    it("injects Kya-Token header in outbound request", async () => {
      mockFetch.mockResolvedValue(mockResponse("ok"));
      await webFetch("https://example.com");
      const fetchCall = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === "https://example.com"
      );
      expect(fetchCall).toBeDefined();
      expect(fetchCall![1].headers["Kya-Token"]).toBe("kya_test_badge_token");
    });

    it("strips set-cookie from response headers", async () => {
      mockFetch.mockResolvedValue(
        mockResponse("ok", { headers: { "content-type": "text/html", "set-cookie": "session=abc" } })
      );
      const result = await webFetch("https://example.com");
      expect((result as any).headers["set-cookie"]).toBeUndefined();
    });

    it("preserves content-type in response headers", async () => {
      mockFetch.mockResolvedValue(
        mockResponse("ok", { headers: { "content-type": "application/json" } })
      );
      const result = await webFetch("https://example.com");
      expect((result as any).headers["content-type"]).toBe("application/json");
    });

    it("preserves location header on redirects", async () => {
      mockFetch.mockResolvedValue(
        mockResponse("", { status: 301, headers: { location: "https://example.com/new" } })
      );
      const result = await webFetch("https://example.com/old");
      expect((result as any).status).toBe(301);
      expect((result as any).headers["location"]).toBe("https://example.com/new");
    });

    it("uses redirect: manual", async () => {
      mockFetch.mockResolvedValue(mockResponse("ok"));
      await webFetch("https://example.com");
      const fetchCall = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === "https://example.com"
      );
      expect(fetchCall![1].redirect).toBe("manual");
    });

    it("truncates body over 5MB", async () => {
      const bigBody = "x".repeat(5_242_881);
      mockFetch.mockResolvedValue(mockResponse(bigBody));
      const result = await webFetch("https://example.com");
      expect((result as any).truncated).toBe(true);
      expect((result as any).body.length).toBe(5_242_880);
    });

    it("returns TIMEOUT error on AbortError", async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      mockFetch.mockRejectedValue(err);
      const result = await webFetch("https://example.com");
      expect(result).toMatchObject({ code: "TIMEOUT" });
    });

    it("returns FETCH_ERROR on network failure", async () => {
      mockFetch.mockRejectedValue(new Error("network down"));
      const result = await webFetch("https://example.com");
      expect(result).toMatchObject({ code: "FETCH_ERROR" });
    });

    it("merges optional agent headers", async () => {
      mockFetch.mockResolvedValue(mockResponse("ok"));
      await webFetch("https://example.com", "GET", { "Accept": "text/html" });
      const fetchCall = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === "https://example.com"
      );
      expect(fetchCall![1].headers["Accept"]).toBe("text/html");
      // Kya-Token still present
      expect(fetchCall![1].headers["Kya-Token"]).toBe("kya_test_badge_token");
    });

    it("does not allow agent to override Kya-Token via headers param", async () => {
      mockFetch.mockResolvedValue(mockResponse("ok"));
      await webFetch("https://example.com", "GET", { "Kya-Token": "evil" });
      const fetchCall = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === "https://example.com"
      );
      // Our token wins, not the agent's
      expect(fetchCall![1].headers["Kya-Token"]).toBe("kya_test_badge_token");
    });
  });

  // --- Auto-declare ---

  describe("auto-declare", () => {
    it("fires browse_declared event after successful fetch", async () => {
      mockFetch.mockResolvedValue(mockResponse("ok"));
      await webFetch("https://www.etsy.com/products");

      const declareCalls = mockFetch.mock.calls.filter((c: any[]) => {
        try {
          const body = JSON.parse(c[1]?.body || "{}");
          return body.event_type === "browse_declared";
        } catch {
          return false;
        }
      });
      expect(declareCalls.length).toBe(1);

      const payload = JSON.parse(declareCalls[0][1].body);
      expect(payload.merchant).toBe("etsy.com"); // www. stripped
      expect(payload.install_id).toBe("inst-aaaa-bbbb-cccc-dddddddddddd");
      expect(payload.event_type).toBe("browse_declared");
      expect(payload.trip_id).toBeDefined();
    });

    it("declare failure does not cause tool error", async () => {
      // First call succeeds (the actual fetch), second call fails (declare)
      mockFetch
        .mockResolvedValueOnce(mockResponse("ok"))
        .mockRejectedValueOnce(new Error("declare failed"));

      const result = await webFetch("https://example.com");
      // Tool still returns success
      expect((result as any).status).toBe(200);
      expect((result as any).body).toBe("ok");
    });

    it("does not fire declare when identity check fails", async () => {
      mockGetCached.mockReturnValue(null);
      mockEnroll.mockResolvedValue(null);
      await webFetch("https://example.com");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not fire declare when URL validation fails", async () => {
      await webFetch("https://localhost");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
