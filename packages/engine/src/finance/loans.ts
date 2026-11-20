import {
  PLAYER_LOAN_MAX_TERM_QUARTERS,
  PLAYER_LOAN_MIN_TERM_QUARTERS,
} from "@interests/rules";
import type { LoanId, PlayerId, TransactionId } from "@interests/shared";

import { nextDeterministicId } from "../game/deterministicIds";
import type {
  DeterministicCounters,
  FinanceState,
  PlayerLoan,
} from "../model/gameState";
import { playerCashAccount } from "./account";
import { calculatePlayerLoanSchedule } from "./amortization";
import type { JournalEntry } from "./journal";
import { basisPoints, cents } from "./money";
import {
  applyLoanPaymentAllocation,
  calculateLoanObligation,
} from "./obligations";
import { postCash } from "./posting";

export interface OriginatePlayerLoanRequest {
  readonly lenderPlayerId: PlayerId;
  readonly borrowerPlayerId: PlayerId;
  readonly principalCents: number;
  readonly annualRateBps: number;
  readonly termQuarters: number;
  readonly quarter: number;
  readonly relatedTransactionId?: TransactionId;
}

export type OriginatePlayerLoanErrorCode =
  | "UNKNOWN_PLAYER"
  | "SAME_PLAYER"
  | "INVALID_PRINCIPAL"
  | "INVALID_RATE"
  | "INVALID_TERM"
  | "INVALID_QUARTER"
  | "INSUFFICIENT_FUNDS"
  | "DESTINATION_OVERFLOW"
  | "UNSUPPORTED_TERMS"
  | "LOAN_ID_EXHAUSTED";

export type OriginatePlayerLoanResult =
  | {
      readonly ok: true;
      readonly finance: FinanceState;
      readonly counters: DeterministicCounters;
      readonly loan: PlayerLoan;
      readonly entry: JournalEntry;
    }
  | {
      readonly ok: false;
      readonly finance: FinanceState;
      readonly counters: DeterministicCounters;
      readonly code: OriginatePlayerLoanErrorCode;
    };

export interface ApplyScheduledPlayerLoanPaymentRequest {
  readonly loanId: LoanId;
  readonly quarter: number;
}

export type ApplyScheduledPlayerLoanPaymentErrorCode =
  | "UNKNOWN_LOAN"
  | "WRONG_LOAN_KIND"
  | "LOAN_ALREADY_REPAID"
  | "UNKNOWN_PLAYER"
  | "INSUFFICIENT_FUNDS"
  | "DESTINATION_OVERFLOW"
  | "INVALID_QUARTER"
  | "PAYMENT_NOT_DUE";

export type ApplyScheduledPlayerLoanPaymentResult =
  | {
      readonly ok: true;
      readonly finance: FinanceState;
      readonly counters: DeterministicCounters;
      readonly loan: PlayerLoan;
      readonly entry: JournalEntry;
    }
  | {
      readonly ok: false;
      readonly finance: FinanceState;
      readonly counters: DeterministicCounters;
      readonly code: ApplyScheduledPlayerLoanPaymentErrorCode;
    };

/**
 * Pure internal finance operation that atomically originates an already-confirmed
 * player-to-player loan.
 *
 * NOTE: This is an internal engine operation and must not be exposed as a public
 * root API. It does not perform player negotiation or consent checks.
 */
