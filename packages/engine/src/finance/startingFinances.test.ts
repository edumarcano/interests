import {
  OPENING_PERSONAL_DEBT_APR_BPS,
  PROPERTY_STARTER_MORTGAGE_APR_BPS,
  PROPERTY_STARTER_MORTGAGE_QUARTERLY_PAYMENT_CENTS,
  type ProfileId,
  STARTING_FINANCES_BY_PROFILE,
} from "@finance-game/rules";
import {
  type AssetId,
  asAssetId,
  asLoanId,
  asPlayerId,
  type LoanId,
  type PlayerId,
} from "@finance-game/shared";
import { describe, expect, it } from "vitest";

import { applyAction } from "../game/actions";
import { createGame } from "../game/createGame";
import { assertGameState } from "../invariants/assertGameState";
import type {
  BusinessAsset,
  GameState,
  LegacyBankLoan,
  PropertyAsset,
} from "../model/gameState";
import { calculateLegacyBankLoanNextPayment } from "./amortization";
import { calculateBusinessEquity } from "./business";
import { applyScheduledPlayerLoanPayment } from "./loans";
import { basisPoints, cents } from "./money";
import { ownershipPpm } from "./ownership";
import { calculatePropertyCashFlow } from "./property";
import { settleQuarter } from "./settlement";

const p1 = asPlayerId("player-1");
const p2 = asPlayerId("player-2");
const p3 = asPlayerId("player-3");
const p4 = asPlayerId("player-4");
const playerIds = [p1, p2, p3, p4] as const;

function createReadyGame(options?: {
  readonly gameId?: string;
  readonly seed?: string;
  readonly playerIds?: readonly [typeof p1, typeof p2, typeof p3, typeof p4];
}): GameState {
  let state = createGame({
    gameId: options?.gameId ?? "starting-finance-game",
    seed: options?.seed ?? "starting-finance-seed",
    playerIds: options?.playerIds ?? playerIds,
  });

  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    if (player === undefined) {
      throw new Error(`Missing player ${playerId}`);
    }
    const objectiveId = player.offeredObjectiveIds[0];
    if (objectiveId === undefined) {
      throw new Error(`Missing objective offer for player ${playerId}`);
    }
    const result = applyAction(state, {
      type: "CHOOSE_OBJECTIVE",
      playerId,
      objectiveId,
    });
    if (!result.ok) {
      throw new Error(
        `Failed to choose objective for player ${playerId}: ${result.code}`,
      );
    }
    state = result.state;
  }

  return state;
}

/**
 * Creates a synthetic GameState configured specifically for a single profile test.
 * The given profile is applied to player-1, with zero recurring income/expense for others.
 */
