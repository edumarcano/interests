import { asAssetId, asLoanId, asPlayerId } from "@finance-game/shared";
import { describe, expect, it } from "vitest";

import { applyAction } from "../game/actions";
import { createGame } from "../game/createGame";
import { assertGameState } from "../invariants/assertGameState";
import type { BusinessAsset, GameState, PlayerLoan } from "../model/gameState";
import {
  acceptPlayerLoanFinancingOffer,
  closeCashBusinessPurchaseTransaction,
  openFinancedBusinessPurchaseTransaction,
  submitPlayerLoanFinancingOffer,
} from "../transactions/cashBusinessPurchase";
import { basisPoints, cents } from "./money";
import { createSoleOwnership } from "./ownership";
import { settleQuarter } from "./settlement";

const buyerId = asPlayerId("test-buyer");
const sellerId = asPlayerId("test-seller");
const lenderId = asPlayerId("test-lender");
const neutralId = asPlayerId("test-neutral");
const playerIds = [buyerId, sellerId, lenderId, neutralId] as const;

function createReadyGame(): GameState {
  let state = createGame({
    gameId: "settlement-loan-test-game",
    seed: "settlement-loan-test-seed",
    playerIds,
  });

  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    if (player === undefined) {
      throw new Error(`Missing player ${playerId}`);
    }
    const objectiveId = player.offeredObjectiveIds[0];
    if (objectiveId === undefined) {
      throw new Error(`Missing objective for player ${playerId}`);
    }
    const result = applyAction(state, {
      type: "CHOOSE_OBJECTIVE",
      playerId,
      objectiveId,
    });
    if (!result.ok) {
      throw new Error(`Failed to choose objective: ${result.code}`);
    }
    state = result.state;
  }

  return state;
}

/**
 * Creates the exact literal financed fixture:
 * - buyer cash: 5_000_000 cents ($50k)
 * - seller cash: 2_500_000 cents ($25k)
 * - lender cash: 10_000_000 cents ($100k)
 * - business price: 6_000_000 cents ($60k)
 * - contribution: 2_000_000 cents ($20k), loan: 4_000_000 cents ($40k)
 * - APR: 1_000 bps (10%), term: 3 quarters
 */
function createClosedFinancedQ1State(): {
  readonly state: GameState;
  readonly loanId: ReturnType<typeof asLoanId>;
} {
  const base = createReadyGame();
  const businessAssetId = asAssetId("asset-settlement-biz");

  const testBusiness: BusinessAsset = {
    id: businessAssetId,
    kind: "business",
    enterpriseValueCents: cents(6_000_000),
    debtPrincipalCents: cents(0),
    annualRevenueCents: cents(8_000_000),
    annualOperatingProfitCents: cents(1_500_000),
    ownershipByPlayerPpm: createSoleOwnership(sellerId),
  };

  const state: GameState = {
    ...base,
    finance: {
      ...base.finance,
      cashByPlayer: {
        ...base.finance.cashByPlayer,
        [buyerId]: cents(5_000_000),
        [sellerId]: cents(2_500_000),
        [lenderId]: cents(10_000_000),
        [neutralId]: cents(1_000_000),
      },
      assetsById: {
        ...base.finance.assetsById,
        [businessAssetId]: testBusiness,
      },
    },
  };

  const openRes = openFinancedBusinessPurchaseTransaction(state, {
    buyerPlayerId: buyerId,
    sellerPlayerId: sellerId,
    assetId: businessAssetId,
    purchasePriceCents: 6_000_000,
    buyerCashContributionCents: 2_000_000,
    requestedPrincipalCents: 4_000_000,
  });
  if (!openRes.ok || !openRes.transactionId) throw new Error();

  const offerRes = submitPlayerLoanFinancingOffer(
    openRes.state,
    openRes.transactionId,
    lenderId,
    { annualRateBps: 1_000, termQuarters: 3 },
  );
  if (!offerRes.ok) throw new Error();

  const acceptRes = acceptPlayerLoanFinancingOffer(
    offerRes.state,
    openRes.transactionId,
    buyerId,
    1,
  );
  if (!acceptRes.ok) throw new Error();

  const closeRes = closeCashBusinessPurchaseTransaction(
    acceptRes.state,
    openRes.transactionId,
  );
  if (!closeRes.ok) throw new Error();

  const playerLoan = Object.values(closeRes.state.finance.loansById).find(
    (l) => l.kind === "player-loan",
  );
  if (!playerLoan) throw new Error("Missing player loan");

  return {
    state: closeRes.state,
    loanId: playerLoan.id as ReturnType<typeof asLoanId>,
  };
}

