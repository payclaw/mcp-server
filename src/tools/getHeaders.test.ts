import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../lib/badge-token.js", () => ({
  getCachedBadgeToken: vi.fn(),
}));

import { getHeaders } from "./getHeaders.js";
import { getCachedBadgeToken } from "../lib/badge-token.js";

const mockGetToken = vi.mocked(getCachedBadgeToken);

describe("getHeaders", () => {
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns Kya-Token header with kya_* badge token", () => {
    mockGetToken.mockReturnValue("kya_abc123def456");
    const result = getHeaders();
    expect(result).toEqual({
      headers: { "Kya-Token": "kya_abc123def456" },
    });
  });

  it("returns NO_IDENTITY error when no badge token cached", () => {
    mockGetToken.mockReturnValue(null);
    const result = getHeaders();
    expect(result).toEqual({
      error: "Call kya_getAgentIdentity with a merchant first to establish identity",
      code: "NO_IDENTITY",
    });
  });

  it("does not log the token value to stderr", () => {
    mockGetToken.mockReturnValue("kya_secret_value");
    getHeaders();
    const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrOutput).not.toContain("kya_secret_value");
  });
});
