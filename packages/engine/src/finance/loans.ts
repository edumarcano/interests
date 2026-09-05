import {
  PLAYER_LOAN_MAX_TERM_QUARTERS,
  PLAYER_LOAN_MIN_TERM_QUARTERS,
} from "@finance-game/rules";
import type { LoanId, PlayerId } from "@finance-game/shared";

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
import { postCash } from "./posting";

export interface OriginatePlayerLoanRequest {
  readonly lenderPlayerId: PlayerId;
  readonly borrowerPlayerId: PlayerId;
  readonly principalCents: number;
  readonly annualRateBps: number;
  readonly termQuarters: number;
  readonly quarter: number;
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
  | "UNSUPPORTED_TERMS";

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
  | "LOAN_ALREADY_REPAID"
  | "UNKNOWN_PLAYER"
  | "INSUFFICIENT_FUNDS"
  | "DESTINATION_OVERFLOW"
  | "INVALID_QUARTER";

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

  // 6. Quarter validation
  if (!Number.isSafeInteger(request.quarter) || request.quarter < 0) {
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

  // 8. Generate deterministic LoanId
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
    installmentsPaid: 0,
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

  // 3. Verify loan is not already fully repaid
  if (
    loan.installmentsPaid >= loan.termQuarters ||
    loan.outstandingPrincipalCents === 0
  ) {
    return reject("LOAN_ALREADY_REPAID");
  }

  // 4. Authoritatively calculate schedule and identify the next installment
  const schedule = calculatePlayerLoanSchedule({
    principalCents: loan.originalPrincipalCents,
    annualRateBps: loan.annualRateBps,
    termQuarters: loan.termQuarters,
  });

  const nextInstallment = schedule[loan.installmentsPaid];
  if (nextInstallment === undefined) {
    return reject("LOAN_ALREADY_REPAID");
  }

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
  const updatedLoan: PlayerLoan = {
    ...loan,
    outstandingPrincipalCents: nextInstallment.closingPrincipalCents,
    installmentsPaid: loan.installmentsPaid + 1,
  };

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
