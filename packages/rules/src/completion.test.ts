import { describe, expect, it } from "vitest";
import {
  ASSET_UNDERWRITING,
  BANK_CREDIT_GRADES,
  COMPLETION_ECONOMY_TARGETS,
  OBJECTIVE_TARGETS,
} from "./completion";
import { ECONOMIC_REGIME_IDS } from "./economy";
import { OBJECTIVE_IDS } from "./objectives";

describe("M7 completion policy integrity", () => {
  it("covers every canonical regime and objective ID", () => {
    expect(Object.keys(COMPLETION_ECONOMY_TARGETS)).toEqual(
      ECONOMIC_REGIME_IDS,
    );
    expect(Object.keys(OBJECTIVE_TARGETS)).toEqual(OBJECTIVE_IDS);
    for (const target of Object.values(OBJECTIVE_TARGETS)) {
      for (const amount of Object.values(target)) {
        expect(Number.isSafeInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThan(0);
      }
    }
  });

  it("makes stronger credit require more reserves and charge a lower spread", () => {
    for (let index = 1; index < BANK_CREDIT_GRADES.length; index++) {
      const stronger = BANK_CREDIT_GRADES[index - 1];
      const weaker = BANK_CREDIT_GRADES[index];
      if (!stronger || !weaker) throw new Error("Missing credit grade");
      expect(stronger.reserveQuarters).toBeGreaterThan(weaker.reserveQuarters);
      expect(stronger.spreadBps).toBeLessThan(weaker.spreadBps);
      if (
        stronger.maxDebtServiceBps !== null &&
        weaker.maxDebtServiceBps !== null
      ) {
        expect(stronger.maxDebtServiceBps).toBeLessThan(
          weaker.maxDebtServiceBps,
        );
      }
    }
  });

  it("tightens leverage and coverage together as credit deteriorates", () => {
    const environments = Object.values(ASSET_UNDERWRITING);
    for (let index = 1; index < environments.length; index++) {
      const previous = environments[index - 1];
      const current = environments[index];
      if (!previous || !current) throw new Error("Missing credit environment");
      expect(current.propertyLtvBps).toBeLessThan(previous.propertyLtvBps);
      expect(current.businessShareBps).toBeLessThan(previous.businessShareBps);
      expect(current.propertyDscrBps).toBeGreaterThan(previous.propertyDscrBps);
      expect(current.businessDscrBps).toBeGreaterThan(previous.businessDscrBps);
    }
  });

  it("prevents a consumer from rewriting shared pricing or objective data", () => {
    expect(() =>
      Object.assign(BANK_CREDIT_GRADES[0], { spreadBps: 0 }),
    ).toThrow(TypeError);
    expect(() =>
      Object.assign(ASSET_UNDERWRITING.normal, { propertyLtvBps: 10_000 }),
    ).toThrow(TypeError);
    expect(() =>
      Object.assign(OBJECTIVE_TARGETS.founder, { businessEquityCents: 1 }),
    ).toThrow(TypeError);
  });
});
