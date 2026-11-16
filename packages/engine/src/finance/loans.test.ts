import { asAssetId, asLoanId, asPlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";

import { createGame } from "../game/createGame";
import { assertGameState } from "../invariants/assertGameState";
import type { DeterministicCounters, FinanceState } from "../model/gameState";
import {
  applyScheduledPlayerLoanPayment,
  originateConfirmedPlayerLoan,
} from "./loans";
import { createZeroPublicMarketPortfolio } from "./markets";
import { basisPoints, cents } from "./money";
import { ownershipPpm } from "./ownership";

const aliceId = asPlayerId("player-alice");
const bobId = asPlayerId("player-bob");
const charlieId = asPlayerId("player-charlie");
const danaId = asPlayerId("player-dana");

function createInitialFinance(): FinanceState {
  const cashByPlayer = {
    [aliceId]: cents(2_000_000), // $20,000
    [bobId]: cents(1_000_000), // $10,000
    [charlieId]: cents(500_000), // $5,000
    [danaId]: cents(300_000), // $3,000
  };
  const zero = createZeroPublicMarketPortfolio();
  const publicMarketsByPlayer = {
    [aliceId]: zero,
    [bobId]: zero,
    [charlieId]: zero,
    [danaId]: zero,
  };
  return {
    livingArrearsByPlayer: Object.fromEntries(
      Object.keys(cashByPlayer).map((id) => [id, cents(0)]),
    ),
    lastSettlement: null,
    cashByPlayer,
    recurringByPlayer: {
      [aliceId]: {
        quarterlyIncomeCents: cents(25_000_00),
        quarterlyLivingExpenseCents: cents(13_800_00),
      },
      [bobId]: {
        quarterlyIncomeCents: cents(18_000_00),
        quarterlyLivingExpenseCents: cents(10_200_00),
      },
      [charlieId]: {
        quarterlyIncomeCents: cents(17_000_00),
        quarterlyLivingExpenseCents: cents(12_000_00),
      },
      [danaId]: {
        quarterlyIncomeCents: cents(11_250_00),
        quarterlyLivingExpenseCents: cents(9_600_00),
      },
    },
    loansById: {},
    assetsById: {},
    publicMarketsByPlayer,
    quarterStartBasis: {
      quarter: 1,
      cashByPlayer: { ...cashByPlayer },
      publicMarketsByPlayer: { ...publicMarketsByPlayer },
    },
  };
}

function createInitialCounters(): DeterministicCounters {
  return {
    asset: 0,
    contract: 0,
    loan: 0,
    opportunity: 0,
    journal: 0,
    settlement: 0,
    transaction: 0,
  };
}

describe("player-loan origination", () => {
  it("atomically originates a confirmed player loan and transfers principal", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();

    // Alice lends Bob $10,000 (1,000,000 cents) at 10% APR (1000 bps) for 3 quarters
    const result = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 1_000_000,
      annualRateBps: 1_000,
      termQuarters: 3,
      quarter: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 1. Exactly one LoanId created
    expect(result.loan.id).toBe("loan-1");

    // 2. One canonical loan record in loansById
    expect(Object.keys(result.finance.loansById)).toHaveLength(1);
    expect(result.finance.loansById[result.loan.id]).toBe(result.loan);
    expect(result.loan).toEqual({
      id: "loan-1",
      kind: "player-loan",
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      originalPrincipalCents: 1_000_000,
      outstandingPrincipalCents: 1_000_000,
      annualRateBps: 1_000,
      termQuarters: 3,
      installmentsProcessed: 0,
      principalRepaidCents: cents(0),
      pastDuePrincipalCents: cents(0),
      unpaidInterestCents: cents(0),
      lastProcessedQuarter: 0,
      originatedQuarter: 1,
    });

    // 3. Cash movements: lender decreases, borrower increases
    expect(result.finance.cashByPlayer[aliceId]).toBe(1_000_000); // 20k - 10k = 10k
    expect(result.finance.cashByPlayer[bobId]).toBe(2_000_000); // 10k + 10k = 20k

    // 4. Total tracked player cash is conserved exactly ($38,000 total)
    const initialTotalCash = Object.values(finance.cashByPlayer).reduce(
      (sum, val) => sum + val,
      0,
    );
    const postTotalCash = Object.values(result.finance.cashByPlayer).reduce(
      (sum, val) => sum + val,
      0,
    );
    expect(postTotalCash).toBe(initialTotalCash);

    // 5. Journal entry
    expect(result.entry.id).toBe("journal-1");
    expect(result.entry.amountCents).toBe(1_000_000);
    expect(result.entry.relatedLoanId).toBe("loan-1");
    expect(result.entry.reason).toBe("loan-origination");
    expect(result.entry.quarter).toBe(1);

    // 6. Deterministic counters: loan + 1, journal + 1, others untouched
    expect(result.counters.loan).toBe(1);
    expect(result.counters.journal).toBe(1);
    expect(result.counters.asset).toBe(0);
    expect(result.counters.contract).toBe(0);
    expect(result.counters.opportunity).toBe(0);
  });

  it("rejects invalid origination without mutating state or consuming counters", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();

    // Unknown lender
    const unknownLender = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: asPlayerId("ghost-player"),
      borrowerPlayerId: bobId,
      principalCents: 100_000,
      annualRateBps: 500,
      termQuarters: 3,
      quarter: 1,
    });
    expect(unknownLender.ok).toBe(false);
    if (unknownLender.ok) return;
    expect(unknownLender.code).toBe("UNKNOWN_PLAYER");
    expect(unknownLender.finance).toBe(finance);
    expect(unknownLender.counters).toBe(counters);

    // Unknown borrower
    const unknownBorrower = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: asPlayerId("ghost-player"),
      principalCents: 100_000,
      annualRateBps: 500,
      termQuarters: 3,
      quarter: 1,
    });
    expect(unknownBorrower.ok).toBe(false);
    if (unknownBorrower.ok) return;
    expect(unknownBorrower.code).toBe("UNKNOWN_PLAYER");
    expect(unknownBorrower.finance).toBe(finance);
    expect(unknownBorrower.counters).toBe(counters);

    // Same lender and borrower
    const samePlayer = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: aliceId,
      principalCents: 100_000,
      annualRateBps: 500,
      termQuarters: 3,
      quarter: 1,
    });
    expect(samePlayer.ok).toBe(false);
    if (samePlayer.ok) return;
    expect(samePlayer.code).toBe("SAME_PLAYER");
    expect(samePlayer.finance).toBe(finance);
    expect(samePlayer.counters).toBe(counters);

    // Insufficient lender cash (Alice has $20,000; attempts $25,000)
    const insufficientFunds = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 2_500_000,
      annualRateBps: 500,
      termQuarters: 3,
      quarter: 1,
    });
    expect(insufficientFunds.ok).toBe(false);
    if (insufficientFunds.ok) return;
    expect(insufficientFunds.code).toBe("INSUFFICIENT_FUNDS");
    expect(insufficientFunds.finance).toBe(finance);
    expect(insufficientFunds.counters).toBe(counters);

    // Invalid principal: 0
    const zeroPrincipal = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 0,
      annualRateBps: 500,
      termQuarters: 3,
      quarter: 1,
    });
    expect(zeroPrincipal.ok).toBe(false);
    if (zeroPrincipal.ok) return;
    expect(zeroPrincipal.code).toBe("INVALID_PRINCIPAL");
    expect(zeroPrincipal.finance).toBe(finance);
    expect(zeroPrincipal.counters).toBe(counters);

    // Invalid rate: negative
    const negativeRate = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 100_000,
      annualRateBps: -50,
      termQuarters: 3,
      quarter: 1,
    });
    expect(negativeRate.ok).toBe(false);
    if (negativeRate.ok) return;
    expect(negativeRate.code).toBe("INVALID_RATE");
    expect(negativeRate.finance).toBe(finance);
    expect(negativeRate.counters).toBe(counters);

    // Invalid term: 1 quarter
    const shortTerm = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 100_000,
      annualRateBps: 500,
      termQuarters: 1,
      quarter: 1,
    });
    expect(shortTerm.ok).toBe(false);
    if (shortTerm.ok) return;
    expect(shortTerm.code).toBe("INVALID_TERM");
    expect(shortTerm.finance).toBe(finance);
    expect(shortTerm.counters).toBe(counters);

    // Invalid term: 9 quarters
    const longTerm = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 100_000,
      annualRateBps: 500,
      termQuarters: 9,
      quarter: 1,
    });
    expect(longTerm.ok).toBe(false);
    if (longTerm.ok) return;
    expect(longTerm.code).toBe("INVALID_TERM");
    expect(longTerm.finance).toBe(finance);
    expect(longTerm.counters).toBe(counters);

    // Unsupported terms from rounding
    const unsupportedTerms = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 1,
      annualRateBps: 100,
      termQuarters: 8,
      quarter: 1,
    });
    expect(unsupportedTerms.ok).toBe(false);
    if (unsupportedTerms.ok) return;
    expect(unsupportedTerms.code).toBe("UNSUPPORTED_TERMS");
    expect(unsupportedTerms.finance).toBe(finance);
    expect(unsupportedTerms.counters).toBe(counters);

    // Invalid quarter: 0
    const zeroQuarter = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 100_000,
      annualRateBps: 500,
      termQuarters: 3,
      quarter: 0,
    });
    expect(zeroQuarter.ok).toBe(false);
    if (zeroQuarter.ok) return;
    expect(zeroQuarter.code).toBe("INVALID_QUARTER");
    expect(zeroQuarter.finance).toBe(finance);
    expect(zeroQuarter.counters).toBe(counters);

    // Invalid quarter: negative
    const negativeQuarter = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 100_000,
      annualRateBps: 500,
      termQuarters: 3,
      quarter: -1,
    });
    expect(negativeQuarter.ok).toBe(false);
    if (negativeQuarter.ok) return;
    expect(negativeQuarter.code).toBe("INVALID_QUARTER");
    expect(negativeQuarter.finance).toBe(finance);
    expect(negativeQuarter.counters).toBe(counters);

    // Invalid quarter: non-integer
    const floatQuarter = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 100_000,
      annualRateBps: 500,
      termQuarters: 3,
      quarter: 1.5,
    });
    expect(floatQuarter.ok).toBe(false);
    if (floatQuarter.ok) return;
    expect(floatQuarter.code).toBe("INVALID_QUARTER");
    expect(floatQuarter.finance).toBe(finance);
    // Unsupported zero-interest terms where principal < termQuarters
    const zeroInterestTiny = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 1,
      annualRateBps: 0,
      termQuarters: 8,
      quarter: 1,
    });
    expect(zeroInterestTiny.ok).toBe(false);
    if (zeroInterestTiny.ok) return;
    expect(zeroInterestTiny.code).toBe("UNSUPPORTED_TERMS");
    expect(zeroInterestTiny.finance).toBe(finance);
    expect(zeroInterestTiny.counters).toBe(counters);

    // Destination balance overflow on borrower
    const overflowFinance: FinanceState = {
      ...finance,
      cashByPlayer: {
        ...finance.cashByPlayer,
        [bobId]: cents(Number.MAX_SAFE_INTEGER - 10),
      },
    };
    const overflowOrigination = originateConfirmedPlayerLoan(
      overflowFinance,
      counters,
      {
        lenderPlayerId: aliceId,
        borrowerPlayerId: bobId,
        principalCents: 100,
        annualRateBps: 500,
        termQuarters: 2,
        quarter: 1,
      },
    );
    expect(overflowOrigination.ok).toBe(false);
    if (overflowOrigination.ok) return;
    expect(overflowOrigination.code).toBe("DESTINATION_OVERFLOW");
    expect(overflowOrigination.finance).toBe(overflowFinance);
    expect(overflowOrigination.counters).toBe(counters);
  });

  it("derives originatedQuarter directly from authoritative positive origination quarter", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();

    const result = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 500_000,
      annualRateBps: 1_000,
      termQuarters: 4,
      quarter: 5,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loan.originatedQuarter).toBe(5);
  });
});

