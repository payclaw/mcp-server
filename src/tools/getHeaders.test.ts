import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@kyalabs/shared-identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kyalabs/shared-identity")>();
  return {
    ...actual,
    getCachedBadgeToken: vi.fn(),
    enrollAndCacheBadgeToken: vi.fn(),
  };
});

vi.mock("./getAgentIdentity.js", () => ({
  getLatestIdentitySession: vi.fn(),
}));

import { getHeaders } from "./getHeaders.js";
import { getCachedBadgeToken, enrollAndCacheBadgeToken } from "@kyalabs/shared-identity";
import { getLatestIdentitySession } from "./getAgentIdentity.js";

const mockGetToken = vi.mocked(getCachedBadgeToken);
const mockEnroll = vi.mocked(enrollAndCacheBadgeToken);
const mockGetLatestIdentitySession = vi.mocked(getLatestIdentitySession);

describe("getHeaders", () => {
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prefers cached Badge JWT when identity has already been established", async () => {
    mockGetLatestIdentitySession.mockReturnValue({
      verificationToken: "eyJ.badge.jwt",
      merchant: "etsy.com",
      tripId: "trip-1",
      installId: "install-1",
    });

    const result = await getHeaders("etsy.com");
    expect(result).toEqual({
      headers: { "Kya-Token": "eyJ.badge.jwt" },
    });
    expect(mockEnroll).not.toHaveBeenCalled();
  });

  it("returns Kya-Token header with kya_* badge token", async () => {
    mockGetLatestIdentitySession.mockReturnValue(null);
    mockGetToken.mockReturnValue("kya_abc123def456");
    const result = await getHeaders();
    expect(result).toEqual({
      headers: { "Kya-Token": "kya_abc123def456" },
    });
  });

  it("returns NO_IDENTITY error when no badge token cached and no merchant", async () => {
    mockGetLatestIdentitySession.mockReturnValue(null);
    mockGetToken.mockReturnValue(null);
    const result = await getHeaders();
    expect(result).toEqual({
      error: "Call kya_getAgentIdentity with a merchant first to establish identity",
      code: "NO_IDENTITY",
    });
  });

  it("attempts enrollment when no cached token and merchant provided", async () => {
    mockGetLatestIdentitySession.mockReturnValue(null);
    mockGetToken.mockReturnValue(null);
    mockEnroll.mockResolvedValue("kya_enrolled_on_fly");

    const result = await getHeaders("etsy.com");

    expect(mockEnroll).toHaveBeenCalledWith("etsy.com");
    expect(result).toEqual({
      headers: { "Kya-Token": "kya_enrolled_on_fly" },
    });
  });

  it("returns NO_IDENTITY when enrollment also fails", async () => {
    mockGetLatestIdentitySession.mockReturnValue(null);
    mockGetToken.mockReturnValue(null);
    mockEnroll.mockResolvedValue(null);

    const result = await getHeaders("etsy.com");
    expect(result).toMatchObject({ code: "NO_IDENTITY" });
  });

  it("returns NO_IDENTITY when enrollment throws", async () => {
    mockGetLatestIdentitySession.mockReturnValue(null);
    mockGetToken.mockReturnValue(null);
    mockEnroll.mockRejectedValue(new Error("network error"));

    const result = await getHeaders("etsy.com");
    expect(result).toMatchObject({ code: "NO_IDENTITY" });
  });

  it("does not log the token value to stderr", async () => {
    mockGetLatestIdentitySession.mockReturnValue(null);
    mockGetToken.mockReturnValue("kya_secret_value");
    await getHeaders();
    const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrOutput).not.toContain("kya_secret_value");
  });
});
