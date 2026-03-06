import { describe, it, expect } from "vitest";
import { parseResponse } from "./parse-outcome.js";

describe("parseResponse", () => {
  it('returns "denied" for "yes"', () => {
    expect(parseResponse("yes")).toBe("denied");
  });

  it('returns "accepted" for "no"', () => {
    expect(parseResponse("no")).toBe("accepted");
  });

  it('returns "accepted" for "NO"', () => {
    expect(parseResponse("NO")).toBe("accepted");
  });

  it('returns "denied" for "blocked"', () => {
    expect(parseResponse("blocked")).toBe("denied");
  });

  it('returns "denied" for "403"', () => {
    expect(parseResponse("403")).toBe("denied");
  });

  it('returns "accepted" for "no, I was not denied"', () => {
    expect(parseResponse("no, I was not denied")).toBe("accepted");
  });

  it('returns "inconclusive" for empty string', () => {
    expect(parseResponse("")).toBe("inconclusive");
  });

  it('returns "inconclusive" for gibberish', () => {
    expect(parseResponse("maybe")).toBe("inconclusive");
  });

  it('returns "accepted" for "no."', () => {
    expect(parseResponse("no.")).toBe("accepted");
  });

  it('returns "accepted" for "no,"', () => {
    expect(parseResponse("no,")).toBe("accepted");
  });

  it('returns "denied" for contradictory response "no, I was blocked"', () => {
    expect(parseResponse("no, I was blocked")).toBe("denied");
  });

  it('returns "inconclusive" for "yesterday"', () => {
    expect(parseResponse("yesterday")).toBe("inconclusive");
  });
});
