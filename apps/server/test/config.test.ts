import { describe, expect, it } from "vitest";
import { parseServerConfig } from "../src/config.js";

describe("Server configuration", () => {
  it("returns default configuration when environment is empty", () => {
    const config = parseServerConfig({});
    expect(config).toEqual({
      host: "0.0.0.0",
      port: 3000,
      dbPath: "./data/finance-game.sqlite",
    });
  });

  it("parses valid custom configuration values", () => {
    const config = parseServerConfig({
      FINANCE_GAME_HOST: "127.0.0.1",
      FINANCE_GAME_PORT: "4000",
      FINANCE_GAME_DB_PATH: "./custom/db.sqlite",
    });
    expect(config).toEqual({
      host: "127.0.0.1",
      port: 4000,
      dbPath: "./custom/db.sqlite",
    });
  });

  it("rejects invalid port values", () => {
    expect(() => parseServerConfig({ FINANCE_GAME_PORT: "0" })).toThrow(
      /Invalid server configuration.*port/i,
    );
    expect(() => parseServerConfig({ FINANCE_GAME_PORT: "65536" })).toThrow(
      /Invalid server configuration.*port/i,
    );
    expect(() => parseServerConfig({ FINANCE_GAME_PORT: "-5" })).toThrow(
      /Invalid server configuration.*port/i,
    );
    expect(() =>
      parseServerConfig({ FINANCE_GAME_PORT: "not-a-number" }),
    ).toThrow(/Invalid server configuration.*port/i);
    expect(() => parseServerConfig({ FINANCE_GAME_PORT: "3000.5" })).toThrow(
      /Invalid server configuration.*port/i,
    );
  });

  it("rejects empty or whitespace-only database path", () => {
    expect(() => parseServerConfig({ FINANCE_GAME_DB_PATH: "" })).toThrow(
      /Invalid server configuration.*dbPath/i,
    );
    expect(() => parseServerConfig({ FINANCE_GAME_DB_PATH: "   " })).toThrow(
      /Invalid server configuration.*dbPath/i,
    );
  });

  it("rejects empty host", () => {
    expect(() => parseServerConfig({ FINANCE_GAME_HOST: "" })).toThrow(
      /Invalid server configuration.*host/i,
    );
    expect(() => parseServerConfig({ FINANCE_GAME_HOST: "   " })).toThrow(
      /Invalid server configuration.*host/i,
    );
  });
});