describe("Section 26: Quarter Timing Regressions (Q1 -> Q2)", () => {
  it("settles Q1 without loan repayment, and settles Q2 with exact first installment", () => {
    const { state: closedQ1State, loanId } = createClosedFinancedQ1State();
    expect(closedQ1State.currentQuarter).toBe(1);

    const loanBeforeQ1 = closedQ1State.finance.loansById[loanId] as PlayerLoan;
    expect(loanBeforeQ1.originatedQuarter).toBe(1);
    expect(loanBeforeQ1.installmentsPaid).toBe(0);
    expect(loanBeforeQ1.outstandingPrincipalCents).toBe(4_000_000);

    // --- Settle Quarter 1 ---
    const q1Result = settleQuarter(closedQ1State, { quarter: 1 });
    expect(q1Result.ok).toBe(true);
    if (!q1Result.ok) return;

    const stateAfterQ1 = q1Result.state;
    expect(stateAfterQ1.currentQuarter).toBe(2);
    expect(stateAfterQ1.lastSettledQuarter).toBe(1);

    // Section 26.B:
    // - player loan installmentsPaid remains 0
    // - outstanding principal remains 4_000_000
    // - no player-loan repayment entry is emitted in Q1
    const loanAfterQ1 = stateAfterQ1.finance.loansById[loanId] as PlayerLoan;
    expect(loanAfterQ1.installmentsPaid).toBe(0);
    expect(loanAfterQ1.outstandingPrincipalCents).toBe(4_000_000);

    const q1PlayerLoanEntries = q1Result.journalEntries.filter(
      (e) => e.reason === "loan-payment" && e.relatedLoanId === loanId,
    );
    expect(q1PlayerLoanEntries).toHaveLength(0);

    // --- Settle Quarter 2 ---
    const q2Result = settleQuarter(stateAfterQ1, { quarter: 2 });
    expect(q2Result.ok).toBe(true);
    if (!q2Result.ok) return;

    const stateAfterQ2 = q2Result.state;
    expect(stateAfterQ2.currentQuarter).toBe(3);
    expect(stateAfterQ2.lastSettledQuarter).toBe(2);

    // Section 26.C & Section 22:
    // Expected first installment values for principal 4_000_000, APR 1_000 bps, term 3 quarters:
    // payment = 1_400_549 cents
    // interest = 100_000 cents
    // principal = 1_300_549 cents
    // closing outstanding = 2_699_451 cents
    const loanAfterQ2 = stateAfterQ2.finance.loansById[loanId] as PlayerLoan;
    expect(loanAfterQ2.installmentsPaid).toBe(1);
    expect(loanAfterQ2.outstandingPrincipalCents).toBe(2_699_451);

    const q2PlayerLoanEntries = q2Result.journalEntries.filter(
      (e) => e.reason === "loan-payment" && e.relatedLoanId === loanId,
    );
    expect(q2PlayerLoanEntries).toHaveLength(1);
    const paymentEntry = q2PlayerLoanEntries[0];
    expect(paymentEntry?.source).toEqual({ kind: "player", playerId: buyerId });
    expect(paymentEntry?.destination).toEqual({
      kind: "player",
      playerId: lenderId,
    });
    expect(paymentEntry?.amountCents).toBe(1_400_549);
    expect(paymentEntry?.loanPayment).toEqual({
      principalCents: 1_300_549,
      interestCents: 100_000,
    });

    assertGameState(stateAfterQ2);
  });
});

