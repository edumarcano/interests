import { asAssetId, asLoanId, asPlayerId } from "@finance-game/shared";
import { describe, expect, it } from "vitest";

import { createGame } from "../game/createGame";
import { assertGameState } from "../invariants/assertGameState";
import type {
  BusinessAsset,
  GameState,
  PlayerLoan,
  PropertyAsset,
} from "../model/gameState";
import { basisPoints, cents } from "./money";
import { type OwnershipPpm, ownershipPpm } from "./ownership";
import { settleQuarter } from "./settlement";

const p1 = asPlayerId("player-1");
const p2 = asPlayerId("player-2");
const p3 = asPlayerId("player-3");
const p4 = asPlayerId("player-4");
const playerIds = [p1, p2, p3, p4] as const;

function buildSyntheticFixture(options?: {
  readonly propertyOwners?: {
    readonly [p1]?: number;
    readonly [p2]?: number;
    readonly [p3]?: number;
    readonly [p4]?: number;
  };
  readonly withLoan?: boolean;
}): {
  state: GameState;
  property: PropertyAsset;
  business: BusinessAsset;
  loan?: PlayerLoan;
} {
  const base = createGame({
    gameId: "synthetic-settlement-game",
    seed: "settlement-test-seed",
    playerIds,
  });

  const propertyId = asAssetId("asset-prop-1");
  const businessId = asAssetId("asset-biz-1");

  const propOwners = options?.propertyOwners ?? {
    [p1]: 600_000,
    [p2]: 400_000,
  };

  const ownershipByPlayerPpm: Record<string, OwnershipPpm> = {};
  for (const [id, weight] of Object.entries(propOwners)) {
    if (typeof weight === "number") {
      ownershipByPlayerPpm[id] = ownershipPpm(weight);
    }
  }

  const property: PropertyAsset = {
    id: propertyId,
    kind: "property",
    marketValueCents: cents(30_000_000), // $300,000
    scheduledQuarterlyRentCents: cents(300_000), // $3,000
    occupancyBps: basisPoints(9_500), // 95%
    operatingExpenseRatioBps: basisPoints(3_500), // 35%
    ownershipByPlayerPpm,
  };

  const business: BusinessAsset = {
    id: businessId,
    kind: "business",
    annualRevenueCents: cents(50_000_000),
    annualOperatingProfitCents: cents(8_000_000),
    enterpriseValueCents: cents(32_000_000),
    ownershipByPlayerPpm: {
      [p3]: ownershipPpm(1_000_000),
    },
  };

  let loan: PlayerLoan | undefined;
  let loansById: Record<string, PlayerLoan> = {};
  if (options?.withLoan) {
    const loanId = asLoanId("loan-1");
    loan = {
      id: loanId,
      kind: "player-loan",
      lenderPlayerId: p1,
      borrowerPlayerId: p2,
      originalPrincipalCents: cents(100_000),
      outstandingPrincipalCents: cents(100_000),
      annualRateBps: basisPoints(800),
      termQuarters: 4,
      installmentsPaid: 0,
    };
    loansById = { [loanId]: loan };
  }

  const state: GameState = {
    ...base,
    finance: {
      ...base.finance,
      loansById,
      assetsById: {
        [propertyId]: property,
        [businessId]: business,
      },
    },
  };

  assertGameState(state);
  return { state, property, business, loan };
}

