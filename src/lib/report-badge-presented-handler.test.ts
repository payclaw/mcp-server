/**
 * Integration tests for kya_reportBadgePresented tool flow (BUG-01.1 spec 1.5).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as sampling from "../sampling.js";
import * as reportBadge from "./report-badge.js";

vi.mock("../sampling.js");
vi.mock("./report-badge.js");

import { handleReportBadgePresented } from "./report-badge-presented-handler.js";

describe("handleReportBadgePresented (kya_reportBadgePresented tool)", () => {
  beforeEach(() => {
    vi.mocked(sampling.onIdentityPresented).mockClear();
    vi.mocked(reportBadge.reportBadgePresented).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls onIdentityPresented with verification_token, merchant, and tripId", async () => {
    await handleReportBadgePresented("tok_abc123xyz", "merchant.com");

    expect(sampling.onIdentityPresented).toHaveBeenCalledTimes(1);
    expect(sampling.onIdentityPresented).toHaveBeenCalledWith(
      "tok_abc123xyz",
      "merchant.com",
      undefined
    );
  });

  it("calls reportBadgePresented with same token and merchant", async () => {
    await handleReportBadgePresented("tok_abc123xyz", "merchant.com");

    expect(reportBadge.reportBadgePresented).toHaveBeenCalledTimes(1);
    expect(reportBadge.reportBadgePresented).toHaveBeenCalledWith(
      "tok_abc123xyz",
      "merchant.com",
      undefined,
      undefined,
      undefined
    );
  });

  it("returns { recorded: true } as first content block", async () => {
    const result = await handleReportBadgePresented("tok_abc123xyz", "starbucks.com");

    expect(result.content[0]).toEqual({ type: "text", text: JSON.stringify({ recorded: true }) });
  });

  it("returns human-readable summary as second content block", async () => {
    const result = await handleReportBadgePresented("tok_abc123xyz", "starbucks.com");

    const text = result.content[1].text;
    expect(text).toContain("Badge presentation logged");
    expect(text).toContain("starbucks.com");
    expect(text).toContain("Tracking");
    expect(text).toContain("Authorization: Bearer");
    expect(text).toContain("tok_abc123**"); // slice(0,10) of tok_abc123xyz
  });

  it("passes context to reportBadgePresented when provided", async () => {
    await handleReportBadgePresented("tok", "m", "checkout");

    expect(reportBadge.reportBadgePresented).toHaveBeenCalledWith("tok", "m", "checkout", undefined, undefined);
  });

  it("passes checkoutSessionId to reportBadgePresented when provided", async () => {
    await handleReportBadgePresented("tok", "m", "checkout", "session-123");

    expect(reportBadge.reportBadgePresented).toHaveBeenCalledWith("tok", "m", "checkout", "session-123", undefined);
  });

  it("returns response with empty merchant without throwing", async () => {
    const result = await handleReportBadgePresented("tok_xyz", "");

    expect(result.content).toHaveLength(2);
    expect(sampling.onIdentityPresented).toHaveBeenCalledWith("tok_xyz", "", undefined);
    expect(reportBadge.reportBadgePresented).toHaveBeenCalledWith("tok_xyz", "", undefined, undefined, undefined);
  });

  it("passes tripId to both onIdentityPresented and reportBadgePresented (v2.1)", async () => {
    await handleReportBadgePresented("tok", "m", "arrival", undefined, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

    expect(sampling.onIdentityPresented).toHaveBeenCalledWith(
      "tok", "m", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    );
    expect(reportBadge.reportBadgePresented).toHaveBeenCalledWith(
      "tok", "m", "arrival", undefined, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    );
  });
});