describe("scheduled player-loan payment", () => {
  it("applies installments sequentially with exact classification and completes at zero balance", () => {
    let finance = createInitialFinance();
    let counters = createInitialCounters();

    // Originate the exact 10% APR / 3-quarter regression loan
    const origination = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 1_000_000, // $10,000
      annualRateBps: 1_000, // 10.00% APR
      termQuarters: 3,
      quarter: 1,
    });
    expect(origination.ok).toBe(true);
    if (!origination.ok) return;

    finance = origination.finance;
    counters = origination.counters;
    const loanId = origination.loan.id;

    // After origination:
    // Alice cash: 1,000,000 cents; Bob cash: 2,000,000 cents.
    // Counters: loan=1, journal=1.

    // --- Installment 1 ---
    const inst1 = applyScheduledPlayerLoanPayment(finance, counters, {
      loanId,
      quarter: 2,
    });
    expect(inst1.ok).toBe(true);
    if (!inst1.ok) return;

    finance = inst1.finance;
    counters = inst1.counters;

    // Payment: 350,137 cents (principal 325,137 + interest 25,000)
    expect(finance.cashByPlayer[bobId]).toBe(2_000_000 - 350_137); // 1,649,863
    expect(finance.cashByPlayer[aliceId]).toBe(1_000_000 + 350_137); // 1,350,137
    expect(inst1.loan.outstandingPrincipalCents).toBe(674_863);
    expect(inst1.loan.installmentsProcessed).toBe(1);

    // Journal breakdown
    expect(inst1.entry.id).toBe("journal-2");
    expect(inst1.entry.amountCents).toBe(350_137);
    expect(inst1.entry.relatedLoanId).toBe(loanId);
    expect(inst1.entry.loanPayment).toEqual({
      principalCents: 325_137,
      interestCents: 25_000,
    });

    // Counters: journal + 1, loan counter NOT incremented
    expect(counters.journal).toBe(2);
    expect(counters.loan).toBe(1);

    // --- Installment 2 ---
    const inst2 = applyScheduledPlayerLoanPayment(finance, counters, {
      loanId,
      quarter: 3,
    });
    expect(inst2.ok).toBe(true);
    if (!inst2.ok) return;

    finance = inst2.finance;
    counters = inst2.counters;

    // Payment: 350,137 cents (principal 333,265 + interest 16,872)
    expect(finance.cashByPlayer[bobId]).toBe(1_649_863 - 350_137); // 1,299,726
    expect(finance.cashByPlayer[aliceId]).toBe(1_350_137 + 350_137); // 1,700,274
    expect(inst2.loan.outstandingPrincipalCents).toBe(341_598);
    expect(inst2.loan.installmentsProcessed).toBe(2);

    expect(inst2.entry.id).toBe("journal-3");
    expect(inst2.entry.amountCents).toBe(350_137);
    expect(inst2.entry.loanPayment).toEqual({
      principalCents: 333_265,
      interestCents: 16_872,
    });
    expect(counters.journal).toBe(3);
    expect(counters.loan).toBe(1);

    // --- Installment 3 (Final) ---
    const inst3 = applyScheduledPlayerLoanPayment(finance, counters, {
      loanId,
      quarter: 4,
    });
    expect(inst3.ok).toBe(true);
    if (!inst3.ok) return;

    finance = inst3.finance;
    counters = inst3.counters;

    // Payment: 350,138 cents (principal 341,598 + interest 8,540)
    expect(finance.cashByPlayer[bobId]).toBe(1_299_726 - 350_138); // 949,588
    expect(finance.cashByPlayer[aliceId]).toBe(1_700_274 + 350_138); // 2,050,412
    expect(inst3.loan.outstandingPrincipalCents).toBe(0);
    expect(inst3.loan.installmentsProcessed).toBe(3);

    expect(inst3.entry.id).toBe("journal-4");
    expect(inst3.entry.amountCents).toBe(350_138);
    expect(inst3.entry.loanPayment).toEqual({
      principalCents: 341_598,
      interestCents: 8_540,
    });
    expect(counters.journal).toBe(4);
    expect(counters.loan).toBe(1);

    // Totals check:
    // Bob originally had 1,000,000, received 1,000,000 loan -> 2,000,000
    // Total payments: 350,137 + 350,137 + 350,138 = 1,050,412
    // Bob ending cash: 2,000,000 - 1,050,412 = 949,588
    // Alice ending cash: 2,000,000 - 1,000,000 + 1,050,412 = 2,050,412 (net +$504.12 interest profit!)
    expect(finance.cashByPlayer[bobId]).toBe(949_588);
    expect(finance.cashByPlayer[aliceId]).toBe(2_050_412);
    expect(inst3.loan.outstandingPrincipalCents).toBe(0);

    // --- Attempting payment 4 on fully repaid loan must reject ---
    const inst4 = applyScheduledPlayerLoanPayment(finance, counters, {
      loanId,
      quarter: 5,
    });
    expect(inst4.ok).toBe(false);
    if (inst4.ok) return;
    expect(inst4.code).toBe("LOAN_ALREADY_REPAID");
    expect(inst4.finance).toBe(finance);
    expect(inst4.counters).toBe(counters);
  });

  it("rejects payment if borrower has insufficient cash without partial mutation", () => {
    let finance = createInitialFinance();
    let counters = createInitialCounters();

    // Bob only has $100 (10,000 cents)
    finance = {
      ...finance,
      cashByPlayer: {
        ...finance.cashByPlayer,
        [bobId]: cents(10_000),
      },
    };

    const origination = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 1_000_000,
      annualRateBps: 1_000,
      termQuarters: 3,
      quarter: 1,
    });
    expect(origination.ok).toBe(true);
    if (!origination.ok) return;

    finance = origination.finance;
    counters = origination.counters;
    const loanId = origination.loan.id;

    // Bob now has 10,000 + 1,000,000 = 1,010,000.
    // Drain Bob's cash to 100 cents
    finance = {
      ...finance,
      cashByPlayer: {
        ...finance.cashByPlayer,
        [bobId]: cents(100),
      },
    };

    // Installment 1 requires 350,137 cents. Bob only has 100 cents.
    const payment = applyScheduledPlayerLoanPayment(finance, counters, {
      loanId,
      quarter: 2,
    });

    expect(payment.ok).toBe(false);
    if (payment.ok) return;
    expect(payment.code).toBe("INSUFFICIENT_FUNDS");

    // Exact state immutability
    expect(payment.finance).toBe(finance);
    expect(payment.counters).toBe(counters);
    expect(payment.finance.cashByPlayer[bobId]).toBe(100);
    const loanAfter = payment.finance.loansById[loanId];
    expect(loanAfter?.outstandingPrincipalCents).toBe(1_000_000);
    if (loanAfter?.kind === "player-loan") {
      expect(loanAfter.installmentsProcessed).toBe(0);
    }
  });

  it("rejects payment for unknown LoanId", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();

    const payment = applyScheduledPlayerLoanPayment(finance, counters, {
      loanId: asLoanId("loan-999"),
      quarter: 1,
    });

    expect(payment.ok).toBe(false);
    if (payment.ok) return;
    expect(payment.code).toBe("UNKNOWN_LOAN");
    expect(payment.finance).toBe(finance);
    expect(payment.counters).toBe(counters);
  });

  it("rejects payment on destination balance overflow without partial mutation", () => {
    let finance = createInitialFinance();
    let counters = createInitialCounters();

    const origination = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 100_000,
      annualRateBps: 400,
      termQuarters: 2,
      quarter: 1,
    });
    expect(origination.ok).toBe(true);
    if (!origination.ok) return;

    finance = origination.finance;
    counters = origination.counters;
    const loanId = origination.loan.id;

    // Simulate lender having cash near Number.MAX_SAFE_INTEGER so receiving payment overflows
    finance = {
      ...finance,
      cashByPlayer: {
        ...finance.cashByPlayer,
        [aliceId]: cents(Number.MAX_SAFE_INTEGER - 10),
      },
    };

    const payment = applyScheduledPlayerLoanPayment(finance, counters, {
      loanId,
      quarter: 2,
    });

    expect(payment.ok).toBe(false);
    if (payment.ok) return;
    expect(payment.code).toBe("DESTINATION_OVERFLOW");
    expect(payment.finance).toBe(finance);
    expect(payment.counters).toBe(counters);
    const loanAfter = payment.finance.loansById[loanId];
    if (loanAfter?.kind === "player-loan") {
      expect(loanAfter.installmentsProcessed).toBe(0);
      expect(loanAfter.outstandingPrincipalCents).toBe(100_000);
    }
  });
});

