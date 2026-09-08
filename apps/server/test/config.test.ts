import { describe, expect, it } from "vitest";
import { parseServerConfig } from "../src/config.js";

describe("Server configuration", () => {
  it("returns default configuration when environment is empty", () => {
    const config = parseServerConfig({});
    expect(config).toEqual({
      host: "0.0.0.0",
      port: 3000,
      dbPath: "./data/interests.sqlite",
      cookieSecure: false,
      rateLimitDisabled: false,
    });
  });

  it("parses valid custom configuration values", () => {
    const config = parseServerConfig({
      INTERESTS_HOST: "127.0.0.1",
      INTERESTS_PORT: "4000",
      INTERESTS_DB_PATH: "./custom/db.sqlite",
      INTERESTS_COOKIE_SECURE: "true",
      INTERESTS_RATE_LIMIT_DISABLED: "true",
    });
    expect(config).toEqual({
      host: "127.0.0.1",
      port: 4000,
      dbPath: "./custom/db.sqlite",
      cookieSecure: true,
      rateLimitDisabled: true,
    });
  });

  it("strictly parses INTERESTS_COOKIE_SECURE as boolean", () => {
    expect(
      parseServerConfig({ INTERESTS_COOKIE_SECURE: "true" }).cookieSecure,
    ).toBe(true);
    expect(
      parseServerConfig({ INTERESTS_COOKIE_SECURE: "false" }).cookieSecure,
    ).toBe(false);
    expect(
      parseServerConfig({ INTERESTS_COOKIE_SECURE: "TRUE" }).cookieSecure,
    ).toBe(true);
    expect(
      parseServerConfig({ INTERESTS_COOKIE_SECURE: "FALSE" }).cookieSecure,
    ).toBe(false);

    // Naive boolean coercion would turn these into true; our parser must reject them
    expect(() => parseServerConfig({ INTERESTS_COOKIE_SECURE: "1" })).toThrow(
      /Invalid server configuration: cookieSecure/,
    );
    expect(() => parseServerConfig({ INTERESTS_COOKIE_SECURE: "0" })).toThrow(
      /Invalid server configuration: cookieSecure/,
    );
    expect(() => parseServerConfig({ INTERESTS_COOKIE_SECURE: "yes" })).toThrow(
      /Invalid server configuration: cookieSecure/,
    );
  });

  it("rejects invalid port values", () => {
    expect(() => parseServerConfig({ INTERESTS_PORT: "0" })).toThrow(
      /Invalid server configuration.*port/i,
    );
    expect(() => parseServerConfig({ INTERESTS_PORT: "65536" })).toThrow(
      /Invalid server configuration.*port/i,
    );
    expect(() => parseServerConfig({ INTERESTS_PORT: "-5" })).toThrow(
      /Invalid server configuration.*port/i,
    );
    expect(() => parseServerConfig({ INTERESTS_PORT: "not-a-number" })).toThrow(
      /Invalid server configuration.*port/i,
    );
    expect(() => parseServerConfig({ INTERESTS_PORT: "3000.5" })).toThrow(
      /Invalid server configuration.*port/i,
    );
  });

  it("rejects empty or whitespace-only database path", () => {
    expect(() => parseServerConfig({ INTERESTS_DB_PATH: "" })).toThrow(
      /Invalid server configuration.*dbPath/i,
    );
    expect(() => parseServerConfig({ INTERESTS_DB_PATH: "   " })).toThrow(
      /Invalid server configuration.*dbPath/i,
    );
  });

  it("rejects empty host", () => {
    expect(() => parseServerConfig({ INTERESTS_HOST: "" })).toThrow(
      /Invalid server configuration.*host/i,
    );
    expect(() => parseServerConfig({ INTERESTS_HOST: "   " })).toThrow(
      /Invalid server configuration.*host/i,
    );
  });
});