describe("Section 27: Settlement Order-Independence and Solvency", () => {
  it("produces deeply equivalent outcomes regardless of loansById object insertion order", () => {
    const base = createReadyGame();

    // Create two player loans originated in Q1:
    // Loan A: loan-A, borrower p1, lender p2
    // Loan B: loan-B, borrower p3, lender p4
    const loanAId = asLoanId("loan-A");
    const loanBId = asLoanId("loan-B");

    const loanA: PlayerLoan = {
      id: loanAId,
      kind: "player-loan",
      borrowerPlayerId: buyerId,
      lenderPlayerId: sellerId,
      originalPrincipalCents: cents(2_000_000),
      outstandingPrincipalCents: cents(2_000_000),
      annualRateBps: basisPoints(1_000),
      termQuarters: 4,
      installmentsPaid: 0,
      originatedQuarter: 1,
    };

    const loanB: PlayerLoan = {
      id: loanBId,
      kind: "player-loan",
      borrowerPlayerId: lenderId,
      lenderPlayerId: neutralId,
      originalPrincipalCents: cents(3_000_000),
      outstandingPrincipalCents: cents(3_000_000),
      annualRateBps: basisPoints(800),
      termQuarters: 4,
      installmentsPaid: 0,
      originatedQuarter: 1,
    };

    // State 1: insertion order [loanA, loanB]
    const state1: GameState = {
      ...base,
      currentQuarter: 2,
      lastSettledQuarter: 1,
      finance: {
        ...base.finance,
        quarterStartBasis: {
          ...base.finance.quarterStartBasis,
          quarter: 2,
        },
        cashByPlayer: {
          ...base.finance.cashByPlayer,
          [buyerId]: cents(10_000_000),
          [sellerId]: cents(10_000_000),
          [lenderId]: cents(10_000_000),
          [neutralId]: cents(10_000_000),
        },
        loansById: {
          [loanAId]: loanA,
          [loanBId]: loanB,
        },
      },
    };

    // State 2: insertion order [loanB, loanA]
    const state2: GameState = {
      ...state1,
      finance: {
        ...state1.finance,
        loansById: {
          [loanBId]: loanB,
          [loanAId]: loanA,
        },
      },
    };

    const res1 = settleQuarter(state1, { quarter: 2 });
    const res2 = settleQuarter(state2, { quarter: 2 });

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    if (!res1.ok || !res2.ok) return;

    expect(res1.state.finance.cashByPlayer).toEqual(
      res2.state.finance.cashByPlayer,
    );
    expect(res1.state.finance.loansById).toEqual(res2.state.finance.loansById);
    expect(res1.journalEntries).toEqual(res2.journalEntries);
    expect(res1.settlementId).toBe(res2.settlementId);
    expect(res1.state.counters).toEqual(res2.state.counters);
  });

  it("fails atomically when a borrower relies on same-stage incoming loan payment to fund outgoing payment", () => {
    const base = createReadyGame();

    // Borrower B owes 1_000_000 to Lender C.
    // Borrower B only has 500_000 cash at the start of player-loan stage.
    // However, Player A owes Borrower B 1_000_000 during this same stage.
    // Under Section 23/27, incoming loan payments DO NOT rescue outgoing solvency.
    const loan1Id = asLoanId("loan-01-incoming");
    const loan2Id = asLoanId("loan-02-outgoing");

    // Loan 1: buyerId owes sellerId
    const loan1: PlayerLoan = {
      id: loan1Id,
      kind: "player-loan",
      borrowerPlayerId: buyerId,
      lenderPlayerId: sellerId,
      originalPrincipalCents: cents(2_000_000),
      outstandingPrincipalCents: cents(2_000_000),
      annualRateBps: basisPoints(800),
      termQuarters: 4,
      installmentsPaid: 0,
      originatedQuarter: 1,
    };

    // Loan 2: sellerId owes lenderId
    // sellerId needs to pay paymentA, but sellerId cash is less than paymentA!
    const loan2: PlayerLoan = {
      id: loan2Id,
      kind: "player-loan",
      borrowerPlayerId: sellerId,
      lenderPlayerId: lenderId,
      originalPrincipalCents: cents(2_000_000),
      outstandingPrincipalCents: cents(2_000_000),
      annualRateBps: basisPoints(800),
      termQuarters: 4,
      installmentsPaid: 0,
      originatedQuarter: 1,
    };

    const state: GameState = {
      ...base,
      currentQuarter: 2,
      lastSettledQuarter: 1,
      finance: {
        ...base.finance,
        recurringByPlayer: {
          [buyerId]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
          [sellerId]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
          [lenderId]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
          [neutralId]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
        },
        quarterStartBasis: {
          ...base.finance.quarterStartBasis,
          quarter: 2,
        },
        cashByPlayer: {
          ...base.finance.cashByPlayer,
          [buyerId]: cents(10_000_000),
          // sellerId only has 100,000 cash, which is less than paymentA (~525k)
          [sellerId]: cents(100_000),
          [lenderId]: cents(10_000_000),
          [neutralId]: cents(10_000_000),
        },
        loansById: {
          [loan1Id]: loan1,
          [loan2Id]: loan2,
        },
      },
    };

    // Settle Q2: Even though loan1Id comes first in LoanId ordering and would transfer
    // ~525k to sellerId, settlement planning must reject because sellerId lacks cash
    // at the START of the player-loan stage!
    const result = settleQuarter(state, { quarter: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("INSUFFICIENT_FUNDS");
    expect(result.state).toBe(state);
    expect(result.journalEntries).toHaveLength(0);
  });
});

describe("Section 24: Player-Loan Insufficient Funds (Atomic Rejection)", () => {
  it("rejects quarter settlement atomically without mutating state or consuming RNG", () => {
    const { state: closedQ1State, loanId } = createClosedFinancedQ1State();

    // Advance to Q2
    const q1Result = settleQuarter(closedQ1State, { quarter: 1 });
    expect(q1Result.ok).toBe(true);
    if (!q1Result.ok) return;

    // Drain buyer's cash before Q2 settlement so they cannot afford installment (~$14,005.49)
    const insolventQ2State: GameState = {
      ...q1Result.state,
      finance: {
        ...q1Result.state.finance,
        recurringByPlayer: {
          [buyerId]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
          [sellerId]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
          [lenderId]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
          [neutralId]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
        },
        cashByPlayer: {
          ...q1Result.state.finance.cashByPlayer,
          [buyerId]: cents(1_000), // $10.00 cash only
        },
      },
    };

    const initialCounters = { ...insolventQ2State.counters };
    const initialRandom = { ...insolventQ2State.random };
    const initialRevision = insolventQ2State.revision;

    const q2Result = settleQuarter(insolventQ2State, { quarter: 2 });
    expect(q2Result.ok).toBe(false);
    if (q2Result.ok) return;

    expect(q2Result.code).toBe("INSUFFICIENT_FUNDS");
    expect(q2Result.state).toBe(insolventQ2State);
    expect(q2Result.journalEntries).toHaveLength(0);

    // No mutation
    expect(q2Result.state.counters).toEqual(initialCounters);
    expect(q2Result.state.random).toEqual(initialRandom);
    expect(q2Result.state.revision).toBe(initialRevision);
    expect(q2Result.state.currentQuarter).toBe(2);
    expect(q2Result.state.lastSettledQuarter).toBe(1);

    const loan = q2Result.state.finance.loansById[loanId] as PlayerLoan;
    expect(loan.installmentsPaid).toBe(0);
    expect(loan.outstandingPrincipalCents).toBe(4_000_000);
  });
});

describe("Section 24: Player-Loan Transient Destination Overflow (Canonical LoanId Ordering)", () => {
  it("rejects quarter settlement atomically when an earlier incoming payment overflows before a later outgoing payment", () => {
    const base = createReadyGame();
    const loan1Id = asLoanId("loan-1");
    const loan2Id = asLoanId("loan-2");

    // loan-1: buyerId pays sellerId 100 cents (earlier LoanId in canonical order)
    const loan1: PlayerLoan = {
      id: loan1Id,
      kind: "player-loan",
      borrowerPlayerId: buyerId,
      lenderPlayerId: sellerId,
      originalPrincipalCents: cents(200),
      outstandingPrincipalCents: cents(200),
      annualRateBps: basisPoints(0),
      termQuarters: 2,
      installmentsPaid: 0,
      originatedQuarter: 1,
    };

    // loan-2: sellerId pays lenderId 300 cents (later LoanId in canonical order)
    const loan2: PlayerLoan = {
      id: loan2Id,
      kind: "player-loan",
      borrowerPlayerId: sellerId,
      lenderPlayerId: lenderId,
      originalPrincipalCents: cents(600),
      outstandingPrincipalCents: cents(600),
      annualRateBps: basisPoints(0),
      termQuarters: 2,
      installmentsPaid: 0,
      originatedQuarter: 1,
    };

    // sellerId has cash near MAX_SAFE_INTEGER:
    // Starting balance: MAX_SAFE_INTEGER - 50
    // If loan-1 arrives first (+100 cents), balance would transiently reach MAX_SAFE_INTEGER + 50 (> MAX_SAFE_INTEGER).
    // Even though later loan-2 would deduct 300 cents (resulting in safe net MAX_SAFE_INTEGER - 250),
    // canonical LoanId-ordered posting must guarantee safe execution without transient overflow.
    const state: GameState = {
      ...base,
      currentQuarter: 2,
      lastSettledQuarter: 1,
      finance: {
        ...base.finance,
        recurringByPlayer: {
          [buyerId]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
          [sellerId]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
          [lenderId]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
          [neutralId]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
        },
        quarterStartBasis: {
          ...base.finance.quarterStartBasis,
          quarter: 2,
        },
        cashByPlayer: {
          ...base.finance.cashByPlayer,
          [buyerId]: cents(1_000_000),
          [sellerId]: cents(Number.MAX_SAFE_INTEGER - 50),
          [lenderId]: cents(1_000_000),
          [neutralId]: cents(1_000_000),
        },
        loansById: {
          [loan1Id]: loan1,
          [loan2Id]: loan2,
        },
      },
    };

    const initialCounters = { ...state.counters };
    const initialRandom = { ...state.random };
    const initialRevision = state.revision;

    const result = settleQuarter(state, { quarter: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("DESTINATION_OVERFLOW");
    expect(result.state).toBe(state);
    expect(result.journalEntries).toHaveLength(0);

    // Verify complete immutability
    expect(result.state.counters).toEqual(initialCounters);
    expect(result.state.random).toEqual(initialRandom);
    expect(result.state.revision).toBe(initialRevision);
  });
});
