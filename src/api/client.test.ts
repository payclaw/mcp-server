import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the 401 error message by importing the request function indirectly
// through getAgentIdentity, since request() is not exported directly.
// The key assertion: 401 → structured, actionable error message.

describe("401 error handling", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    process.env.PAYCLAW_API_URL = "https://www.payclaw.io";
    process.env.PAYCLAW_API_KEY = "pk_live_test_key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.PAYCLAW_API_URL;
    delete process.env.PAYCLAW_API_KEY;
  });

  it("401 response includes directed action with key URL and config instructions", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
    });

    // Import dynamically to pick up env vars
    const { getAgentIdentity } = await import("./client.js");

    await expect(getAgentIdentity(undefined, "test-merchant")).rejects.toThrow(
      /session has expired/i
    );
    await expect(getAgentIdentity(undefined, "test-merchant")).rejects.toThrow(
      /payclaw\.io\/dashboard\/keys/i
    );
    await expect(getAgentIdentity(undefined, "test-merchant")).rejects.toThrow(
      /PAYCLAW_API_KEY/i
    );
  });

  it("401 error has statusCode 401", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
    });

    const { getAgentIdentity } = await import("./client.js");

    try {
      await getAgentIdentity(undefined, "test-merchant");
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect((err as { statusCode?: number }).statusCode).toBe(401);
    }
  });
});
