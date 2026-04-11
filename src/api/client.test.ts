import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAgentIdentity, BadgeApiError } from "./client.js";

describe("401 error handling", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    process.env.KYA_API_URL = "https://www.kyalabs.io";
    process.env.KYA_API_KEY = "pk_live_test_key";
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: false, status: 401, headers: new Headers() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.KYA_API_URL;
    delete process.env.KYA_API_KEY;
  });

  it("throws BadgeApiError with directed action on 401", async () => {
    let caught: unknown;
    try {
      await getAgentIdentity(undefined, "test-merchant");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BadgeApiError);
    const err = caught as BadgeApiError;
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/kyaLabs session has expired/i);
    expect(err.message).toMatch(/kyalabs\.io\/dashboard\/keys/i);
    expect(err.message).toMatch(/KYA_API_KEY/i);
  });

  it("sends install_id when provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        agent_disclosure: "x",
        verification_token: "eyJ.test.jwt",
        trust_url: "https://www.kyalabs.io/trust",
        contact: "agent_identity@kyalabs.io",
        principal_verified: true,
        mfa_confirmed: false,
      }),
    });

    await getAgentIdentity(
      undefined,
      "test-merchant",
      "550e8400-e29b-41d4-a716-446655440010",
      "550e8400-e29b-41d4-a716-446655440000",
    );

    const [, init] = mockFetch.mock.calls.at(-1)!;
    expect(JSON.parse(init.body as string)).toMatchObject({
      merchant: "test-merchant",
      trip_id: "550e8400-e29b-41d4-a716-446655440010",
      install_id: "550e8400-e29b-41d4-a716-446655440000",
    });
  });
});
