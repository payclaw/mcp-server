import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAgentIdentity, formatIdentityResponse } from "./getAgentIdentity.js";
import * as api from "../api/client.js";
import * as storage from "../lib/storage.js";

vi.mock("../api/client.js", async (importActual) => {
  const actual = await importActual<typeof import("../api/client.js")>();
  return {
    ...actual,
    getAgentIdentity: vi.fn(),
    getAgentIdentityWithToken: vi.fn(),
    isApiMode: vi.fn(),
    getBaseUrl: vi.fn(),
    createIntent: vi.fn(),
    getCard: vi.fn(),
    reportTransaction: vi.fn(),
    getBalance: vi.fn(),
  };
});
vi.mock("../lib/storage.js");
vi.mock("../lib/device-auth.js");
vi.mock("../lib/ucp-manifest.js");

describe("getAgentIdentity — 401 handling", () => {
  beforeEach(() => {
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pc_v1_expired_token");
    vi.mocked(api.isApiMode).mockReturnValue(true);
    vi.mocked(api.getBaseUrl).mockReturnValue("https://www.payclaw.io");
    // No PAYCLAW_API_KEY → uses OAuth token path (callWithOAuthToken)
    delete process.env.PAYCLAW_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PAYCLAW_API_KEY;
  });

  it("surfaces session_expired when OAuth token gets 401", async () => {
    const authError = new api.PayClawApiError(
      "PayClaw authentication failed. To continue, add a permanent API key to your MCP config:\n\n" +
      "  1. Get a key: https://www.payclaw.io/dashboard/keys\n" +
      "  2. Add to your MCP config: PAYCLAW_API_KEY=pk_live_...\n\n" +
      "Permanent keys don't expire. See: https://www.payclaw.io/docs/mcp-setup",
      401
    );

    vi.mocked(api.getAgentIdentityWithToken).mockRejectedValue(authError);

    const result = await getAgentIdentity("test-merchant");

    expect(result.session_expired).toBe(true);
    expect(result.status).not.toBe("active");
    expect(result.message).toContain("PayClaw authentication failed");
    expect(result.message).toContain("payclaw.io/dashboard/keys");
    expect(result.principal_verified).toBe(false);
    expect(result.merchant).toBe("test-merchant");
  });

  it("still falls back to local identity for non-401 errors", async () => {
    const networkError = new Error("Could not reach the PayClaw API.");
    vi.mocked(api.getAgentIdentityWithToken).mockRejectedValue(networkError);

    const result = await getAgentIdentity("test-merchant");

    // Should NOT have session_expired — this is a transient error
    expect(result.session_expired).toBeUndefined();
    // Should fall back to local identity
    expect(result.verification_token).toBe("pc_v1_expired_token");
  });

  it("surfaces session_expired when API key gets 401", async () => {
    // Simulate PAYCLAW_API_KEY path (callWithKey) — set the env var
    process.env.PAYCLAW_API_KEY = "pk_live_invalid_key";
    vi.mocked(storage.getStoredConsentKey).mockReturnValue("pk_live_invalid_key");

    const authError = new api.PayClawApiError(
      "PayClaw authentication failed. To continue, add a permanent API key to your MCP config:\n\n" +
      "  1. Get a key: https://www.payclaw.io/dashboard/keys\n" +
      "  2. Add to your MCP config: PAYCLAW_API_KEY=pk_live_...\n\n" +
      "Permanent keys don't expire. See: https://www.payclaw.io/docs/mcp-setup",
      401
    );
    vi.mocked(api.getAgentIdentity).mockRejectedValue(authError);

    const result = await getAgentIdentity("test-merchant");

    expect(result.session_expired).toBe(true);
    expect(result.status).toBe("session_expired");
    expect(result.message).toContain("PayClaw authentication failed");
    expect(result.principal_verified).toBe(false);
    expect(result.merchant).toBe("test-merchant");
  });

  it("formats session_expired result with directed action", async () => {
    const result = {
      product_name: "PayClaw Badge",
      status: "session_expired",
      agent_disclosure: "PayClaw session expired",
      verification_token: "",
      trust_url: "https://www.payclaw.io/trust",
      contact: "agent_identity@payclaw.io",
      principal_verified: false,
      spend_available: false,
      session_expired: true,
      message: "PayClaw authentication failed. To continue, add a permanent API key.",
    };

    const formatted = formatIdentityResponse(result);
    expect(formatted).toContain("SESSION EXPIRED");
    expect(formatted).toContain(result.message);
  });
});
