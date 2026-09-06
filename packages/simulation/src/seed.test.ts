import { describe, expect, it } from "vitest";
import { createSimulationSeed, DEFAULT_SIMULATION_SEED_PREFIX } from "./seed";

describe("createSimulationSeed", () => {
  it("generates deterministic seeds with default prefix", () => {
    expect(createSimulationSeed(DEFAULT_SIMULATION_SEED_PREFIX, 0)).toBe(
      "baseline-v1:000000",
    );
    expect(createSimulationSeed(DEFAULT_SIMULATION_SEED_PREFIX, 1)).toBe(
      "baseline-v1:000001",
    );
    expect(createSimulationSeed(DEFAULT_SIMULATION_SEED_PREFIX, 7)).toBe(
      "baseline-v1:000007",
    );
    expect(createSimulationSeed(DEFAULT_SIMULATION_SEED_PREFIX, 42)).toBe(
      "baseline-v1:000042",
    );
    expect(createSimulationSeed(DEFAULT_SIMULATION_SEED_PREFIX, 999)).toBe(
      "baseline-v1:000999",
    );
  });

  it("does not truncate indices above 6 digits", () => {
    expect(
      createSimulationSeed(DEFAULT_SIMULATION_SEED_PREFIX, 1_000_000),
    ).toBe("baseline-v1:1000000");
    expect(
      createSimulationSeed(DEFAULT_SIMULATION_SEED_PREFIX, 9_999_999),
    ).toBe("baseline-v1:9999999");
  });

  it("supports custom seed prefixes", () => {
    expect(createSimulationSeed("dev", 0)).toBe("dev:000000");
    expect(createSimulationSeed("custom-fixture", 123)).toBe(
      "custom-fixture:000123",
    );
  });

  it("rejects invalid seed prefixes", () => {
    expect(() => createSimulationSeed("", 0)).toThrow(TypeError);
    expect(() => createSimulationSeed("   ", 0)).toThrow(TypeError);
    expect(() => createSimulationSeed(null as unknown as string, 0)).toThrow(
      TypeError,
    );
  });

  it("rejects invalid game indices", () => {
    expect(() =>
      createSimulationSeed(DEFAULT_SIMULATION_SEED_PREFIX, -1),
    ).toThrow(RangeError);
    expect(() =>
      createSimulationSeed(DEFAULT_SIMULATION_SEED_PREFIX, 1.5),
    ).toThrow(RangeError);
    expect(() =>
      createSimulationSeed(DEFAULT_SIMULATION_SEED_PREFIX, Number.NaN),
    ).toThrow(RangeError);
    expect(() =>
      createSimulationSeed(
        DEFAULT_SIMULATION_SEED_PREFIX,
        Number.MAX_SAFE_INTEGER + 1,
      ),
    ).toThrow(RangeError);
  });
});
