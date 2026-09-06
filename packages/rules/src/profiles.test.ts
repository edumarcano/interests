import { describe, expect, it } from "vitest";
import { PROFILE_IDS, PROFILES, type ProfileId } from "./profiles";

const EXPECTED_SECTION_15_2_STARTING_CASH: Record<ProfileId, number> = {
  "high-income-professional": 5_000_000,
  "corporate-climber": 3_500_000,
  "disciplined-saver": 10_500_000,
  "small-business-owner": 3_000_000,
  "property-starter": 2_800_000,
  "market-investor": 2_500_000,
  "self-employed-operator": 4_000_000,
  "early-stage-entrepreneur": 2_000_000,
};

describe("profile starting cash rule data", () => {
  it("defines starting cash for all eight standard profiles", () => {
    expect(PROFILE_IDS).toHaveLength(8);
    for (const profileId of PROFILE_IDS) {
      const profile = PROFILES[profileId];
      expect(profile).toBeDefined();
      expect(profile.startingCashCents).toBeDefined();
    }
  });

  it("ensures each starting cash value is a non-negative safe integer", () => {
    for (const profileId of PROFILE_IDS) {
      const { startingCashCents } = PROFILES[profileId];
      expect(Number.isSafeInteger(startingCashCents)).toBe(true);
      expect(startingCashCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("matches GAME_DESIGN.md Section 15.2 opening balance sheet values exactly", () => {
    for (const profileId of PROFILE_IDS) {
      const { startingCashCents } = PROFILES[profileId];
      expect(startingCashCents).toBe(
        EXPECTED_SECTION_15_2_STARTING_CASH[profileId],
      );
    }
  });

  it("exposes single authoritative source for starting cash via startingFinances", () => {
    for (const profileId of PROFILE_IDS) {
      const profile = PROFILES[profileId];
      expect(profile.startingCashCents).toBe(
        profile.startingFinances.startingCashCents,
      );
    }
  });

  it("defines exact personal income, living expenses, and debt payments from Section 15.1", () => {
    const prof = PROFILES["high-income-professional"].startingFinances;
    expect(prof.annualIncomeCents).toBe(15_000_000);
    expect(prof.monthlyLivingExpenseCents).toBe(650_000);
    expect(prof.openingPersonalDebtPrincipalCents).toBe(5_500_000);
    expect(prof.monthlyPersonalDebtPaymentCents).toBe(85_000);

    const climber = PROFILES["corporate-climber"].startingFinances;
    expect(climber.annualIncomeCents).toBe(10_000_000);
    expect(climber.monthlyLivingExpenseCents).toBe(460_000);
    expect(climber.openingPersonalDebtPrincipalCents).toBe(1_800_000);
    expect(climber.monthlyPersonalDebtPaymentCents).toBe(45_000);

    const saver = PROFILES["disciplined-saver"].startingFinances;
    expect(saver.annualIncomeCents).toBe(7_200_000);
    expect(saver.monthlyLivingExpenseCents).toBe(340_000);
    expect(saver.openingPersonalDebtPrincipalCents).toBe(500_000);
    expect(saver.monthlyPersonalDebtPaymentCents).toBe(15_000);

    const sbo = PROFILES["small-business-owner"].startingFinances;
    expect(sbo.annualIncomeCents).toBe(6_800_000);
    expect(sbo.monthlyLivingExpenseCents).toBe(400_000);
    expect(sbo.openingPersonalDebtPrincipalCents).toBe(1_000_000);
    expect(sbo.monthlyPersonalDebtPaymentCents).toBe(25_000);

    const prop = PROFILES["property-starter"].startingFinances;
    expect(prop.annualIncomeCents).toBe(7_800_000);
    expect(prop.monthlyLivingExpenseCents).toBe(420_000);
    expect(prop.openingPersonalDebtPrincipalCents).toBe(0);
    expect(prop.monthlyPersonalDebtPaymentCents).toBe(0);

    const inv = PROFILES["market-investor"].startingFinances;
    expect(inv.annualIncomeCents).toBe(7_600_000);
    expect(inv.monthlyLivingExpenseCents).toBe(400_000);
    expect(inv.openingPersonalDebtPrincipalCents).toBe(1_000_000);
    expect(inv.monthlyPersonalDebtPaymentCents).toBe(25_000);

    const op = PROFILES["self-employed-operator"].startingFinances;
    expect(op.annualIncomeCents).toBe(9_600_000);
    expect(op.monthlyLivingExpenseCents).toBe(430_000);
    expect(op.openingPersonalDebtPrincipalCents).toBe(800_000);
    expect(op.monthlyPersonalDebtPaymentCents).toBe(20_000);

    const ent = PROFILES["early-stage-entrepreneur"].startingFinances;
    expect(ent.annualIncomeCents).toBe(4_500_000);
    expect(ent.monthlyLivingExpenseCents).toBe(320_000);
    expect(ent.openingPersonalDebtPrincipalCents).toBe(0);
    expect(ent.monthlyPersonalDebtPaymentCents).toBe(0);
  });

  it("configures Property Starter property and mortgage fixtures", () => {
    const prop = PROFILES["property-starter"].startingFinances;
    expect(prop.propertyFixture).toEqual({
      marketValueCents: 33_000_000,
      scheduledQuarterlyRentCents: 945_000,
      occupancyBps: 9_500,
      operatingExpenseRatioBps: 3_500,
      ownershipPpm: 1_000_000,
    });
    expect(prop.mortgageFixture).toEqual({
      openingPrincipalCents: 25_500_000,
      annualRateBps: 550,
      scheduledQuarterlyPaymentCents: 433_537,
    });
  });

  it("configures business fixtures for the three entrepreneur/operator profiles", () => {
    const sbo =
      PROFILES["small-business-owner"].startingFinances.businessFixture;
    expect(sbo).toEqual({
      annualRevenueCents: 50_000_000,
      annualOperatingProfitCents: 8_000_000,
      enterpriseValueCents: 32_000_000,
      debtPrincipalCents: 6_000_000,
      ownershipPpm: 1_000_000,
    });

    const op =
      PROFILES["self-employed-operator"].startingFinances.businessFixture;
    expect(op).toEqual({
      annualRevenueCents: 15_500_000,
      annualOperatingProfitCents: 10_000_000,
      enterpriseValueCents: 9_000_000,
      debtPrincipalCents: 2_000_000,
      ownershipPpm: 1_000_000,
    });

    const ent =
      PROFILES["early-stage-entrepreneur"].startingFinances.businessFixture;
    expect(ent).toEqual({
      annualRevenueCents: 30_000_000,
      annualOperatingProfitCents: 5_400_000,
      enterpriseValueCents: 23_000_000,
      debtPrincipalCents: 6_000_000,
      ownershipPpm: 1_000_000,
    });
  });

  it("ensures starting business fixtures satisfy debt <= enterprise value and non-negative equity", () => {
    const businessProfiles = [
      "small-business-owner",
      "self-employed-operator",
      "early-stage-entrepreneur",
    ] as const;

    for (const profileId of businessProfiles) {
      const biz = PROFILES[profileId].startingFinances.businessFixture;
      expect(biz).toBeDefined();
      if (!biz) throw new Error("Missing business fixture");
      expect(biz.debtPrincipalCents).toBeLessThanOrEqual(
        biz.enterpriseValueCents,
      );
      const equityCents = biz.enterpriseValueCents - biz.debtPrincipalCents;
      expect(equityCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("matches GAME_DESIGN.md Section 15.2 starting public investments exactly", () => {
    const expectedPublicInvestments: Record<ProfileId, number> = {
      "high-income-professional": 2_000_000,
      "corporate-climber": 1_000_000,
      "disciplined-saver": 500_000,
      "small-business-owner": 0,
      "property-starter": 700_000,
      "market-investor": 8_000_000,
      "self-employed-operator": 0,
      "early-stage-entrepreneur": 0,
    };

    for (const profileId of PROFILE_IDS) {
      const { startingPublicInvestmentsCents } =
        PROFILES[profileId].startingFinances;
      expect(Number.isSafeInteger(startingPublicInvestmentsCents)).toBe(true);
      expect(startingPublicInvestmentsCents).toBeGreaterThanOrEqual(0);
      expect(startingPublicInvestmentsCents).toBe(
        expectedPublicInvestments[profileId],
      );
    }
  });
});