describe("canonical single-record accounting and determinism", () => {
  it("uses single canonical loan record for both parties and maintains wealth neutrality at origination", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();

    const result = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 500_000,
      annualRateBps: 800,
      termQuarters: 4,
      quarter: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Single record in registry
    expect(Object.keys(result.finance.loansById)).toEqual(["loan-1"]);
    const loan = result.finance.loansById[result.loan.id];
    expect(loan).toBeDefined();
    if (loan?.kind !== "player-loan") return;

    // Both parties are derived from this single record
    expect(loan.lenderPlayerId).toBe(aliceId);
    expect(loan.borrowerPlayerId).toBe(bobId);

    // Lender receivable = 500,000; Borrower liability = 500,000
    const lenderReceivable = loan.outstandingPrincipalCents;
    const borrowerLiability = loan.outstandingPrincipalCents;
    expect(lenderReceivable).toBe(borrowerLiability);

    // Combined net wealth change at origination:
    // Alice cash: -500k, Alice receivable: +500k -> net 0
    // Bob cash: +500k, Bob liability: -500k -> net 0
    const aliceCashAfter = result.finance.cashByPlayer[aliceId] ?? 0;
    const aliceCashBefore = finance.cashByPlayer[aliceId] ?? 0;
    const bobCashAfter = result.finance.cashByPlayer[bobId] ?? 0;
    const bobCashBefore = finance.cashByPlayer[bobId] ?? 0;
    const aliceCashDelta = aliceCashAfter - aliceCashBefore;
    const bobCashDelta = bobCashAfter - bobCashBefore;
    expect(aliceCashDelta + lenderReceivable).toBe(0);
    expect(bobCashDelta - borrowerLiability).toBe(0);
  });

  it("is strictly deterministic and consumes no RNG", () => {
    const finance = createInitialFinance();
    const counters = createInitialCounters();

    const run1 = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 400_000,
      annualRateBps: 600,
      termQuarters: 4,
      quarter: 1,
    });

    const run2 = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 400_000,
      annualRateBps: 600,
      termQuarters: 4,
      quarter: 1,
    });

    expect(run1).toEqual(run2);
  });
});