export function originateConfirmedPlayerLoan(
  finance: FinanceState,
  counters: DeterministicCounters,
  request: OriginatePlayerLoanRequest,
): OriginatePlayerLoanResult {
  const reject = (
    code: OriginatePlayerLoanErrorCode,
  ): OriginatePlayerLoanResult => ({
    ok: false,
    finance,
    counters,
    code,
  });

  // 1. Lender and borrower validation
  if (request.lenderPlayerId === request.borrowerPlayerId) {
    return reject("SAME_PLAYER");
  }

  const lenderCash = finance.cashByPlayer[request.lenderPlayerId];
  if (lenderCash === undefined) {
    return reject("UNKNOWN_PLAYER");
  }

  const borrowerCash = finance.cashByPlayer[request.borrowerPlayerId];
  if (borrowerCash === undefined) {
    return reject("UNKNOWN_PLAYER");
  }

  // 2. Principal validation
  if (
    !Number.isSafeInteger(request.principalCents) ||
    request.principalCents <= 0 ||
    request.principalCents > Number.MAX_SAFE_INTEGER
  ) {
    return reject("INVALID_PRINCIPAL");
  }

  // 3. Lender cash check
  if (lenderCash < request.principalCents) {
    return reject("INSUFFICIENT_FUNDS");
  }

  // 4. Rate validation
  if (
    !Number.isSafeInteger(request.annualRateBps) ||
    request.annualRateBps < 0 ||
    request.annualRateBps > Number.MAX_SAFE_INTEGER
  ) {
    return reject("INVALID_RATE");
  }

  // 5. Term validation
  if (
    !Number.isSafeInteger(request.termQuarters) ||
    request.termQuarters < PLAYER_LOAN_MIN_TERM_QUARTERS ||
    request.termQuarters > PLAYER_LOAN_MAX_TERM_QUARTERS
  ) {
    return reject("INVALID_TERM");
  }

  // 6. Quarter validation: authoritative origination quarter must be a positive safe integer
  if (!Number.isSafeInteger(request.quarter) || request.quarter <= 0) {
    return reject("INVALID_QUARTER");
  }

  // 7. Verify schedule is calculable without error
  try {
    calculatePlayerLoanSchedule({
      principalCents: request.principalCents,
      annualRateBps: request.annualRateBps,
      termQuarters: request.termQuarters,
    });
  } catch {
    return reject("UNSUPPORTED_TERMS");
  }

  // 8. Preflight loan counter capacity and generate deterministic LoanId
  if (counters.loan >= Number.MAX_SAFE_INTEGER) {
    return reject("LOAN_ID_EXHAUSTED");
  }

  const { id: loanId, counters: countersWithLoan } = nextDeterministicId(
    "loan",
    counters,
  );

  // 9. Transfer principal from lender to borrower via postCash
  const postResult = postCash(finance, countersWithLoan, {
    source: playerCashAccount(request.lenderPlayerId),
    destination: playerCashAccount(request.borrowerPlayerId),
    amountCents: request.principalCents,
    reason: "loan-origination",
    quarter: request.quarter,
    relatedLoanId: loanId,
    ...(request.relatedTransactionId !== undefined
      ? { relatedTransactionId: request.relatedTransactionId }
      : {}),
  });

  if (!postResult.ok) {
    // Truthfully report reachable posting failure; throw on impossible codes
    if (postResult.code === "DESTINATION_OVERFLOW") {
      return reject("DESTINATION_OVERFLOW");
    }
    if (postResult.code === "INSUFFICIENT_FUNDS") {
      return reject("INSUFFICIENT_FUNDS");
    }
    throw new Error(
      `Invariant violation: unexpected cash posting failure during loan origination: ${postResult.code}`,
    );
  }

  // 10. Establish canonical loan record
  const loan: PlayerLoan = {
    id: loanId,
    kind: "player-loan",
    lenderPlayerId: request.lenderPlayerId,
    borrowerPlayerId: request.borrowerPlayerId,
    originalPrincipalCents: cents(request.principalCents),
    outstandingPrincipalCents: cents(request.principalCents),
    annualRateBps: basisPoints(request.annualRateBps),
    termQuarters: request.termQuarters,
    installmentsProcessed: 0,
    principalRepaidCents: cents(0),
    pastDuePrincipalCents: cents(0),
    unpaidInterestCents: cents(0),
    lastProcessedQuarter: 0,
    originatedQuarter: request.quarter,
    settledInterestReceipts: [],
    ...(request.relatedTransactionId !== undefined
      ? { fundedTransactionId: request.relatedTransactionId }
      : {}),
  };

  const nextLoansById = {
    ...postResult.finance.loansById,
    [loanId]: loan,
  };

  return {
    ok: true,
    finance: {
      ...postResult.finance,
      loansById: nextLoansById,
    },
    counters: postResult.counters,
    loan,
    entry: postResult.entry,
  };
}

