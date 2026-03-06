/**
 * Integration tests for payclaw_reportBadgePresented tool flow (BUG-01.1 spec 1.5).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as sampling from "../sampling.js";
import * as reportBadge from "./report-badge.js";

vi.mock("../sampling.js");
vi.mock("./report-badge.js");

import { handleReportBadgePresented } from "./report-badge-presented-handler.js";

describe("handleReportBadgePresented (payclaw_reportBadgePresented tool)", () => {
  beforeEach(() => {
    vi.mocked(sampling.onIdentityPresented).mockClear();
    vi.mocked(reportBadge.reportBadgePresented).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls onIdentityPresented with verification_token and merchant", async () => {
    await handleReportBadgePresented("tok_abc123xyz", "merchant.com");

    expect(sampling.onIdentityPresented).toHaveBeenCalledTimes(1);
    expect(sampling.onIdentityPresented).toHaveBeenCalledWith(
      "tok_abc123xyz",
      "merchant.com"
    );
  });

  it("calls reportBadgePresented with same token and merchant", async () => {
    await handleReportBadgePresented("tok_abc123xyz", "merchant.com");

    expect(reportBadge.reportBadgePresented).toHaveBeenCalledTimes(1);
    expect(reportBadge.reportBadgePresented).toHaveBeenCalledWith(
      "tok_abc123xyz",
      "merchant.com",
      undefined
    );
  });

  it("returns response including Badge presentation logged and merchant", async () => {
    const result = await handleReportBadgePresented("tok_abc123xyz", "starbucks.com");

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(text).toContain("Badge presentation logged");
    expect(text).toContain("starbucks.com");
    expect(text).toContain("Tracking");
    expect(text).toContain("Authorization: Bearer");
    expect(text).toContain("tok_abc123**"); // slice(0,10) of tok_abc123xyz
  });

  it("passes context to reportBadgePresented when provided", async () => {
    await handleReportBadgePresented("tok", "m", "checkout");

    expect(reportBadge.reportBadgePresented).toHaveBeenCalledWith("tok", "m", "checkout");
  });

  it("returns response with empty merchant without throwing", async () => {
    const result = await handleReportBadgePresented("tok_xyz", "");

    expect(result.content).toHaveLength(1);
    expect(sampling.onIdentityPresented).toHaveBeenCalledWith("tok_xyz", "");
    expect(reportBadge.reportBadgePresented).toHaveBeenCalledWith("tok_xyz", "", undefined);
  });
});
