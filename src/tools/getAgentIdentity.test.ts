import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAgentIdentity, formatIdentityResponse } from "./getAgentIdentity.js";
import * as api from "../api/client.js";
import * as sharedIdentity from "@kyalabs/shared-identity";

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
vi.mock("@kyalabs/shared-identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kyalabs/shared-identity")>();
  return {
    ...actual,
    getStoredConsentKey: vi.fn(),
    getOrCreateInstallId: vi.fn(() => "inst-test"),
    getEnvApiUrl: vi.fn(() => null),
    getEnvExtendedAuth: vi.fn(() => false),
    initiateDeviceAuth: vi.fn(),
    pollForApproval: vi.fn(),
    fetchUCPManifest: vi.fn(() => null),
    findBadgeCapability: vi.fn(() => null),
    isVersionCompatible: vi.fn(() => false),
    registerTripAssuranceLevel: vi.fn(),
    fetchSignalStatus: vi.fn(() => null),
    enrollAndCacheBadgeToken: vi.fn(() => Promise.resolve(null)),
  };
});

describe("getAgentIdentity — 401 handling", () => {
  beforeEach(() => {
    vi.mocked(sharedIdentity.getStoredConsentKey).mockReturnValue("pc_v1_expired_token");
    vi.mocked(api.isApiMode).mockReturnValue(true);
    vi.mocked(api.getBaseUrl).mockReturnValue("https://www.kyalabs.io");
    // No KYA_API_KEY → uses OAuth token path (callWithOAuthToken)
    delete process.env.KYA_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.KYA_API_KEY;
  });

  it("surfaces session_expired when OAuth token gets 401", async () => {
    const authError = new api.BadgeApiError(
      "kyaLabs session has expired. To continue, add a permanent API key to your MCP config:\n\n" +
      "  1. Get a key: https://www.kyalabs.io/dashboard/keys\n" +
      "  2. Add to your MCP config: KYA_API_KEY=pk_live_...\n\n" +
      "Permanent keys don't expire. See: https://www.kyalabs.io/docs/mcp-setup",
      401
    );

    vi.mocked(api.getAgentIdentityWithToken).mockRejectedValue(authError);

    const result = await getAgentIdentity("test-merchant");

    expect(result.session_expired).toBe(true);
    expect(result.status).not.toBe("active");
    expect(result.message).toContain("kyaLabs session has expired");
    expect(result.message).toContain("kyalabs.io/dashboard/keys");
    expect(result.principal_verified).toBe(false);
    expect(result.merchant).toBe("test-merchant");
  });

  it("still falls back to local identity for non-401 errors", async () => {
    const networkError = new Error("Could not reach the kyaLabs API.");
    vi.mocked(api.getAgentIdentityWithToken).mockRejectedValue(networkError);

    const result = await getAgentIdentity("test-merchant");

    // Should NOT have session_expired — this is a transient error
    expect(result.session_expired).toBeUndefined();
    // Should fall back to local identity
    expect(result.verification_token).toBe("pc_v1_expired_token");
  });

  it("surfaces session_expired when API key gets 401", async () => {
    // Simulate KYA_API_KEY path (callWithKey) — set the env var
    process.env.KYA_API_KEY = "pk_live_invalid_key";
    vi.mocked(sharedIdentity.getStoredConsentKey).mockReturnValue("pk_live_invalid_key");

    const authError = new api.BadgeApiError(
      "kyaLabs session has expired. To continue, add a permanent API key to your MCP config:\n\n" +
      "  1. Get a key: https://www.kyalabs.io/dashboard/keys\n" +
      "  2. Add to your MCP config: KYA_API_KEY=pk_live_...\n\n" +
      "Permanent keys don't expire. See: https://www.kyalabs.io/docs/mcp-setup",
      401
    );
    vi.mocked(api.getAgentIdentity).mockRejectedValue(authError);

    const result = await getAgentIdentity("test-merchant");

    expect(result.session_expired).toBe(true);
    expect(result.status).toBe("session_expired");
    expect(result.message).toContain("kyaLabs session has expired");
    expect(result.principal_verified).toBe(false);
    expect(result.merchant).toBe("test-merchant");
  });

  it("formats session_expired result with directed action", async () => {
    const result = {
      product_name: "Badge by kyaLabs",
      status: "session_expired",
      agent_disclosure: "kyaLabs session expired",
      verification_token: "",
      trust_url: "https://www.kyalabs.io/trust",
      contact: "agent_identity@kyalabs.io",
      principal_verified: false,
      spend_available: false,
      session_expired: true,
      message: "kyaLabs session has expired. To continue, add a permanent API key.",
    };

    const formatted = formatIdentityResponse(result);
    expect(formatted).toContain("SESSION EXPIRED");
    expect(formatted).toContain(result.message);
  });
});