function createSyntheticProfileGame(profileId: ProfileId): {
  state: GameState;
  playerId: PlayerId;
  loanId?: LoanId;
  assetId?: AssetId;
} {
  const base = createReadyGame();
  const profileFinances = STARTING_FINANCES_BY_PROFILE[profileId];

  const loansById: Record<LoanId, LegacyBankLoan> = {};
  const assetsById: Record<AssetId, PropertyAsset | BusinessAsset> = {};
  const cashByPlayer = { ...base.finance.cashByPlayer };
  const recurringByPlayer = { ...base.finance.recurringByPlayer };

  // Set up player-1
  cashByPlayer[p1] = cents(profileFinances.startingCashCents);
  recurringByPlayer[p1] = {
    quarterlyIncomeCents: cents(
      Math.trunc(profileFinances.annualIncomeCents / 4),
    ),
    quarterlyLivingExpenseCents: cents(
      profileFinances.monthlyLivingExpenseCents * 3,
    ),
  };

  // Zero out others so they don't affect surplus assertions
  for (const pid of [p2, p3, p4]) {
    cashByPlayer[pid] = cents(1_000_000_000);
    recurringByPlayer[pid] = {
      quarterlyIncomeCents: cents(0),
      quarterlyLivingExpenseCents: cents(0),
    };
  }

  let createdLoanId: LoanId | undefined;
  let createdAssetId: AssetId | undefined;

  if (profileFinances.propertyFixture !== undefined) {
    createdAssetId = asAssetId("asset-prop-starter");
    const propAsset: PropertyAsset = {
      id: createdAssetId,
      kind: "property",
      marketValueCents: cents(profileFinances.propertyFixture.marketValueCents),
      scheduledQuarterlyRentCents: cents(
        profileFinances.propertyFixture.scheduledQuarterlyRentCents,
      ),
      occupancyBps: basisPoints(profileFinances.propertyFixture.occupancyBps),
      operatingExpenseRatioBps: basisPoints(
        profileFinances.propertyFixture.operatingExpenseRatioBps,
      ),
      ownershipByPlayerPpm: {
        [p1]: ownershipPpm(profileFinances.propertyFixture.ownershipPpm),
      },
    };
    assetsById[createdAssetId] = propAsset;

    if (profileFinances.mortgageFixture !== undefined) {
      createdLoanId = asLoanId("loan-starter-mortgage");
      const mortgage: LegacyBankLoan = {
        id: createdLoanId,
        kind: "legacy-bank-loan",
        borrowerPlayerId: p1,
        purpose: "property-mortgage",
        originalPrincipalCents: cents(
          profileFinances.mortgageFixture.openingPrincipalCents,
        ),
        outstandingPrincipalCents: cents(
          profileFinances.mortgageFixture.openingPrincipalCents,
        ),
        annualRateBps: basisPoints(
          profileFinances.mortgageFixture.annualRateBps,
        ),
        scheduledQuarterlyPaymentCents: cents(
          profileFinances.mortgageFixture.scheduledQuarterlyPaymentCents,
        ),
        paymentsApplied: 0,
        relatedAssetId: createdAssetId,
      };
      loansById[createdLoanId] = mortgage;
    }
  }

  if (profileFinances.businessFixture !== undefined) {
    createdAssetId = asAssetId("asset-starter-biz");
    const bizAsset: BusinessAsset = {
      id: createdAssetId,
      kind: "business",
      annualRevenueCents: cents(
        profileFinances.businessFixture.annualRevenueCents,
      ),
      annualOperatingProfitCents: cents(
        profileFinances.businessFixture.annualOperatingProfitCents,
      ),
      enterpriseValueCents: cents(
        profileFinances.businessFixture.enterpriseValueCents,
      ),
      debtPrincipalCents: cents(
        profileFinances.businessFixture.debtPrincipalCents,
      ),
      ownershipByPlayerPpm: {
        [p1]: ownershipPpm(profileFinances.businessFixture.ownershipPpm),
      },
    };
    assetsById[createdAssetId] = bizAsset;
  }

  if (profileFinances.openingPersonalDebtPrincipalCents > 0) {
    createdLoanId = asLoanId("loan-starter-personal-debt");
    const personalDebt: LegacyBankLoan = {
      id: createdLoanId,
      kind: "legacy-bank-loan",
      borrowerPlayerId: p1,
      purpose: "personal-debt",
      originalPrincipalCents: cents(
        profileFinances.openingPersonalDebtPrincipalCents,
      ),
      outstandingPrincipalCents: cents(
        profileFinances.openingPersonalDebtPrincipalCents,
      ),
      annualRateBps: basisPoints(OPENING_PERSONAL_DEBT_APR_BPS),
      scheduledQuarterlyPaymentCents: cents(
        profileFinances.monthlyPersonalDebtPaymentCents * 3,
      ),
      paymentsApplied: 0,
    };
    loansById[createdLoanId] = personalDebt;
  }

  const state: GameState = {
    ...base,
    finance: {
      ...base.finance,
      cashByPlayer,
      recurringByPlayer,
      loansById,
      assetsById,
    },
  };

  assertGameState(state);
  return {
    state,
    playerId: p1,
    loanId: createdLoanId,
    assetId: createdAssetId,
  };
}

