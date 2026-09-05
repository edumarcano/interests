import type { LoanId } from "@finance-game/shared";

import { nextDeterministicId } from "../game/deterministicIds";
import type { DeterministicCounters, FinanceState } from "../model/gameState";
import { type CashAccount, isSameCashAccount } from "./account";
import type { JournalEntry, LoanPaymentBreakdown } from "./journal";
import { cents, isNonNegativeCents } from "./money";

export interface CashPostingRequest {
  readonly source: CashAccount;
  readonly destination: CashAccount;
  readonly amountCents: number;
  readonly reason: string;
  readonly quarter: number;
  readonly relatedLoanId?: LoanId;
  readonly loanPayment?: LoanPaymentBreakdown;
}

export type CashPostingErrorCode =
  | "INVALID_AMOUNT"
  | "UNKNOWN_PLAYER"
  | "INSUFFICIENT_FUNDS"
  | "DESTINATION_OVERFLOW"
  | "SAME_ACCOUNT"
  | "INVALID_ENDPOINT";

export type CashPostingResult =
  | {
      readonly ok: true;
      readonly finance: FinanceState;
      readonly counters: DeterministicCounters;
      readonly entry: JournalEntry;
    }
  | {
      readonly ok: false;
      readonly finance: FinanceState;
      readonly counters: DeterministicCounters;
      readonly code: CashPostingErrorCode;
    };

export function postCash(
  finance: FinanceState,
  counters: DeterministicCounters,
  request: CashPostingRequest,
): CashPostingResult {
  const reject = (code: CashPostingErrorCode): CashPostingResult => ({
    ok: false,
    finance,
    counters,
    code,
  });

  // 1. Amount validation: must be a positive safe integer of cents
  if (
    !Number.isSafeInteger(request.amountCents) ||
    request.amountCents <= 0 ||
    request.amountCents > Number.MAX_SAFE_INTEGER
  ) {
    return reject("INVALID_AMOUNT");
  }

  // If structured loan payment breakdown is provided, validate it matches total amount
  if (request.loanPayment !== undefined) {
    if (
      !isNonNegativeCents(request.loanPayment.principalCents) ||
      !isNonNegativeCents(request.loanPayment.interestCents) ||
      request.loanPayment.principalCents + request.loanPayment.interestCents !==
        request.amountCents
    ) {
      return reject("INVALID_AMOUNT");
    }
  }

  // 2. Quarter validation: must be a non-negative safe integer
  if (!Number.isSafeInteger(request.quarter) || request.quarter < 0) {
    return reject("INVALID_AMOUNT");
  }

  // 3. Endpoint identity validation: cannot post between identical endpoints
  if (isSameCashAccount(request.source, request.destination)) {
    return reject("SAME_ACCOUNT");
  }

  // External-to-external postings have no economic meaning in this engine
  if (
    request.source.kind === "external" &&
    request.destination.kind === "external"
  ) {
    return reject("INVALID_ENDPOINT");
  }

  // 4. Source endpoint validation & affordability check
  let sourceBalance = 0;
  if (request.source.kind === "player") {
    const balance = finance.cashByPlayer[request.source.playerId];
    if (balance === undefined) {
      return reject("UNKNOWN_PLAYER");
    }
    sourceBalance = balance;
    if (sourceBalance < request.amountCents) {
      return reject("INSUFFICIENT_FUNDS");
    }
  }

  // 5. Destination endpoint validation & overflow check
  let destBalance = 0;
  if (request.destination.kind === "player") {
    const balance = finance.cashByPlayer[request.destination.playerId];
    if (balance === undefined) {
      return reject("UNKNOWN_PLAYER");
    }
    destBalance = balance;
    if (request.amountCents > Number.MAX_SAFE_INTEGER - destBalance) {
      return reject("DESTINATION_OVERFLOW");
    }
  }

  // 6. Generate next deterministic journal ID
  const { id: journalId, counters: nextCounters } = nextDeterministicId(
    "journal",
    counters,
  );

  // 7. Calculate updated player balances
  const nextCashByPlayer = { ...finance.cashByPlayer };

  if (request.source.kind === "player") {
    nextCashByPlayer[request.source.playerId] = cents(
      sourceBalance - request.amountCents,
    );
  }

  if (request.destination.kind === "player") {
    nextCashByPlayer[request.destination.playerId] = cents(
      destBalance + request.amountCents,
    );
  }

  const entry: JournalEntry = {
    id: journalId,
    source: request.source,
    destination: request.destination,
    amountCents: cents(request.amountCents),
    reason: request.reason,
    quarter: request.quarter,
    ...(request.relatedLoanId !== undefined
      ? { relatedLoanId: request.relatedLoanId }
      : {}),
    ...(request.loanPayment !== undefined
      ? { loanPayment: request.loanPayment }
      : {}),
  };

  return {
    ok: true,
    finance: {
      ...finance,
      cashByPlayer: nextCashByPlayer,
    },
    counters: nextCounters,
    entry,
  };
}