describe("quarter settlement foundation", () => {
  it("settles Quarter 1 atomically and reconciles exact property cash flows", () => {
    // Property NOI check:
    // Scheduled rent = 300,000
    // Occ = 9,500 bps -> Effective rent = 285,000
    // Opex ratio = 3,500 bps -> Operating expenses = 99,750
    // NOI = 185,250
    // Owners: p1 has 60% (600k ppm), p2 has 40% (400k ppm)
    // p1 share: 185,250 * 0.6 = 111,150
    // p2 share: 185,250 * 0.4 = 74,100
    const { state, property, business, loan } = buildSyntheticFixture({
      withLoan: true,
    });

    const initialP1Cash = state.finance.cashByPlayer[p1];
    const initialP2Cash = state.finance.cashByPlayer[p2];
    expect(initialP1Cash).toBeDefined();
    expect(initialP2Cash).toBeDefined();
    if (initialP1Cash === undefined || initialP2Cash === undefined) return;

    const initialRevision = state.revision;
    const initialCounters = { ...state.counters };
    const initialRandom = { ...state.random };

    const result = settleQuarter(state, { quarter: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 1. SettlementId is deterministic settlement-1
    expect(result.settlementId).toBe("settlement-1");

    // 2. Journal entries created: exactly 2 entries (for p1 and p2)
    expect(result.journalEntries).toHaveLength(2);

    const entry1 = result.journalEntries[0];
    const entry2 = result.journalEntries[1];
    expect(entry1).toBeDefined();
    expect(entry2).toBeDefined();
    if (!entry1 || !entry2) return;

    expect(entry1.id).toBe("journal-1");
    expect(entry1.source).toEqual({
      kind: "external",
      account: "property-operating-cashflow",
    });
    expect(entry1.destination).toEqual({ kind: "player", playerId: p1 });
    expect(entry1.amountCents).toBe(111_150);
    expect(entry1.reason).toBe("property-operating-distribution");
    expect(entry1.quarter).toBe(1);
    expect(entry1.relatedAssetId).toBe(property.id);

    expect(entry2.id).toBe("journal-2");
    expect(entry2.source).toEqual({
      kind: "external",
      account: "property-operating-cashflow",
    });
    expect(entry2.destination).toEqual({ kind: "player", playerId: p2 });
    expect(entry2.amountCents).toBe(74_100);
    expect(entry2.reason).toBe("property-operating-distribution");
    expect(entry2.quarter).toBe(1);
    expect(entry2.relatedAssetId).toBe(property.id);

    // Sum of owner distributions equals exact NOI
    expect(entry1.amountCents + entry2.amountCents).toBe(185_250);

    // 3. Player cash balances updated exactly
    expect(result.state.finance.cashByPlayer[p1]).toBe(initialP1Cash + 111_150);
    expect(result.state.finance.cashByPlayer[p2]).toBe(initialP2Cash + 74_100);
    expect(result.state.finance.cashByPlayer[p3]).toBe(
      state.finance.cashByPlayer[p3],
    );
    expect(result.state.finance.cashByPlayer[p4]).toBe(
      state.finance.cashByPlayer[p4],
    );

    // 4. Deterministic counters
    expect(result.state.counters.settlement).toBe(
      initialCounters.settlement + 1,
    );
    expect(result.state.counters.journal).toBe(initialCounters.journal + 2);
    expect(result.state.counters.asset).toBe(initialCounters.asset);
    expect(result.state.counters.loan).toBe(initialCounters.loan);
    expect(result.state.counters.opportunity).toBe(initialCounters.opportunity);
    expect(result.state.counters.contract).toBe(initialCounters.contract);

    // 5. Loan state unchanged (regression check)
    expect(loan).toBeDefined();
    if (loan) {
      const loanAfter = result.state.finance.loansById[loan.id];
      expect(loanAfter).toBeDefined();
      if (!loanAfter) return;
      expect(loanAfter.installmentsPaid).toBe(0);
      expect(loanAfter.outstandingPrincipalCents).toBe(
        loan.originalPrincipalCents,
      );
    }

    // 6. Business state unchanged & no invented distribution (regression check)
    const bizAfter = result.state.finance.assetsById[business.id];
    expect(bizAfter).toEqual(business);

    // 7. Property state unchanged
    const propAfter = result.state.finance.assetsById[property.id];
    expect(propAfter).toEqual(property);

    // 8. Quarter state advances
    expect(result.state.lastSettledQuarter).toBe(1);
    expect(result.state.currentQuarter).toBe(2);

    // 9. Revision increments once
    expect(result.state.revision).toBe(initialRevision + 1);

    // 10. Randomness untouched
    expect(result.state.random).toEqual(initialRandom);

    // Invariants pass
    assertGameState(result.state);
  });

  it("handles duplicate settlement rejection idempotently", () => {
    const { state } = buildSyntheticFixture();

    const q1Result = settleQuarter(state, { quarter: 1 });
    expect(q1Result.ok).toBe(true);
    if (!q1Result.ok) return;

    // Retry settling quarter 1 against state that already settled quarter 1
    const retryResult = settleQuarter(q1Result.state, { quarter: 1 });

    expect(retryResult.ok).toBe(false);
    if (retryResult.ok) return;

    expect(retryResult.code).toBe("QUARTER_ALREADY_SETTLED");
    expect(retryResult.state).toBe(q1Result.state);
    expect(retryResult.journalEntries).toHaveLength(0);
    expect(retryResult.state.counters).toEqual(q1Result.state.counters);
    expect(retryResult.state.revision).toBe(q1Result.state.revision);
    expect(retryResult.state.random).toEqual(q1Result.state.random);

    // Wrong quarter check: trying to settle Q3 when current quarter is Q2
    const wrongQuarterResult = settleQuarter(q1Result.state, { quarter: 3 });
    expect(wrongQuarterResult.ok).toBe(false);
    if (wrongQuarterResult.ok) return;
    expect(wrongQuarterResult.code).toBe("WRONG_QUARTER");

    // Settle quarter 2 succeeds normally
    const q2Result = settleQuarter(q1Result.state, { quarter: 2 });
    expect(q2Result.ok).toBe(true);
    if (!q2Result.ok) return;
    expect(q2Result.settlementId).toBe("settlement-2");
    expect(q2Result.state.lastSettledQuarter).toBe(2);
    expect(q2Result.state.currentQuarter).toBe(3);
  });

  it("produces zero distributions for a zero-NOI property or empty asset registry", () => {
    const base = createGame({
      gameId: "empty-assets-game",
      seed: "empty-seed",
      playerIds,
    });

    // Empty asset registry settles cleanly
    const emptyResult = settleQuarter(base, { quarter: 1 });
    expect(emptyResult.ok).toBe(true);
    if (!emptyResult.ok) return;

    expect(emptyResult.settlementId).toBe("settlement-1");
    expect(emptyResult.journalEntries).toHaveLength(0);
    expect(emptyResult.state.counters.settlement).toBe(1);
    expect(emptyResult.state.counters.journal).toBe(0);
    expect(emptyResult.state.lastSettledQuarter).toBe(1);
    expect(emptyResult.state.currentQuarter).toBe(2);

    // Property with zero rent produces 0 NOI and zero postings
    const zeroProperty: PropertyAsset = {
      id: asAssetId("asset-zero-prop"),
      kind: "property",
      marketValueCents: cents(10_000_000),
      scheduledQuarterlyRentCents: cents(0),
      occupancyBps: basisPoints(9500),
      operatingExpenseRatioBps: basisPoints(3500),
      ownershipByPlayerPpm: {
        [p1]: ownershipPpm(1_000_000),
      },
    };

    const stateWithZeroProp: GameState = {
      ...base,
      finance: {
        ...base.finance,
        assetsById: {
          [zeroProperty.id]: zeroProperty,
        },
      },
    };

    const zeroResult = settleQuarter(stateWithZeroProp, { quarter: 1 });
    expect(zeroResult.ok).toBe(true);
    if (!zeroResult.ok) return;
    expect(zeroResult.journalEntries).toHaveLength(0);
  });

  it("is completely deterministic and independent of asset or owner insertion order", () => {
    const prop1Id = asAssetId("asset-p1");
    const prop2Id = asAssetId("asset-p2");

    const prop1: PropertyAsset = {
      id: prop1Id,
      kind: "property",
      marketValueCents: cents(20_000_000),
      scheduledQuarterlyRentCents: cents(200_000),
      occupancyBps: basisPoints(10_000),
      operatingExpenseRatioBps: basisPoints(2_500),
      // Owners in order: p2, p1
      ownershipByPlayerPpm: {
        [p2]: ownershipPpm(500_000),
        [p1]: ownershipPpm(500_000),
      },
    };

    const prop2: PropertyAsset = {
      id: prop2Id,
      kind: "property",
      marketValueCents: cents(10_000_000),
      scheduledQuarterlyRentCents: cents(100_000),
      occupancyBps: basisPoints(10_000),
      operatingExpenseRatioBps: basisPoints(2_500),
      // Owners in order: p4, p3
      ownershipByPlayerPpm: {
        [p4]: ownershipPpm(400_000),
        [p3]: ownershipPpm(600_000),
      },
    };

    const base = createGame({
      gameId: "order-test-game",
      seed: "order-seed",
      playerIds,
    });

    // State A: insert prop2 before prop1
    const stateA: GameState = {
      ...base,
      finance: {
        ...base.finance,
        assetsById: {
          [prop2Id]: prop2,
          [prop1Id]: prop1,
        },
      },
    };

    // State B: insert prop1 before prop2, and prop1 owners reversed
    const prop1Reversed: PropertyAsset = {
      ...prop1,
      ownershipByPlayerPpm: {
        [p1]: ownershipPpm(500_000),
        [p2]: ownershipPpm(500_000),
      },
    };

    const stateB: GameState = {
      ...base,
      finance: {
        ...base.finance,
        assetsById: {
          [prop1Id]: prop1Reversed,
          [prop2Id]: prop2,
        },
      },
    };

    const resultA = settleQuarter(stateA, { quarter: 1 });
    const resultB = settleQuarter(stateB, { quarter: 1 });

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;

    // Both results must be 100% equivalent in IDs, journal ordering, and balances
    expect(resultA.settlementId).toBe(resultB.settlementId);
    expect(resultA.journalEntries).toEqual(resultB.journalEntries);
    expect(resultA.state.finance.cashByPlayer).toEqual(
      resultB.state.finance.cashByPlayer,
    );
    expect(resultA.state.counters).toEqual(resultB.state.counters);
  });
});