describe("Standard V1 Starting Finances and Quarter-1 Settlement", () => {
  describe("Section 8: First-quarter personal debt arithmetic fixtures", () => {
    it("matches High-Income Professional debt arithmetic", () => {
      const payment = calculateLegacyBankLoanNextPayment({
        outstandingPrincipalCents: cents(5_500_000),
        annualRateBps: OPENING_PERSONAL_DEBT_APR_BPS,
        scheduledQuarterlyPaymentCents: cents(255_000),
      });
      expect(payment.interestCents).toBe(cents(110_000));
      expect(payment.principalCents).toBe(cents(145_000));
      expect(payment.paymentCents).toBe(cents(255_000));
      expect(payment.closingPrincipalCents).toBe(cents(5_355_000));
    });

    it("matches Corporate Climber debt arithmetic", () => {
      const payment = calculateLegacyBankLoanNextPayment({
        outstandingPrincipalCents: cents(1_800_000),
        annualRateBps: OPENING_PERSONAL_DEBT_APR_BPS,
        scheduledQuarterlyPaymentCents: cents(135_000),
      });
      expect(payment.interestCents).toBe(cents(36_000));
      expect(payment.principalCents).toBe(cents(99_000));
      expect(payment.paymentCents).toBe(cents(135_000));
      expect(payment.closingPrincipalCents).toBe(cents(1_701_000));
    });

    it("matches Disciplined Saver debt arithmetic", () => {
      const payment = calculateLegacyBankLoanNextPayment({
        outstandingPrincipalCents: cents(500_000),
        annualRateBps: OPENING_PERSONAL_DEBT_APR_BPS,
        scheduledQuarterlyPaymentCents: cents(45_000),
      });
      expect(payment.interestCents).toBe(cents(10_000));
      expect(payment.principalCents).toBe(cents(35_000));
      expect(payment.paymentCents).toBe(cents(45_000));
      expect(payment.closingPrincipalCents).toBe(cents(465_000));
    });

    it("matches Small Business Owner debt arithmetic", () => {
      const payment = calculateLegacyBankLoanNextPayment({
        outstandingPrincipalCents: cents(1_000_000),
        annualRateBps: OPENING_PERSONAL_DEBT_APR_BPS,
        scheduledQuarterlyPaymentCents: cents(75_000),
      });
      expect(payment.interestCents).toBe(cents(20_000));
      expect(payment.principalCents).toBe(cents(55_000));
      expect(payment.paymentCents).toBe(cents(75_000));
      expect(payment.closingPrincipalCents).toBe(cents(945_000));
    });

    it("matches Market Investor debt arithmetic", () => {
      const payment = calculateLegacyBankLoanNextPayment({
        outstandingPrincipalCents: cents(1_000_000),
        annualRateBps: OPENING_PERSONAL_DEBT_APR_BPS,
        scheduledQuarterlyPaymentCents: cents(75_000),
      });
      expect(payment.interestCents).toBe(cents(20_000));
      expect(payment.principalCents).toBe(cents(55_000));
      expect(payment.paymentCents).toBe(cents(75_000));
      expect(payment.closingPrincipalCents).toBe(cents(945_000));
    });

    it("matches Self-Employed Operator debt arithmetic", () => {
      const payment = calculateLegacyBankLoanNextPayment({
        outstandingPrincipalCents: cents(800_000),
        annualRateBps: OPENING_PERSONAL_DEBT_APR_BPS,
        scheduledQuarterlyPaymentCents: cents(60_000),
      });
      expect(payment.interestCents).toBe(cents(16_000));
      expect(payment.principalCents).toBe(cents(44_000));
      expect(payment.paymentCents).toBe(cents(60_000));
      expect(payment.closingPrincipalCents).toBe(cents(756_000));
    });
  });

  describe("Section 10: Property Starter mortgage arithmetic & net property contribution", () => {
    it("reconciles Property Starter property operating numbers", () => {
      const propOps = calculatePropertyCashFlow({
        scheduledQuarterlyRentCents: cents(945_000),
        occupancyBps: basisPoints(9_500),
        operatingExpenseRatioBps: basisPoints(3_500),
      });
      expect(propOps.effectiveRentCents).toBe(cents(897_750));
      expect(propOps.operatingExpensesCents).toBe(cents(314_213));
      expect(propOps.netOperatingIncomeCents).toBe(cents(583_537));
    });

    it("reconciles Property Starter mortgage payment arithmetic", () => {
      const mortgagePayment = calculateLegacyBankLoanNextPayment({
        outstandingPrincipalCents: cents(25_500_000),
        annualRateBps: PROPERTY_STARTER_MORTGAGE_APR_BPS,
        scheduledQuarterlyPaymentCents:
          PROPERTY_STARTER_MORTGAGE_QUARTERLY_PAYMENT_CENTS,
      });
      expect(mortgagePayment.interestCents).toBe(cents(350_625));
      expect(mortgagePayment.principalCents).toBe(cents(82_912));
      expect(mortgagePayment.paymentCents).toBe(cents(433_537));
      expect(mortgagePayment.closingPrincipalCents).toBe(cents(25_417_088));
    });

    it("reconciles net property quarterly contribution of exactly $1,500", () => {
      const propOps = calculatePropertyCashFlow({
        scheduledQuarterlyRentCents: cents(945_000),
        occupancyBps: basisPoints(9_500),
        operatingExpenseRatioBps: basisPoints(3_500),
      });
      const mortgagePayment = calculateLegacyBankLoanNextPayment({
        outstandingPrincipalCents: cents(25_500_000),
        annualRateBps: PROPERTY_STARTER_MORTGAGE_APR_BPS,
        scheduledQuarterlyPaymentCents:
          PROPERTY_STARTER_MORTGAGE_QUARTERLY_PAYMENT_CENTS,
      });
      const netContributionCents =
        propOps.netOperatingIncomeCents - mortgagePayment.paymentCents;
      expect(netContributionCents).toBe(cents(150_000)); // Exactly $1,500.00
    });
  });

  describe("Section 28: Opening business debt and equity reconciliation", () => {
    it("reconciles Small Business Owner business equity: $320k - $60k = $260k", () => {
      const bizFixture =
        STARTING_FINANCES_BY_PROFILE["small-business-owner"].businessFixture;
      expect(bizFixture).toBeDefined();
      if (!bizFixture) throw new Error("Missing fixture");
      expect(bizFixture.debtPrincipalCents).toBeLessThanOrEqual(
        bizFixture.enterpriseValueCents,
      );
      const equity = calculateBusinessEquity({
        annualRevenueCents: cents(bizFixture.annualRevenueCents),
        annualOperatingProfitCents: cents(
          bizFixture.annualOperatingProfitCents,
        ),
        enterpriseValueCents: cents(bizFixture.enterpriseValueCents),
        debtPrincipalCents: cents(bizFixture.debtPrincipalCents),
      });
      expect(equity.equityValueCents).toBe(cents(26_000_000));
      expect(equity.equityValueCents).toBeGreaterThanOrEqual(0);
    });

    it("reconciles Self-Employed Operator business equity: $90k - $20k = $70k", () => {
      const bizFixture =
        STARTING_FINANCES_BY_PROFILE["self-employed-operator"].businessFixture;
      expect(bizFixture).toBeDefined();
      if (!bizFixture) throw new Error("Missing fixture");
      expect(bizFixture.debtPrincipalCents).toBeLessThanOrEqual(
        bizFixture.enterpriseValueCents,
      );
      const equity = calculateBusinessEquity({
        annualRevenueCents: cents(bizFixture.annualRevenueCents),
        annualOperatingProfitCents: cents(
          bizFixture.annualOperatingProfitCents,
        ),
        enterpriseValueCents: cents(bizFixture.enterpriseValueCents),
        debtPrincipalCents: cents(bizFixture.debtPrincipalCents),
      });
      expect(equity.equityValueCents).toBe(cents(7_000_000));
      expect(equity.equityValueCents).toBeGreaterThanOrEqual(0);
    });

    it("reconciles Early-Stage Entrepreneur business equity: $230k - $60k = $170k", () => {
      const bizFixture =
        STARTING_FINANCES_BY_PROFILE["early-stage-entrepreneur"]
          .businessFixture;
      expect(bizFixture).toBeDefined();
      if (!bizFixture) throw new Error("Missing fixture");
      expect(bizFixture.debtPrincipalCents).toBeLessThanOrEqual(
        bizFixture.enterpriseValueCents,
      );
      const equity = calculateBusinessEquity({
        annualRevenueCents: cents(bizFixture.annualRevenueCents),
        annualOperatingProfitCents: cents(
          bizFixture.annualOperatingProfitCents,
        ),
        enterpriseValueCents: cents(bizFixture.enterpriseValueCents),
        debtPrincipalCents: cents(bizFixture.debtPrincipalCents),
      });
      expect(equity.equityValueCents).toBe(cents(17_000_000));
      expect(equity.equityValueCents).toBeGreaterThanOrEqual(0);
    });

    it("reconciles Property Starter opening property equity: $330k - $255k = $75k", () => {
      const propertyValue = cents(33_000_000);
      const mortgagePrincipal = cents(25_500_000);
      const propertyEquity = propertyValue - mortgagePrincipal;
      expect(propertyEquity).toBe(cents(7_500_000));
    });
  });

  describe("Sections 24 & 25: Quarter-1 core surplus and ending cash for all eight profiles", () => {
    const testCases: readonly {
      profileId: ProfileId;
      name: string;
      openingCashCents: number;
      expectedSurplusCents: number;
      expectedEndingCashCents: number;
    }[] = [
      {
        profileId: "high-income-professional",
        name: "High-Income Professional",
        openingCashCents: 5_000_000,
        expectedSurplusCents: 1_545_000,
        expectedEndingCashCents: 6_545_000,
      },
      {
        profileId: "corporate-climber",
        name: "Corporate Climber",
        openingCashCents: 3_500_000,
        expectedSurplusCents: 985_000,
        expectedEndingCashCents: 4_485_000,
      },
      {
        profileId: "disciplined-saver",
        name: "Disciplined Saver",
        openingCashCents: 10_500_000,
        expectedSurplusCents: 735_000,
        expectedEndingCashCents: 11_235_000,
      },
      {
        profileId: "small-business-owner",
        name: "Small Business Owner",
        openingCashCents: 3_000_000,
        expectedSurplusCents: 425_000,
        expectedEndingCashCents: 3_425_000,
      },
      {
        profileId: "property-starter",
        name: "Property Starter",
        openingCashCents: 2_800_000,
        expectedSurplusCents: 840_000,
        expectedEndingCashCents: 3_640_000,
      },
      {
        profileId: "market-investor",
        name: "Market Investor",
        openingCashCents: 2_500_000,
        expectedSurplusCents: 625_000,
        expectedEndingCashCents: 3_125_000,
      },
      {
        profileId: "self-employed-operator",
        name: "Self-Employed Operator",
        openingCashCents: 4_000_000,
        expectedSurplusCents: 1_050_000,
        expectedEndingCashCents: 5_050_000,
      },
      {
        profileId: "early-stage-entrepreneur",
        name: "Early-Stage Entrepreneur",
        openingCashCents: 2_000_000,
        expectedSurplusCents: 165_000,
        expectedEndingCashCents: 2_165_000,
      },
    ];

    for (const tc of testCases) {
      it(`reproduces exact Quarter-1 surplus and ending cash for ${tc.name}`, () => {
        const { state, playerId } = createSyntheticProfileGame(tc.profileId);
        const openingCash = state.finance.cashByPlayer[playerId];
        expect(openingCash).toBe(cents(tc.openingCashCents));

        const result = settleQuarter(state, { quarter: 1 });
        expect(result.ok).toBe(true);
        if (!result.ok) {
          throw new Error(`Quarter settlement failed: ${result.code}`);
        }

        const endingCash = result.state.finance.cashByPlayer[playerId];
        expect(endingCash).toBeDefined();
        expect(openingCash).toBeDefined();
        if (endingCash === undefined || openingCash === undefined) {
          throw new Error("Missing cash balance");
        }
        const actualSurplus = endingCash - openingCash;

        expect(actualSurplus).toBe(cents(tc.expectedSurplusCents));
        expect(endingCash).toBe(cents(tc.expectedEndingCashCents));
        assertGameState(result.state);
      });
    }
  });

  describe("Section 23: Business settlement remains excluded", () => {
    const businessProfiles = [
      "small-business-owner",
      "self-employed-operator",
      "early-stage-entrepreneur",
    ] as const;

    for (const profileId of businessProfiles) {
      it(`does not mutate business asset fields during Quarter 1 for ${profileId}`, () => {
        const { state, assetId } = createSyntheticProfileGame(profileId);
        expect(assetId).toBeDefined();
        if (assetId === undefined) {
          throw new Error("Expected assetId");
        }

        const bizBefore = state.finance.assetsById[assetId] as BusinessAsset;
        expect(bizBefore.kind).toBe("business");

        const result = settleQuarter(state, { quarter: 1 });
        expect(result.ok).toBe(true);
        if (!result.ok) {
          throw new Error("Settlement failed");
        }

        const bizAfter = result.state.finance.assetsById[
          assetId
        ] as BusinessAsset;
        expect(bizAfter).toEqual(bizBefore);
        expect(bizAfter.annualRevenueCents).toBe(bizBefore.annualRevenueCents);
        expect(bizAfter.annualOperatingProfitCents).toBe(
          bizBefore.annualOperatingProfitCents,
        );
        expect(bizAfter.enterpriseValueCents).toBe(
          bizBefore.enterpriseValueCents,
        );
        expect(bizAfter.debtPrincipalCents).toBe(bizBefore.debtPrincipalCents);
        expect(bizAfter.ownershipByPlayerPpm).toEqual(
          bizBefore.ownershipByPlayerPpm,
        );
      });
    }
  });

  describe("Section 26: Full 4-player game integration test", () => {
    it("runs deterministic profile assignment, objective selection, and Quarter 1 reconciliation", () => {
      const state = createReadyGame({
        gameId: "4p-integration-game",
        seed: "deterministic-integration-seed",
        playerIds,
      });

      // Verify each player has an assigned profile and matching recurring finance
      for (const pid of playerIds) {
        const player = state.players[pid];
        expect(player).toBeDefined();
        if (player === undefined) {
          throw new Error(`Player ${pid} not found`);
        }
        const profileFinances = STARTING_FINANCES_BY_PROFILE[player.profileId];
        expect(profileFinances).toBeDefined();

        // Check starting cash
        expect(state.finance.cashByPlayer[pid]).toBe(
          profileFinances.startingCashCents,
        );

        // Check recurring finance
        const recurring = state.finance.recurringByPlayer[pid];
        expect(recurring).toBeDefined();
        if (recurring === undefined) {
          throw new Error(`Missing recurring finance for player ${pid}`);
        }
        expect(recurring.quarterlyIncomeCents).toBe(
          cents(Math.trunc(profileFinances.annualIncomeCents / 4)),
        );
        expect(recurring.quarterlyLivingExpenseCents).toBe(
          cents(profileFinances.monthlyLivingExpenseCents * 3),
        );
      }

      // Settle Quarter 1
      const initialCashByPlayer = { ...state.finance.cashByPlayer };
      const result = settleQuarter(state, { quarter: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`Quarter 1 failed: ${result.code}`);
      }

      const settled = result.state;
      assertGameState(settled);
      expect(settled.currentQuarter).toBe(2);
      expect(settled.lastSettledQuarter).toBe(1);

      // Reconcile each assigned profile's expected surplus
      for (const pid of playerIds) {
        const player = state.players[pid];
        if (player === undefined) {
          throw new Error(`Player ${pid} not found`);
        }
        const profileId = player.profileId;
        const initialCash = initialCashByPlayer[pid];
        const endingCash = settled.finance.cashByPlayer[pid];
        expect(initialCash).toBeDefined();
        expect(endingCash).toBeDefined();
        if (initialCash === undefined || endingCash === undefined) {
          throw new Error(`Missing cash balance for player ${pid}`);
        }
        const actualSurplus = endingCash - initialCash;

        // Verify surplus against the canonical fixture
        let expectedSurplus: number;
        switch (profileId) {
          case "high-income-professional":
            expectedSurplus = 1_545_000;
            break;
          case "corporate-climber":
            expectedSurplus = 985_000;
            break;
          case "disciplined-saver":
            expectedSurplus = 735_000;
            break;
          case "small-business-owner":
            expectedSurplus = 425_000;
            break;
          case "property-starter":
            expectedSurplus = 840_000;
            break;
          case "market-investor":
            expectedSurplus = 625_000;
            break;
          case "self-employed-operator":
            expectedSurplus = 1_050_000;
            break;
          case "early-stage-entrepreneur":
            expectedSurplus = 165_000;
            break;
        }

        expect(actualSurplus).toBe(cents(expectedSurplus));
      }
    });
  });

  describe("Section 29: Journal classifications and deterministic 4-stage ordering", () => {
    it("emits entries with correct accounts, classifications, and stage ordering", () => {
      // Build a game where p1 is Property Starter (income + property NOI + expenses + mortgage)
      // and p2 is Small Business Owner (income + personal debt + expenses)
      const { state } = createSyntheticProfileGame("property-starter");

      // Also give p2 Small Business Owner recurring finance and debt
      const sboFinances = STARTING_FINANCES_BY_PROFILE["small-business-owner"];
      const p2PersonalLoanId = asLoanId("loan-p2-personal-debt");
      const updatedState: GameState = {
        ...state,
        finance: {
          ...state.finance,
          cashByPlayer: {
            ...state.finance.cashByPlayer,
            [p2]: cents(sboFinances.startingCashCents),
          },
          recurringByPlayer: {
            ...state.finance.recurringByPlayer,
            [p2]: {
              quarterlyIncomeCents: cents(
                Math.trunc(sboFinances.annualIncomeCents / 4),
              ),
              quarterlyLivingExpenseCents: cents(
                sboFinances.monthlyLivingExpenseCents * 3,
              ),
            },
          },
          loansById: {
            ...state.finance.loansById,
            [p2PersonalLoanId]: {
              id: p2PersonalLoanId,
              kind: "legacy-bank-loan",
              borrowerPlayerId: p2,
              purpose: "personal-debt",
              originalPrincipalCents: cents(
                sboFinances.openingPersonalDebtPrincipalCents,
              ),
              outstandingPrincipalCents: cents(
                sboFinances.openingPersonalDebtPrincipalCents,
              ),
              annualRateBps: basisPoints(OPENING_PERSONAL_DEBT_APR_BPS),
              scheduledQuarterlyPaymentCents: cents(
                sboFinances.monthlyPersonalDebtPaymentCents * 3,
              ),
              paymentsApplied: 0,
            },
          },
        },
      };

      const result = settleQuarter(updatedState, { quarter: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("Settlement failed");
      }

      const entries = result.journalEntries;
      expect(entries.length).toBeGreaterThanOrEqual(5);

      // Verify stage 1: Personal Incomes (ordered by PlayerId)
      const incomeEntries = entries.filter(
        (e) => e.reason === "recurring-personal-income",
      );
      expect(incomeEntries.length).toBe(2); // p1 and p2
      expect(incomeEntries[0]?.source).toEqual({
        kind: "external",
        account: "personal-earned-income",
      });
      expect(incomeEntries[0]?.destination).toEqual({
        kind: "player",
        playerId: p1,
      });
      expect(incomeEntries[1]?.source).toEqual({
        kind: "external",
        account: "personal-earned-income",
      });
      expect(incomeEntries[1]?.destination).toEqual({
        kind: "player",
        playerId: p2,
      });

      // Verify stage 2: Property NOI distribution (ordered by AssetId, then PlayerId)
      const propertyEntries = entries.filter(
        (e) => e.reason === "property-operating-distribution",
      );
      expect(propertyEntries.length).toBe(1);
      expect(propertyEntries[0]?.source).toEqual({
        kind: "external",
        account: "property-operating-cashflow",
      });
      expect(propertyEntries[0]?.destination).toEqual({
        kind: "player",
        playerId: p1,
      });
      expect(propertyEntries[0]?.relatedAssetId).toBe(
        asAssetId("asset-prop-starter"),
      );
      expect(propertyEntries[0]?.amountCents).toBe(cents(583_537));

      // Verify stage 3: Living expenses (ordered by PlayerId)
      const livingExpenseEntries = entries.filter(
        (e) => e.reason === "recurring-living-expense",
      );
      expect(livingExpenseEntries.length).toBe(2); // p1 and p2
      expect(livingExpenseEntries[0]?.source).toEqual({
        kind: "player",
        playerId: p1,
      });
      expect(livingExpenseEntries[0]?.destination).toEqual({
        kind: "external",
        account: "living-expense-sink",
      });
      expect(livingExpenseEntries[0]?.amountCents).toBe(cents(1_260_000));
      expect(livingExpenseEntries[1]?.source).toEqual({
        kind: "player",
        playerId: p2,
      });
      expect(livingExpenseEntries[1]?.destination).toEqual({
        kind: "external",
        account: "living-expense-sink",
      });
      expect(livingExpenseEntries[1]?.amountCents).toBe(cents(1_200_000));

      // Verify stage 4: Legacy bank loans (ordered by LoanId)
      const loanEntries = entries.filter(
        (e) =>
          e.destination.kind === "external" && e.destination.account === "bank",
      );
      expect(loanEntries.length).toBe(2); // p2 personal debt, p1 mortgage
      for (const le of loanEntries) {
        expect(le.destination).toEqual({ kind: "external", account: "bank" });
        expect(le.loanPayment).toBeDefined();
        if (le.loanPayment) {
          expect(
            le.loanPayment.principalCents + le.loanPayment.interestCents,
          ).toBe(le.amountCents);
        }
      }

      // Verify stage sequencing: stage 1 indices < stage 2 indices < stage 3 indices < stage 4 indices
      const lastIncome = incomeEntries[incomeEntries.length - 1];
      const prop = propertyEntries[0];
      const firstExpense = livingExpenseEntries[0];
      const lastExpense = livingExpenseEntries[livingExpenseEntries.length - 1];
      const firstLoan = loanEntries[0];

      expect(lastIncome).toBeDefined();
      expect(prop).toBeDefined();
      expect(firstExpense).toBeDefined();
      expect(lastExpense).toBeDefined();
      expect(firstLoan).toBeDefined();

      if (!lastIncome || !prop || !firstExpense || !lastExpense || !firstLoan) {
        throw new Error("Missing expected journal entry");
      }

      const lastIncomeIdx = entries.indexOf(lastIncome);
      const propIdx = entries.indexOf(prop);
      const firstExpenseIdx = entries.indexOf(firstExpense);
      const lastExpenseIdx = entries.indexOf(lastExpense);
      const firstLoanIdx = entries.indexOf(firstLoan);

      expect(lastIncomeIdx).toBeLessThan(propIdx);
      expect(propIdx).toBeLessThan(firstExpenseIdx);
      expect(lastExpenseIdx).toBeLessThan(firstLoanIdx);

      // Verify mortgage has relatedAssetId
      const mortgageEntry = loanEntries.find(
        (e) => e.relatedLoanId === asLoanId("loan-starter-mortgage"),
      );
      expect(mortgageEntry).toBeDefined();
      expect(mortgageEntry?.relatedAssetId).toBe(
        asAssetId("asset-prop-starter"),
      );
    });
  });

  describe("Section 20: Solvency planning & rejection", () => {
    it("rejects settlement unchanged with INSUFFICIENT_FUNDS when net balance is negative", () => {
      const { state, playerId } = createSyntheticProfileGame(
        "high-income-professional",
      );

      // Artificially zero out cash and inflate living expenses so player is insolvent
      const insolventState: GameState = {
        ...state,
        finance: {
          ...state.finance,
          cashByPlayer: {
            ...state.finance.cashByPlayer,
            [playerId]: cents(1_000), // $10
          },
          recurringByPlayer: {
            ...state.finance.recurringByPlayer,
            [playerId]: {
              quarterlyIncomeCents: cents(10_000), // $100
              quarterlyLivingExpenseCents: cents(5_000_000), // $50,000
            },
          },
        },
      };

      const result = settleQuarter(insolventState, { quarter: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INSUFFICIENT_FUNDS");
      }

      // Assert state immutability
      expect(result.journalEntries).toHaveLength(0);
      expect(insolventState.counters.journal).toBe(state.counters.journal);
      expect(insolventState.counters.settlement).toBe(
        state.counters.settlement,
      );
      expect(insolventState.currentQuarter).toBe(1);
    });

    it("rejects settlement unchanged with DESTINATION_OVERFLOW when cumulative inflows overflow", () => {
      const { state, playerId } = createSyntheticProfileGame(
        "high-income-professional",
      );

      const overflowState: GameState = {
        ...state,
        finance: {
          ...state.finance,
          cashByPlayer: {
            ...state.finance.cashByPlayer,
            [playerId]: cents(Number.MAX_SAFE_INTEGER - 100),
          },
          recurringByPlayer: {
            ...state.finance.recurringByPlayer,
            [playerId]: {
              quarterlyIncomeCents: cents(10_000_000),
              quarterlyLivingExpenseCents: cents(0),
            },
          },
        },
      };

      const result = settleQuarter(overflowState, { quarter: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("DESTINATION_OVERFLOW");
      }
    });
  });

  describe("Section 30: Quarter idempotency regression", () => {
    it("settles Quarter 1 once and rejects retrying with QUARTER_ALREADY_SETTLED unchanged", () => {
      const { state } = createSyntheticProfileGame("disciplined-saver");
      const firstResult = settleQuarter(state, { quarter: 1 });
      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok) {
        throw new Error("First settlement failed");
      }

      const settledState = firstResult.state;
      expect(settledState.currentQuarter).toBe(2);
      expect(settledState.lastSettledQuarter).toBe(1);

      // Attempt to settle Quarter 1 again
      const retryResult = settleQuarter(settledState, { quarter: 1 });
      expect(retryResult.ok).toBe(false);
      if (!retryResult.ok) {
        expect(retryResult.code).toBe("QUARTER_ALREADY_SETTLED");
      }

      // No journal entries or state mutation on rejected retry
      expect(retryResult.journalEntries).toHaveLength(0);
      expect(settledState.currentQuarter).toBe(2);
      expect(settledState.lastSettledQuarter).toBe(1);
    });
  });

  describe("Section 31: Determinism", () => {
    it("produces identical state and journal for identical seed and actions", () => {
      const game1 = createReadyGame({
        gameId: "determinism-game-1",
        seed: "shared-seed-12345",
        playerIds,
      });
      const game2 = createReadyGame({
        gameId: "determinism-game-1", // Same gameId for strict equality
        seed: "shared-seed-12345",
        playerIds,
      });

      expect(game1).toEqual(game2);

      const res1 = settleQuarter(game1, { quarter: 1 });
      const res2 = settleQuarter(game2, { quarter: 1 });

      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);
      if (res1.ok && res2.ok) {
        expect(res1.journalEntries).toEqual(res2.journalEntries);
        expect(res1.state).toEqual(res2.state);
      }
    });
  });

  describe("Section 33: Player-loan helper compatibility", () => {
    it("returns WRONG_LOAN_KIND when applyScheduledPlayerLoanPayment is called on a LegacyBankLoan", () => {
      const { state, loanId } = createSyntheticProfileGame(
        "high-income-professional",
      );
      expect(loanId).toBeDefined();
      if (loanId === undefined) {
        throw new Error("Expected loanId");
      }

      const result = applyScheduledPlayerLoanPayment(
        state.finance,
        state.counters,
        {
          loanId,
          quarter: 1,
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("WRONG_LOAN_KIND");
      }
    });
  });
});