describe("game invariants and setup regression", () => {
  it("initializes opening legacy bank loans on game creation and passes assertGameState", () => {
    const game = createGame({
      gameId: "test-game-1",
      seed: "deterministic-seed-123",
      playerIds: [aliceId, bobId, charlieId, danaId],
    });

    expect(Object.keys(game.finance.loansById).length).toBeGreaterThan(0);
    expect(() => assertGameState(game)).not.toThrow();
  });

  it("validates game state with an active and completed loan", () => {
    const game = createGame({
      gameId: "test-game-2",
      seed: "deterministic-seed-456",
      playerIds: [aliceId, bobId, charlieId, danaId],
    });

    // Originate a loan in game finance
    const origination = originateConfirmedPlayerLoan(
      game.finance,
      game.counters,
      {
        lenderPlayerId: aliceId,
        borrowerPlayerId: bobId,
        principalCents: 100_000,
        annualRateBps: 400,
        termQuarters: 2,
        quarter: 1,
      },
    );
    expect(origination.ok).toBe(true);
    if (!origination.ok) return;

    const gameStateWithLoan = {
      ...game,
      finance: origination.finance,
      counters: origination.counters,
    };

    expect(() => assertGameState(gameStateWithLoan)).not.toThrow();

    function atQuarter(state: typeof gameStateWithLoan, quarter: number) {
      return {
        ...state,
        currentQuarter: quarter,
        lastSettledQuarter: quarter - 1,
        finance: {
          ...state.finance,
          quarterStartBasis: { ...state.finance.quarterStartBasis, quarter },
        },
        economy: {
          ...state.economy,
          lastMarketUpdate: {
            quarter: quarter - 1,
            regimeUsed: state.economy.currentRegime,
            returnBpsByInstrument: {
              "broad-market-fund": 0,
              "growth-fund": 0,
              "income-defensive-fund": 0,
            },
          },
        },
      };
    }
    // Pay installment 1
    const p1 = applyScheduledPlayerLoanPayment(
      gameStateWithLoan.finance,
      gameStateWithLoan.counters,
      {
        loanId: origination.loan.id,
        quarter: 2,
      },
    );
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;

    const stateAfterP1 = {
      ...gameStateWithLoan,
      finance: p1.finance,
      counters: p1.counters,
    };
    expect(() => assertGameState(atQuarter(stateAfterP1, 2))).not.toThrow();

    // Pay installment 2 (final)
    const p2 = applyScheduledPlayerLoanPayment(
      stateAfterP1.finance,
      stateAfterP1.counters,
      {
        loanId: origination.loan.id,
        quarter: 3,
      },
    );
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;

    const stateAfterP2 = {
      ...gameStateWithLoan,
      finance: p2.finance,
      counters: p2.counters,
    };
    expect(() => assertGameState(atQuarter(stateAfterP2, 3))).not.toThrow();

    // Invariant failure on corrupted outstanding principal
    const existingLoan = stateAfterP1.finance.loansById[origination.loan.id];
    expect(existingLoan).toBeDefined();
    if (!existingLoan) return;

    const corruptedLoanState = {
      ...stateAfterP1,
      finance: {
        ...stateAfterP1.finance,
        loansById: {
          ...stateAfterP1.finance.loansById,
          [origination.loan.id]: {
            ...existingLoan,
            outstandingPrincipalCents: cents(999), // inconsistent with schedule
          },
        },
      },
    };
    expect(() => assertGameState(atQuarter(corruptedLoanState, 2))).toThrow(
      /Game invariant failed.*outstanding principal/,
    );
  });

  it("preserves assetsById across loan origination and scheduled payments", () => {
    const property = {
      id: asAssetId("asset-prop-1"),
      kind: "property" as const,
      marketValueCents: cents(30_000_000),
      scheduledQuarterlyRentCents: cents(300_000),
      occupancyBps: basisPoints(9_500),
      operatingExpenseRatioBps: basisPoints(3_500),
      ownershipByPlayerPpm: {
        [aliceId]: ownershipPpm(1_000_000),
      },
    };

    const finance: FinanceState = {
      ...createInitialFinance(),
      assetsById: {
        [property.id]: property,
      },
    };
    const counters = createInitialCounters();

    // Originate loan
    const origination = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: aliceId,
      borrowerPlayerId: bobId,
      principalCents: 100_000,
      annualRateBps: 800,
      termQuarters: 2,
      quarter: 1,
    });
    expect(origination.ok).toBe(true);
    if (!origination.ok) return;

    expect(origination.finance.assetsById).toBeDefined();
    expect(origination.finance.assetsById[property.id]).toBe(property);

    // Apply scheduled payment
    const payment = applyScheduledPlayerLoanPayment(
      origination.finance,
      origination.counters,
      {
        loanId: origination.loan.id,
        quarter: 2,
      },
    );
    expect(payment.ok).toBe(true);
    if (!payment.ok) return;

    expect(payment.finance.assetsById).toBeDefined();
    expect(payment.finance.assetsById[property.id]).toBe(property);
  });
});
