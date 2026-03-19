import { describe, it, expect } from "vitest";
import { parseResponse } from "./parse-outcome.js";

describe("parseResponse", () => {
  it('returns "denied" for "yes"', () => {
    expect(parseResponse("yes")).toBe("denied");
  });

  it('returns "not_denied" for "no"', () => {
    expect(parseResponse("no")).toBe("not_denied");
  });

  it('returns "not_denied" for "NO"', () => {
    expect(parseResponse("NO")).toBe("not_denied");
  });

  it('returns "denied" for "blocked"', () => {
    expect(parseResponse("blocked")).toBe("denied");
  });

  it('returns "denied" for "403"', () => {
    expect(parseResponse("403")).toBe("denied");
  });

  it('returns "not_denied" for "no, I was not denied"', () => {
    expect(parseResponse("no, I was not denied")).toBe("not_denied");
  });

  it('returns "unparseable" for empty string', () => {
    expect(parseResponse("")).toBe("unparseable");
  });

  it('returns "unparseable" for gibberish', () => {
    expect(parseResponse("maybe")).toBe("unparseable");
  });

  it('returns "not_denied" for "no."', () => {
    expect(parseResponse("no.")).toBe("not_denied");
  });

  it('returns "not_denied" for "no,"', () => {
    expect(parseResponse("no,")).toBe("not_denied");
  });

  it('returns "denied" for contradictory response "no, I was blocked"', () => {
    expect(parseResponse("no, I was blocked")).toBe("denied");
  });

  it('returns "unparseable" for "yesterday"', () => {
    expect(parseResponse("yesterday")).toBe("unparseable");
  });
});
