import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isPublicOrigin } from "./url-safety.js";

describe("isPublicOrigin", () => {
  beforeEach(() => {
    process.env.VITEST = "true";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // --- Public origins (should pass) ---

  it("allows public HTTPS URLs", () => {
    expect(isPublicOrigin("https://example.com")).toBe(true);
    expect(isPublicOrigin("https://walmart.com")).toBe(true);
    expect(isPublicOrigin("https://etsy.com/products")).toBe(true);
  });

  it("allows HTTP in test mode (VITEST env set)", () => {
    expect(isPublicOrigin("http://example.com")).toBe(true);
  });

  it("blocks HTTP when VITEST is not set", () => {
    delete process.env.VITEST;
    expect(isPublicOrigin("http://example.com")).toBe(false);
  });

  // --- Localhost / loopback ---

  it("blocks localhost", () => {
    expect(isPublicOrigin("https://localhost")).toBe(false);
    expect(isPublicOrigin("https://localhost:3000")).toBe(false);
  });

  it("blocks .localhost subdomains", () => {
    expect(isPublicOrigin("https://evil.localhost")).toBe(false);
  });

  it("blocks 127.0.0.1", () => {
    expect(isPublicOrigin("https://127.0.0.1")).toBe(false);
    expect(isPublicOrigin("https://127.0.0.1:8080")).toBe(false);
  });

  it("blocks IPv6 loopback ::1", () => {
    expect(isPublicOrigin("https://[::1]")).toBe(false);
  });

  // --- RFC1918 private ranges ---

  it("blocks 10.0.0.0/8", () => {
    expect(isPublicOrigin("https://10.0.0.1")).toBe(false);
    expect(isPublicOrigin("https://10.255.255.255")).toBe(false);
  });

  it("blocks 172.16.0.0/12", () => {
    expect(isPublicOrigin("https://172.16.0.1")).toBe(false);
    expect(isPublicOrigin("https://172.31.255.255")).toBe(false);
  });

  it("allows 172.x outside /12 range", () => {
    expect(isPublicOrigin("https://172.15.0.1")).toBe(true);
    expect(isPublicOrigin("https://172.32.0.1")).toBe(true);
  });

  it("blocks 192.168.0.0/16", () => {
    expect(isPublicOrigin("https://192.168.1.1")).toBe(false);
    expect(isPublicOrigin("https://192.168.0.1")).toBe(false);
  });

  // --- Link-local / metadata ---

  it("blocks 169.254.0.0/16 (link-local + AWS metadata)", () => {
    expect(isPublicOrigin("https://169.254.169.254")).toBe(false);
    expect(isPublicOrigin("https://169.254.0.1")).toBe(false);
  });

  it("blocks 0.0.0.0/8", () => {
    expect(isPublicOrigin("https://0.0.0.0")).toBe(false);
  });

  // --- IPv6 private ranges ---

  it("blocks IPv6 link-local (fe80::)", () => {
    expect(isPublicOrigin("https://[fe80::1]")).toBe(false);
  });

  it("blocks IPv6 ULA (fc/fd)", () => {
    expect(isPublicOrigin("https://[fc00::1]")).toBe(false);
    expect(isPublicOrigin("https://[fd00::1]")).toBe(false);
  });

  // --- Malformed ---

  it("blocks malformed URLs", () => {
    expect(isPublicOrigin("not-a-url")).toBe(false);
    expect(isPublicOrigin("")).toBe(false);
  });
});