/**
 * Pure internal finance operation that applies the next scheduled payment for an
 * existing player loan.
 *
 * NOTE: This is an internal engine operation and must not be exposed as a public
 * root API. It calculates the exact installment row authoritatively.
 */
export function applyScheduledPlayerLoanPayment(
  finance: FinanceState,
  counters: DeterministicCounters,
  request: ApplyScheduledPlayerLoanPaymentRequest,
): ApplyScheduledPlayerLoanPaymentResult {
  const reject = (
    code: ApplyScheduledPlayerLoanPaymentErrorCode,
  ): ApplyScheduledPlayerLoanPaymentResult => ({
    ok: false,
    finance,
    counters,
    code,
  });

  // 1. Quarter validation
  if (!Number.isSafeInteger(request.quarter) || request.quarter < 0) {
    return reject("INVALID_QUARTER");
  }

  // 2. Load canonical loan
  const loan = finance.loansById[request.loanId];
  if (loan === undefined) {
    return reject("UNKNOWN_LOAN");
  }
  if (loan.kind !== "player-loan") {
    return reject("WRONG_LOAN_KIND");
  }

  if (loan.outstandingPrincipalCents === 0 && loan.unpaidInterestCents === 0) {
    return reject("LOAN_ALREADY_REPAID");
  }
  const obligation = calculateLoanObligation(loan, request.quarter);
  if (!obligation) return reject("PAYMENT_NOT_DUE");
  const applied = applyLoanPaymentAllocation(
    loan,
    obligation,
    obligation.amountDueCents,
    request.quarter,
  );
  const nextInstallment = {
    paymentCents: obligation.amountDueCents,
    principalCents: applied.outcome.principalPaidCents,
    interestCents: applied.outcome.interestPaidCents,
  };

  // 5. Verify borrower cash availability before posting
  const borrowerCash = finance.cashByPlayer[loan.borrowerPlayerId];
  if (borrowerCash === undefined) {
    return reject("UNKNOWN_PLAYER");
  }

  const lenderCash = finance.cashByPlayer[loan.lenderPlayerId];
  if (lenderCash === undefined) {
    return reject("UNKNOWN_PLAYER");
  }

  if (borrowerCash < nextInstallment.paymentCents) {
    return reject("INSUFFICIENT_FUNDS");
  }

  // 6. Transfer total payment from borrower to lender via postCash
  const postResult = postCash(finance, counters, {
    source: playerCashAccount(loan.borrowerPlayerId),
    destination: playerCashAccount(loan.lenderPlayerId),
    amountCents: nextInstallment.paymentCents,
    reason: "loan-payment",
    quarter: request.quarter,
    relatedLoanId: loan.id,
    loanPayment: {
      principalCents: nextInstallment.principalCents,
      interestCents: nextInstallment.interestCents,
    },
  });

  if (!postResult.ok) {
    if (postResult.code === "DESTINATION_OVERFLOW") {
      return reject("DESTINATION_OVERFLOW");
    }
    if (postResult.code === "INSUFFICIENT_FUNDS") {
      return reject("INSUFFICIENT_FUNDS");
    }
    throw new Error(
      `Invariant violation: unexpected cash posting failure during scheduled payment: ${postResult.code}`,
    );
  }

  // 7. Update canonical loan record
  const updatedLoan = applied.loan as PlayerLoan;

  const nextLoansById = {
    ...postResult.finance.loansById,
    [loan.id]: updatedLoan,
  };

  return {
    ok: true,
    finance: {
      ...postResult.finance,
      loansById: nextLoansById,
    },
    counters: postResult.counters,
    loan: updatedLoan,
    entry: postResult.entry,
  };
}
