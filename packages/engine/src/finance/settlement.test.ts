import {
  PUBLIC_MARKET_INSTRUMENT_IDS,
  PUBLIC_MARKET_INSTRUMENTS,
  STANDARD_V1_OPENING_BASE_RATE_BPS,
  STANDARD_V1_OPENING_CASH_YIELD_BPS,
} from "@interests/rules";
import { asAssetId, asLoanId, asPlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";

import { applyAction } from "../game/actions";
import { createGame } from "../game/createGame";
import { assertGameState } from "../invariants/assertGameState";
import type {
  BusinessAsset,
  GameState,
  PlayerLoan,
  PropertyAsset,
} from "../model/gameState";
import { externalCashAccount, playerCashAccount } from "./account";
import { generateQuarterMarketUpdate } from "./economy";
import {
  applyScheduledPlayerLoanPayment,
  originateConfirmedPlayerLoan,
} from "./loans";
import {
  calculateQuarterlyYieldCents,
  calculateRevaluedMarketValueCents,
  createZeroPublicMarketPortfolio,
} from "./markets";
import { basisPoints, cents } from "./money";
import { type OwnershipPpm, ownershipPpm } from "./ownership";
import { postCash } from "./posting";
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
    gameId: options?.gameId ?? "synthetic-settlement-game",
    seed: options?.seed ?? "settlement-test-seed",
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
  const base = createReadyGame({
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
    debtPrincipalCents: cents(0),
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
      originatedQuarter: 1,
    };
    loansById = { [loanId]: loan };
  }

  const zeroPortfolio = createZeroPublicMarketPortfolio();

  const state: GameState = {
    ...base,
    opportunitiesById: {},
    finance: {
      ...base.finance,
      recurringByPlayer: {
        [p1]: {
          quarterlyIncomeCents: cents(0),
          quarterlyLivingExpenseCents: cents(0),
        },
        [p2]: {
          quarterlyIncomeCents: cents(0),
          quarterlyLivingExpenseCents: cents(0),
        },
        [p3]: {
          quarterlyIncomeCents: cents(0),
          quarterlyLivingExpenseCents: cents(0),
        },
        [p4]: {
          quarterlyIncomeCents: cents(0),
          quarterlyLivingExpenseCents: cents(0),
        },
      },
      publicMarketsByPlayer: {
        [p1]: zeroPortfolio,
        [p2]: zeroPortfolio,
        [p3]: zeroPortfolio,
        [p4]: zeroPortfolio,
      },
      quarterStartBasis: {
        quarter: 1,
        cashByPlayer: {
          [p1]: cents(0),
          [p2]: cents(0),
          [p3]: cents(0),
          [p4]: cents(0),
        },
        publicMarketsByPlayer: {
          [p1]: zeroPortfolio,
          [p2]: zeroPortfolio,
          [p3]: zeroPortfolio,
          [p4]: zeroPortfolio,
        },
      },
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
  it("rejects quarter settlement with WRONG_PHASE when match is still in objective-choosing phase", () => {
    const unready = createGame({
      gameId: "unready-game",
      seed: "unready-seed",
      playerIds,
    });
    expect(unready.phase).toBe("objective-choosing");

    const result = settleQuarter(unready, { quarter: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("WRONG_PHASE");
    expect(result.state).toBe(unready);
    expect(result.journalEntries).toHaveLength(0);
    expect(result.state.counters).toEqual(unready.counters);
    expect(result.state.revision).toBe(unready.revision);
    expect(result.state.random).toEqual(unready.random);
  });

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
      if (loanAfter?.kind !== "player-loan") return;
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

    // 10. Economy state updated and RNG advances by the 4 economy draws
    expect(result.state.economy.currentRegime).toBeDefined();
    expect(result.state.economy.lastMarketUpdate?.quarter).toBe(1);
    expect(result.state.random.algorithm).toBe(initialRandom.algorithm);
    expect(result.state.random.state).not.toBe(initialRandom.state);

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

  it("rejects quarter settlement with DESTINATION_OVERFLOW when recipient balance would overflow MAX_SAFE_INTEGER", () => {
    const { state } = buildSyntheticFixture();
    // In buildSyntheticFixture, p1 receives 111,150 cents of NOI
    // Set p1 cash near MAX_SAFE_INTEGER so that receiving NOI would overflow
    const nearMaxState: GameState = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [p1]: cents(Number.MAX_SAFE_INTEGER - 100_000),
        },
      },
    };

    const result = settleQuarter(nearMaxState, { quarter: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("DESTINATION_OVERFLOW");
    expect(result.state).toBe(nearMaxState);
    expect(result.journalEntries).toHaveLength(0);
    expect(result.state.counters).toEqual(nearMaxState.counters);
    expect(result.state.revision).toBe(nearMaxState.revision);
    expect(result.state.random).toEqual(nearMaxState.random);
  });

  it("rejects quarter settlement with DESTINATION_OVERFLOW when cumulative distributions from multiple properties overflow", () => {
    const base = createReadyGame({
      gameId: "multi-property-overflow-game",
      seed: "multi-prop-seed",
      playerIds,
    });

    const propAId = asAssetId("asset-prop-a");
    const propBId = asAssetId("asset-prop-b");

    // Property A NOI: 100 * 1.0 - 40 = 60 cents
    const propA: PropertyAsset = {
      id: propAId,
      kind: "property",
      marketValueCents: cents(10_000_000),
      scheduledQuarterlyRentCents: cents(100),
      occupancyBps: basisPoints(10_000),
      operatingExpenseRatioBps: basisPoints(4_000),
      ownershipByPlayerPpm: {
        [p1]: ownershipPpm(1_000_000),
      },
    };

    // Property B NOI: 100 * 1.0 - 50 = 50 cents
    const propB: PropertyAsset = {
      id: propBId,
      kind: "property",
      marketValueCents: cents(10_000_000),
      scheduledQuarterlyRentCents: cents(100),
      occupancyBps: basisPoints(10_000),
      operatingExpenseRatioBps: basisPoints(5_000),
      ownershipByPlayerPpm: {
        [p1]: ownershipPpm(1_000_000),
      },
    };

    // Player 1 has room for exactly 100 cents before reaching MAX_SAFE_INTEGER
    // Individually: propA (60 <= 100) fits, propB (50 <= 100) fits
    // Cumulatively: 60 + 50 = 110 > 100 -> overflows!
    const state: GameState = {
      ...base,
      finance: {
        ...base.finance,
        cashByPlayer: {
          ...base.finance.cashByPlayer,
          [p1]: cents(Number.MAX_SAFE_INTEGER - 100),
        },
        assetsById: {
          [propAId]: propA,
          [propBId]: propB,
        },
      },
    };

    const result = settleQuarter(state, { quarter: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("DESTINATION_OVERFLOW");
    expect(result.state).toBe(state);
    expect(result.journalEntries).toHaveLength(0);
    expect(result.state.counters).toEqual(state.counters);
    expect(result.state.revision).toBe(state.revision);
    expect(result.state.random).toEqual(state.random);
  });

  it("throws RangeError if currentQuarter is at terminal MAX_SAFE_INTEGER", () => {
    const { state } = buildSyntheticFixture();
    const terminalState: GameState = {
      ...state,
      currentQuarter: Number.MAX_SAFE_INTEGER,
      lastSettledQuarter: Number.MAX_SAFE_INTEGER - 1,
    };

    expect(() =>
      settleQuarter(terminalState, { quarter: Number.MAX_SAFE_INTEGER }),
    ).toThrow(RangeError);
  });

  it("produces zero distributions for a zero-NOI property or empty asset registry", () => {
    const base = createReadyGame({
      gameId: "empty-assets-game",
      seed: "empty-seed",
      playerIds,
    });

    const zeroPortfolio = createZeroPublicMarketPortfolio();

    const isolatedBase: GameState = {
      ...base,
      opportunitiesById: {},
      finance: {
        ...base.finance,
        recurringByPlayer: {
          [p1]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
          [p2]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
          [p3]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
          [p4]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
        },
        publicMarketsByPlayer: {
          [p1]: zeroPortfolio,
          [p2]: zeroPortfolio,
          [p3]: zeroPortfolio,
          [p4]: zeroPortfolio,
        },
        quarterStartBasis: {
          quarter: 1,
          cashByPlayer: {
            [p1]: cents(0),
            [p2]: cents(0),
            [p3]: cents(0),
            [p4]: cents(0),
          },
          publicMarketsByPlayer: {
            [p1]: zeroPortfolio,
            [p2]: zeroPortfolio,
            [p3]: zeroPortfolio,
            [p4]: zeroPortfolio,
          },
        },
        loansById: {},
        assetsById: {},
      },
    };

    // Empty asset registry settles cleanly
    const emptyResult = settleQuarter(isolatedBase, { quarter: 1 });
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
      ...isolatedBase,
      finance: {
        ...isolatedBase.finance,
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

    const base = createReadyGame({
      gameId: "order-test-game",
      seed: "order-seed",
      playerIds,
    });

    // State A: insert prop2 before prop1
    const stateA: GameState = {
      ...base,
      opportunitiesById: {},
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
      opportunitiesById: {},
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

  it("preserves quarter-start entitlement basis when current cash is modified mid-quarter", () => {
    const readyGame = createReadyGame();
    const player1CashBasis =
      readyGame.finance.quarterStartBasis.cashByPlayer[p1];
    expect(player1CashBasis).toBeDefined();
    if (player1CashBasis === undefined) return;
    expect(player1CashBasis).toBeGreaterThan(0);

    // Mid-quarter, player 1 spends cash via postCash
    const postResult = postCash(readyGame.finance, readyGame.counters, {
      source: playerCashAccount(p1),
      destination: externalCashAccount("bank"),
      amountCents: cents(50_000),
      reason: "mid-quarter-spend",
      quarter: 1,
    });
    expect(postResult.ok).toBe(true);
    if (!postResult.ok) return;

    const modifiedState: GameState = {
      ...readyGame,
      finance: postResult.finance,
      counters: postResult.counters,
    };

    // Verify current cash is reduced but basis cash is untouched
    expect(modifiedState.finance.cashByPlayer[p1]).toBe(
      player1CashBasis - 50_000,
    );
    expect(modifiedState.finance.quarterStartBasis.cashByPlayer[p1]).toBe(
      player1CashBasis,
    );

    // Settle quarter 1
    const settleResult = settleQuarter(modifiedState, { quarter: 1 });
    expect(settleResult.ok).toBe(true);
    if (!settleResult.ok) return;

    // Expected cash yield is based on player1CashBasis, NOT (player1CashBasis - 50_000)
    const expectedCashYield = calculateQuarterlyYieldCents({
      principalCents: player1CashBasis,
      annualYieldBps: STANDARD_V1_OPENING_CASH_YIELD_BPS,
    });
    const yieldEntry = settleResult.journalEntries.find(
      (e) =>
        e.reason === "cash-yield" &&
        e.destination.kind === "player" &&
        e.destination.playerId === p1,
    );
    expect(yieldEntry).toBeDefined();
    expect(yieldEntry?.amountCents).toBe(expectedCashYield);
  });

  it("preserves quarter-start entitlement basis when current public market holdings are modified mid-quarter", () => {
    const readyGame = createReadyGame();
    const basisPortfolio =
      readyGame.finance.quarterStartBasis.publicMarketsByPlayer[p1];
    expect(basisPortfolio).toBeDefined();
    if (!basisPortfolio) return;
    const initialBroadHolding = basisPortfolio["broad-market-fund"];
    expect(initialBroadHolding).toBeGreaterThan(0);

    // Mid-quarter, player 1 reallocates current public market holdings
    // (broad set to 0, growth set to 50k, defensive set to 20k)
    // while quarterStartBasis remains strictly untouched.
    const modifiedPortfolios = {
      ...readyGame.finance.publicMarketsByPlayer,
      [p1]: {
        "broad-market-fund": cents(0),
        "growth-fund": cents(5_000_000),
        "income-defensive-fund": cents(2_000_000),
      },
    };

    const modifiedState: GameState = {
      ...readyGame,
      finance: {
        ...readyGame.finance,
        publicMarketsByPlayer: modifiedPortfolios,
      },
    };

    // Verify current portfolio differs from quarterStartBasis
    const currentP1Portfolio = modifiedState.finance.publicMarketsByPlayer[p1];
    expect(currentP1Portfolio).toBeDefined();
    if (!currentP1Portfolio) return;

    const basisP1Portfolio =
      modifiedState.finance.quarterStartBasis.publicMarketsByPlayer[p1];
    expect(basisP1Portfolio).toBeDefined();
    if (!basisP1Portfolio) return;

    expect(currentP1Portfolio["broad-market-fund"]).toBe(0);
    expect(currentP1Portfolio["growth-fund"]).toBe(5_000_000);
    expect(basisP1Portfolio["broad-market-fund"]).toBe(initialBroadHolding);
    expect(basisP1Portfolio["growth-fund"]).toBe(0);

    // Settle quarter 1
    const settleResult = settleQuarter(modifiedState, { quarter: 1 });
    expect(settleResult.ok).toBe(true);
    if (!settleResult.ok) return;

    // The dividends received must reflect quarterStartBasis (broad-market-fund with initialBroadHolding),
    // NOT the modified current portfolio (which had zero broad-market and positive growth/defensive)
    const p1DividendEntries = settleResult.journalEntries.filter(
      (e) =>
        e.reason === "public-market-dividend" &&
        e.destination.kind === "player" &&
        e.destination.playerId === p1,
    );

    // Exactly 1 dividend entry for broad-market-fund, and 0 for growth or defensive
    expect(p1DividendEntries).toHaveLength(1);
    const broadEntry = p1DividendEntries[0];
    expect(broadEntry).toBeDefined();
    expect(broadEntry?.relatedMarketInstrumentId).toBe("broad-market-fund");
    expect(broadEntry?.amountCents).toBe(
      calculateQuarterlyYieldCents({
        principalCents: initialBroadHolding,
        annualYieldBps:
          PUBLIC_MARKET_INSTRUMENTS["broad-market-fund"].annualDividendYieldBps,
      }),
    );

    const marketUpdate = settleResult.state.economy.lastMarketUpdate;
    expect(marketUpdate).toBeDefined();
    if (!marketUpdate) return;

    const closingP1Portfolio =
      settleResult.state.finance.publicMarketsByPlayer[p1];
    expect(closingP1Portfolio).toBeDefined();
    if (!closingP1Portfolio) return;

    const expectedGrowthCents = calculateRevaluedMarketValueCents({
      currentValueCents: 5_000_000,
      returnBps: marketUpdate.returnBpsByInstrument["growth-fund"],
    });
    const expectedDefensiveCents = calculateRevaluedMarketValueCents({
      currentValueCents: 2_000_000,
      returnBps: marketUpdate.returnBpsByInstrument["income-defensive-fund"],
    });

    expect(closingP1Portfolio["broad-market-fund"]).toBe(0);
    expect(closingP1Portfolio["growth-fund"]).toBe(expectedGrowthCents);
    expect(closingP1Portfolio["income-defensive-fund"]).toBe(
      expectedDefensiveCents,
    );

    // Verify Quarter 2 opening basis rolls from the revalued closing current portfolio
    expect(settleResult.state.finance.quarterStartBasis.quarter).toBe(2);
    expect(
      settleResult.state.finance.quarterStartBasis.publicMarketsByPlayer[p1],
    ).toEqual(closingP1Portfolio);
  });

  it("settles growth and defensive fund dividends with correct yield calculation and journal metadata", () => {
    const base = createReadyGame();

    const growthHolding = cents(1_000_000); // $10,000
    const defensiveHolding = cents(2_000_000); // $20,000
    const broadHolding = cents(500_000); // $5,000

    const customPortfolios = {
      ...base.finance.publicMarketsByPlayer,
      [p1]: {
        "broad-market-fund": broadHolding,
        "growth-fund": growthHolding,
        "income-defensive-fund": defensiveHolding,
      },
    };

    const customBasis = {
      ...base.finance.quarterStartBasis,
      publicMarketsByPlayer: customPortfolios,
    };

    const stateWithCustomMarkets: GameState = {
      ...base,
      finance: {
        ...base.finance,
        publicMarketsByPlayer: customPortfolios,
        quarterStartBasis: customBasis,
      },
    };

    const result = settleQuarter(stateWithCustomMarkets, { quarter: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify journal entries for dividends
    const p1DividendEntries = result.journalEntries.filter(
      (e) =>
        e.reason === "public-market-dividend" &&
        e.destination.kind === "player" &&
        e.destination.playerId === p1,
    );

    // Expect 3 dividend entries for p1 (broad, growth, defensive)
    expect(p1DividendEntries).toHaveLength(3);

    const broadEntry = p1DividendEntries.find(
      (e) => e.relatedMarketInstrumentId === "broad-market-fund",
    );
    const growthEntry = p1DividendEntries.find(
      (e) => e.relatedMarketInstrumentId === "growth-fund",
    );
    const defensiveEntry = p1DividendEntries.find(
      (e) => e.relatedMarketInstrumentId === "income-defensive-fund",
    );

    expect(broadEntry).toBeDefined();
    expect(growthEntry).toBeDefined();
    expect(defensiveEntry).toBeDefined();

    // Growth fund: 50 bps / 4 = 12.5 bps -> 1,000,000 * 50 / 40,000 = 1,250 cents ($12.50)
    expect(growthEntry?.amountCents).toBe(
      calculateQuarterlyYieldCents({
        principalCents: growthHolding,
        annualYieldBps:
          PUBLIC_MARKET_INSTRUMENTS["growth-fund"].annualDividendYieldBps,
      }),
    );
    expect(growthEntry?.amountCents).toBe(1_250);

    // Defensive fund: 350 bps / 4 = 87.5 bps -> 2,000,000 * 350 / 40,000 = 17,500 cents ($175.00)
    expect(defensiveEntry?.amountCents).toBe(
      calculateQuarterlyYieldCents({
        principalCents: defensiveHolding,
        annualYieldBps:
          PUBLIC_MARKET_INSTRUMENTS["income-defensive-fund"]
            .annualDividendYieldBps,
      }),
    );
    expect(defensiveEntry?.amountCents).toBe(17_500);

    // Verify canonical ordering: cash-yield before public-market-dividend, and dividends in canonical instrument order
    const reasonsInOrder = result.journalEntries.map((e) => e.reason);
    const firstYieldIndex = reasonsInOrder.indexOf("cash-yield");
    const firstDividendIndex = reasonsInOrder.indexOf("public-market-dividend");
    const firstIncomeIndex = reasonsInOrder.indexOf(
      "recurring-personal-income",
    );

    expect(firstYieldIndex).toBeGreaterThanOrEqual(0);
    expect(firstDividendIndex).toBeGreaterThan(firstYieldIndex);
    expect(firstIncomeIndex).toBeGreaterThan(firstDividendIndex);

    // Verify instrument order within dividends
    const instrumentOrder = p1DividendEntries.map(
      (e) => e.relatedMarketInstrumentId,
    );
    expect(instrumentOrder).toEqual([
      "broad-market-fund",
      "growth-fund",
      "income-defensive-fund",
    ]);
  });

  it("captures Quarter 2 opening finance basis from Quarter 1 closing state so newly earned cash earns yield in Quarter 2", () => {
    const readyGame = createReadyGame();
    const initialP1Cash = readyGame.finance.cashByPlayer[p1];
    expect(initialP1Cash).toBeDefined();
    if (initialP1Cash === undefined) return;

    // Settle quarter 1
    const q1Result = settleQuarter(readyGame, { quarter: 1 });
    expect(q1Result.ok).toBe(true);
    if (!q1Result.ok) return;

    const closingP1CashQ1 = q1Result.state.finance.cashByPlayer[p1];
    expect(closingP1CashQ1).toBeDefined();
    if (closingP1CashQ1 === undefined) return;
    expect(closingP1CashQ1).toBeGreaterThan(initialP1Cash);

    // Check Quarter 2 opening basis captured in state
    expect(q1Result.state.finance.quarterStartBasis.quarter).toBe(2);
    expect(q1Result.state.finance.quarterStartBasis.cashByPlayer[p1]).toBe(
      closingP1CashQ1,
    );
    expect(
      q1Result.state.finance.quarterStartBasis.publicMarketsByPlayer,
    ).toEqual(q1Result.state.finance.publicMarketsByPlayer);

    // Now settle quarter 2
    const q2Result = settleQuarter(q1Result.state, { quarter: 2 });
    expect(q2Result.ok).toBe(true);
    if (!q2Result.ok) return;

    // Quarter 2 cash yield for p1 must be based on closingP1CashQ1
    const expectedQ2Yield = calculateQuarterlyYieldCents({
      principalCents: closingP1CashQ1,
      annualYieldBps: STANDARD_V1_OPENING_CASH_YIELD_BPS,
    });
    const q2YieldEntry = q2Result.journalEntries.find(
      (e) =>
        e.reason === "cash-yield" &&
        e.destination.kind === "player" &&
        e.destination.playerId === p1,
    );
    expect(q2YieldEntry).toBeDefined();
    expect(q2YieldEntry?.amountCents).toBe(expectedQ2Yield);
    expect(expectedQ2Yield).toBeGreaterThan(
      calculateQuarterlyYieldCents({
        principalCents: initialP1Cash,
        annualYieldBps: STANDARD_V1_OPENING_CASH_YIELD_BPS,
      }),
    );
  });

  it("rejects duplicate settlement of the same quarter and preserves state immutability", () => {
    const readyGame = createReadyGame();

    const q1Result = settleQuarter(readyGame, { quarter: 1 });
    expect(q1Result.ok).toBe(true);
    if (!q1Result.ok) return;

    const stateAfterQ1 = q1Result.state;
    const snapshotBeforeRetry = JSON.parse(JSON.stringify(stateAfterQ1));

    // Attempt to settle quarter 1 again
    const retryResult = settleQuarter(stateAfterQ1, { quarter: 1 });
    expect(retryResult.ok).toBe(false);
    if (retryResult.ok) return;

    expect(retryResult.code).toBe("QUARTER_ALREADY_SETTLED");
    expect(retryResult.state).toBe(stateAfterQ1);
    expect(retryResult.journalEntries).toHaveLength(0);
    expect(JSON.parse(JSON.stringify(retryResult.state))).toEqual(
      snapshotBeforeRetry,
    );
  });
});

describe("reference preservation audit (Section 28)", () => {
  it("preserves publicMarketsByPlayer and quarterStartBasis by reference across postCash", () => {
    const readyGame = createReadyGame();
    const originalMarkets = readyGame.finance.publicMarketsByPlayer;
    const originalBasis = readyGame.finance.quarterStartBasis;

    const postResult = postCash(readyGame.finance, readyGame.counters, {
      source: playerCashAccount(p1),
      destination: playerCashAccount(p2),
      amountCents: cents(10_000),
      reason: "transfer",
      quarter: 1,
    });
    expect(postResult.ok).toBe(true);
    if (!postResult.ok) return;

    expect(postResult.finance.publicMarketsByPlayer).toBe(originalMarkets);
    expect(postResult.finance.quarterStartBasis).toBe(originalBasis);
  });

  it("preserves publicMarketsByPlayer and quarterStartBasis by reference across originatePlayerLoan", () => {
    const readyGame = createReadyGame();
    const originalMarkets = readyGame.finance.publicMarketsByPlayer;
    const originalBasis = readyGame.finance.quarterStartBasis;

    const loanResult = originateConfirmedPlayerLoan(
      readyGame.finance,
      readyGame.counters,
      {
        lenderPlayerId: p1,
        borrowerPlayerId: p2,
        principalCents: cents(50_000),
        annualRateBps: basisPoints(800),
        termQuarters: 4,
        quarter: 1,
      },
    );
    expect(loanResult.ok).toBe(true);
    if (!loanResult.ok) return;

    expect(loanResult.finance.publicMarketsByPlayer).toBe(originalMarkets);
    expect(loanResult.finance.quarterStartBasis).toBe(originalBasis);
  });

  it("preserves publicMarketsByPlayer and quarterStartBasis by reference across applyScheduledPlayerLoanPayment", () => {
    const readyGame = createReadyGame();

    const loanResult = originateConfirmedPlayerLoan(
      readyGame.finance,
      readyGame.counters,
      {
        lenderPlayerId: p1,
        borrowerPlayerId: p2,
        principalCents: cents(50_000),
        annualRateBps: basisPoints(800),
        termQuarters: 4,
        quarter: 1,
      },
    );
    expect(loanResult.ok).toBe(true);
    if (!loanResult.ok) return;

    const originalMarkets = loanResult.finance.publicMarketsByPlayer;
    const originalBasis = loanResult.finance.quarterStartBasis;

    const paymentResult = applyScheduledPlayerLoanPayment(
      loanResult.finance,
      loanResult.counters,
      {
        loanId: loanResult.loan.id,
        quarter: 1,
      },
    );
    expect(paymentResult.ok).toBe(true);
    if (!paymentResult.ok) return;

    expect(paymentResult.finance.publicMarketsByPlayer).toBe(originalMarkets);
    expect(paymentResult.finance.quarterStartBasis).toBe(originalBasis);
  });

  it("preserves publicMarketsByPlayer and quarterStartBasis by reference across chooseObjective action", () => {
    const freshGame = createGame({
      gameId: "test-game",
      seed: "test-seed",
      playerIds,
    });
    const originalMarkets = freshGame.finance.publicMarketsByPlayer;
    const originalBasis = freshGame.finance.quarterStartBasis;

    const p1Player = freshGame.players[p1];
    expect(p1Player).toBeDefined();
    if (!p1Player) return;
    const objectiveId = p1Player.offeredObjectiveIds[0];
    expect(objectiveId).toBeDefined();
    if (!objectiveId) return;

    const actionResult = applyAction(freshGame, {
      type: "CHOOSE_OBJECTIVE",
      playerId: p1,
      objectiveId,
    });
    expect(actionResult.ok).toBe(true);
    if (!actionResult.ok) return;

    expect(actionResult.state.finance.publicMarketsByPlayer).toBe(
      originalMarkets,
    );
    expect(actionResult.state.finance.quarterStartBasis).toBe(originalBasis);
    expect(actionResult.state.economy).toBe(freshGame.economy);
  });

  it("preserves economy state by reference across postCash", () => {
    const readyGame = createReadyGame();
    const originalEconomy = readyGame.economy;

    const postResult = postCash(readyGame.finance, readyGame.counters, {
      source: playerCashAccount(p1),
      destination: playerCashAccount(p2),
      amountCents: cents(10_000),
      reason: "transfer",
      quarter: 1,
    });
    expect(postResult.ok).toBe(true);
    // postCash operates on FinanceState; GameState.economy is preserved
    expect(readyGame.economy).toBe(originalEconomy);
  });

  it("preserves economy state by reference across rejected settlement", () => {
    const readyGame = createReadyGame();
    const originalEconomy = readyGame.economy;
    const originalRandom = readyGame.random;

    // Settle wrong quarter to trigger rejection
    const rejectResult = settleQuarter(readyGame, { quarter: 99 });
    expect(rejectResult.ok).toBe(false);
    expect(rejectResult.state.economy).toBe(originalEconomy);
    expect(rejectResult.state.random).toBe(originalRandom);
  });
});

describe("rejected settlement RNG and state preservation (Section 24)", () => {
  it("rolls back RNG and preserves state on deterministic cash flow failure", () => {
    const base = createReadyGame();

    // Create an artificial insufficient funds state by emptying cash of a player with living expenses
    const brokeState: GameState = {
      ...base,
      finance: {
        ...base.finance,
        cashByPlayer: {
          ...base.finance.cashByPlayer,
          [p1]: cents(0),
        },
        recurringByPlayer: {
          ...base.finance.recurringByPlayer,
          [p1]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(500_000),
          },
        },
      },
    };

    const result = settleQuarter(brokeState, { quarter: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("INSUFFICIENT_FUNDS");
    expect(result.state).toBe(brokeState);
    expect(result.state.random).toBe(brokeState.random);
    expect(result.state.economy).toBe(brokeState.economy);
    expect(result.state.revision).toBe(brokeState.revision);
    expect(result.state.counters).toBe(brokeState.counters);
    expect(result.journalEntries).toHaveLength(0);
  });

  it("rolls back tentative RNG and rejects atomically on market arithmetic overflow", () => {
    const base = createReadyGame();

    const preview = generateQuarterMarketUpdate({
      regime: base.economy.currentRegime,
      random: base.random,
    });

    const positiveInstrument =
      PUBLIC_MARKET_INSTRUMENT_IDS.find(
        (id) => preview.returnBpsByInstrument[id] > 0,
      ) ?? "growth-fund";

    // Set a maximum safe holding on an instrument with positive return
    const overflowPortfolios = {
      ...base.finance.publicMarketsByPlayer,
      [p1]: {
        "broad-market-fund": cents(0),
        "growth-fund": cents(0),
        "income-defensive-fund": cents(0),
        [positiveInstrument]: cents(Number.MAX_SAFE_INTEGER),
      },
    };

    const overflowState: GameState = {
      ...base,
      finance: {
        ...base.finance,
        publicMarketsByPlayer: overflowPortfolios,
      },
    };

    assertGameState(overflowState);

    const result = settleQuarter(overflowState, { quarter: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("MARKET_VALUE_OVERFLOW");
    expect(result.state).toBe(overflowState);
    expect(result.state.random).toBe(overflowState.random);
    expect(result.state.economy).toBe(overflowState.economy);
    expect(result.state.revision).toBe(overflowState.revision);
    expect(result.state.counters).toBe(overflowState.counters);
    expect(result.journalEntries).toHaveLength(0);
  });
});

describe("deterministic market-path integration regression (Section 25)", () => {
  it("produces exact, repeatable market update and closing balances for fixed seed", () => {
    const input = {
      gameId: "fixture-game-1",
      seed: "fixed-deterministic-seed-alpha",
      playerIds,
    };

    const gameA = createReadyGame(input);
    const resultA = settleQuarter(gameA, { quarter: 1 });
    expect(resultA.ok).toBe(true);
    if (!resultA.ok) return;

    // Lock exact literal expectations for this fixed seed
    expect(resultA.state.economy.lastMarketUpdate).toEqual({
      quarter: 1,
      regimeUsed: "expansion",
      returnBpsByInstrument: {
        "broad-market-fund": 45,
        "growth-fund": -139,
        "income-defensive-fund": 356,
      },
    });

    expect(resultA.state.economy.currentRegime).toBe("expansion");

    expect(resultA.state.random).toEqual({
      algorithm: "xorshift32-v2",
      state: 1756619055,
    });

    expect(resultA.state.finance.publicMarketsByPlayer).toEqual({
      [p1]: {
        "broad-market-fund": cents(1_004_500),
        "growth-fund": cents(0),
        "income-defensive-fund": cents(0),
      },
      [p2]: {
        "broad-market-fund": cents(2_009_000),
        "growth-fund": cents(0),
        "income-defensive-fund": cents(0),
      },
      [p3]: {
        "broad-market-fund": cents(0),
        "growth-fund": cents(0),
        "income-defensive-fund": cents(0),
      },
      [p4]: {
        "broad-market-fund": cents(0),
        "growth-fund": cents(0),
        "income-defensive-fund": cents(0),
      },
    });

    // Recreate same game from same input and prove byte-for-byte equality
    const gameB = createReadyGame(input);
    const resultB = settleQuarter(gameB, { quarter: 1 });
    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;

    expect(resultA.state).toEqual(resultB.state);
  });
});

describe("multi-quarter deterministic regression (Section 26)", () => {
  it("remains byte-for-byte deterministic across 8 consecutive settled quarters", () => {
    const input = {
      gameId: "multi-quarter-match",
      seed: "multi-quarter-seed-42",
      playerIds,
    };

    let stateA = createReadyGame(input);
    let stateB = createReadyGame(input);

    expect(stateA).toEqual(stateB);

    for (let q = 1; q <= 8; q += 1) {
      const resA = settleQuarter(stateA, { quarter: q });
      const resB = settleQuarter(stateB, { quarter: q });

      expect(resA.ok).toBe(true);
      expect(resB.ok).toBe(true);
      if (!resA.ok || !resB.ok) return;

      expect(resA.settlementId).toBe(resB.settlementId);
      expect(resA.journalEntries).toEqual(resB.journalEntries);
      expect(resA.state).toEqual(resB.state);

      // Verify invariants on state
      assertGameState(resA.state);

      stateA = resA.state;
      stateB = resB.state;
    }

    expect(stateA.lastSettledQuarter).toBe(8);
    expect(stateA.currentQuarter).toBe(9);
    expect(stateA.economy.lastMarketUpdate?.quarter).toBe(8);
  });
});

describe("same market return across players (Section 27)", () => {
  it("applies the exact same instrument return BPS to all players holding that instrument", () => {
    const base = createReadyGame();

    const p1Broad = cents(1_000_000); // $10,000
    const p2Broad = cents(2_500_000); // $25,000

    const customPortfolios = {
      ...base.finance.publicMarketsByPlayer,
      [p1]: {
        "broad-market-fund": p1Broad,
        "growth-fund": cents(0),
        "income-defensive-fund": cents(0),
      },
      [p2]: {
        "broad-market-fund": p2Broad,
        "growth-fund": cents(0),
        "income-defensive-fund": cents(0),
      },
    };

    const customState: GameState = {
      ...base,
      finance: {
        ...base.finance,
        publicMarketsByPlayer: customPortfolios,
      },
    };

    const result = settleQuarter(customState, { quarter: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const update = result.state.economy.lastMarketUpdate;
    expect(update).toBeDefined();
    if (!update) return;

    const broadReturn = update.returnBpsByInstrument["broad-market-fund"];
    const expectedP1Broad = calculateRevaluedMarketValueCents({
      currentValueCents: p1Broad,
      returnBps: broadReturn,
    });
    const expectedP2Broad = calculateRevaluedMarketValueCents({
      currentValueCents: p2Broad,
      returnBps: broadReturn,
    });

    const closingP1 = result.state.finance.publicMarketsByPlayer[p1];
    const closingP2 = result.state.finance.publicMarketsByPlayer[p2];

    expect(closingP1?.["broad-market-fund"]).toBe(expectedP1Broad);
    expect(closingP2?.["broad-market-fund"]).toBe(expectedP2Broad);
  });
});

describe("zero-holding path regression (Section 28)", () => {
  it("advances economy path and transitions regime when all player portfolios are zero", () => {
    const base = createReadyGame();

    const zeroPortfolios = {
      [p1]: createZeroPublicMarketPortfolio(),
      [p2]: createZeroPublicMarketPortfolio(),
      [p3]: createZeroPublicMarketPortfolio(),
      [p4]: createZeroPublicMarketPortfolio(),
    };

    const zeroState: GameState = {
      ...base,
      finance: {
        ...base.finance,
        publicMarketsByPlayer: zeroPortfolios,
      },
    };

    const initialRandom = zeroState.random;
    const initialRegime = zeroState.economy.currentRegime;

    // Reference cycle consuming exactly the 4 economy draws
    const expectedCycle = generateQuarterMarketUpdate({
      regime: initialRegime,
      random: initialRandom,
    });

    const result = settleQuarter(zeroState, { quarter: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Market update exactly matches the single 4-draw market cycle
    const zeroUpdate = result.state.economy.lastMarketUpdate;
    expect(zeroUpdate).toBeDefined();
    if (!zeroUpdate) return;
    expect(zeroUpdate.quarter).toBe(1);
    expect(zeroUpdate.regimeUsed).toBe(expectedCycle.regimeUsed);
    expect(zeroUpdate.returnBpsByInstrument).toEqual(
      expectedCycle.returnBpsByInstrument,
    );

    // Economy regime after settlement exactly matches the transition draw
    expect(result.state.economy.currentRegime).toBe(expectedCycle.nextRegime);

    // RNG state exactly matches the 4-draw cycle endpoint (proving no extra economy draws)
    expect(result.state.random).toEqual(expectedCycle.nextRandom);

    // Portfolios remain 0
    for (const pid of playerIds) {
      expect(result.state.finance.publicMarketsByPlayer[pid]).toEqual(
        createZeroPublicMarketPortfolio(),
      );
    }

    // No mark-to-market journal entries
    const reasons = result.journalEntries.map((e) => e.reason);
    expect(reasons).not.toContain("market-gain");
    expect(reasons).not.toContain("market-loss");
    expect(reasons).not.toContain("revaluation");
  });
});

describe("current holdings versus basis regression (Section 29)", () => {
  it("uses quarterStartBasis for dividends and current holdings for price revaluation", () => {
    const base = createReadyGame();

    const basisBroad = cents(2_000_000); // $20,000
    const currentBroad = cents(1_000_000); // $10,000

    const customBasis = {
      ...base.finance.quarterStartBasis,
      publicMarketsByPlayer: {
        ...base.finance.quarterStartBasis.publicMarketsByPlayer,
        [p1]: {
          "broad-market-fund": basisBroad,
          "growth-fund": cents(0),
          "income-defensive-fund": cents(0),
        },
      },
    };

    const customCurrentMarkets = {
      ...base.finance.publicMarketsByPlayer,
      [p1]: {
        "broad-market-fund": currentBroad,
        "growth-fund": cents(0),
        "income-defensive-fund": cents(0),
      },
    };

    const testState: GameState = {
      ...base,
      finance: {
        ...base.finance,
        quarterStartBasis: customBasis,
        publicMarketsByPlayer: customCurrentMarkets,
      },
    };

    const result = settleQuarter(testState, { quarter: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Dividend must use basisBroad ($20,000)
    const p1DividendEntry = result.journalEntries.find(
      (e) =>
        e.reason === "public-market-dividend" &&
        e.destination.kind === "player" &&
        e.destination.playerId === p1,
    );
    expect(p1DividendEntry).toBeDefined();
    expect(p1DividendEntry?.amountCents).toBe(
      calculateQuarterlyYieldCents({
        principalCents: basisBroad,
        annualYieldBps:
          PUBLIC_MARKET_INSTRUMENTS["broad-market-fund"].annualDividendYieldBps,
      }),
    );

    // Price movement must use currentBroad ($10,000)
    const update = result.state.economy.lastMarketUpdate;
    expect(update).toBeDefined();
    if (!update) return;

    const expectedClosing = calculateRevaluedMarketValueCents({
      currentValueCents: currentBroad,
      returnBps: update.returnBpsByInstrument["broad-market-fund"],
    });

    expect(
      result.state.finance.publicMarketsByPlayer[p1]?.["broad-market-fund"],
    ).toBe(expectedClosing);

    // Quarter 2 basis must contain revalued closing position
    expect(
      result.state.finance.quarterStartBasis.publicMarketsByPlayer[p1]?.[
        "broad-market-fund"
      ],
    ).toBe(expectedClosing);
  });
});

describe("no market movement in cash journal (Section 30)", () => {
  it("never creates cash journal entries for market price movement", () => {
    const readyGame = createReadyGame();
    const result = settleQuarter(readyGame, { quarter: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const entry of result.journalEntries) {
      expect(entry.reason).not.toMatch(
        /market-gain|market-loss|revaluation|mark-to-market/i,
      );
    }
  });
});

describe("preservation of base rate, property, and business values (Section 33-37)", () => {
  it("keeps base rate fixed at 450 BPS, and preserves property/business valuations across settlement", () => {
    const readyGame = createReadyGame();
    const initialBaseRate = readyGame.economy.baseRateBps;
    expect(initialBaseRate).toBe(STANDARD_V1_OPENING_BASE_RATE_BPS);

    const initialAssets = readyGame.finance.assetsById;

    const result = settleQuarter(readyGame, { quarter: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Base rate remains 450 BPS
    expect(result.state.economy.baseRateBps).toBe(
      STANDARD_V1_OPENING_BASE_RATE_BPS,
    );

    // Property and business valuations unchanged
    for (const [assetId, asset] of Object.entries(
      result.state.finance.assetsById,
    )) {
      const original = initialAssets[assetId as keyof typeof initialAssets];
      expect(original).toBeDefined();
      if (!original) continue;

      if (asset.kind === "property" && original.kind === "property") {
        expect(asset.marketValueCents).toBe(original.marketValueCents);
      } else if (asset.kind === "business" && original.kind === "business") {
        expect(asset.enterpriseValueCents).toBe(original.enterpriseValueCents);
        expect(asset.debtPrincipalCents).toBe(original.debtPrincipalCents);
      }
    }
  });
});
