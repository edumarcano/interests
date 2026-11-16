import type { PublicMarketInstrumentId } from "@interests/rules";
import type { AssetId, LoanId, TransactionId } from "@interests/shared";

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
  readonly relatedAssetId?: AssetId;
  readonly relatedMarketInstrumentId?: PublicMarketInstrumentId;
  readonly relatedTransactionId?: TransactionId;
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

  const balanceOf = (account: CashAccount): number | undefined => {
    if (account.kind === "external") return 0;
    if (account.kind === "player")
      return finance.cashByPlayer[account.playerId];
    const asset = finance.assetsById[account.assetId];
    return asset?.kind === "business" ? asset.cashCents : undefined;
  };
  const sourceBalance = balanceOf(request.source);
  const destBalance = balanceOf(request.destination);
  if (sourceBalance === undefined || destBalance === undefined) {
    return reject(
      request.source.kind === "business" ||
        request.destination.kind === "business"
        ? "INVALID_ENDPOINT"
        : "UNKNOWN_PLAYER",
    );
  }
  if (request.source.kind !== "external" && sourceBalance < request.amountCents)
    return reject("INSUFFICIENT_FUNDS");
  if (
    request.destination.kind !== "external" &&
    request.amountCents > Number.MAX_SAFE_INTEGER - destBalance
  )
    return reject("DESTINATION_OVERFLOW");

  // 6. Generate next deterministic journal ID
  const { id: journalId, counters: nextCounters } = nextDeterministicId(
    "journal",
    counters,
  );

  const nextCashByPlayer = { ...finance.cashByPlayer };
  let assetsById = finance.assetsById;
  const writeBalance = (account: CashAccount, balance: number) => {
    if (account.kind === "player")
      nextCashByPlayer[account.playerId] = cents(balance);
    else if (account.kind === "business") {
      const asset = assetsById[account.assetId];
      if (!asset || asset.kind !== "business")
        throw new Error("Missing preflighted business account");
      assetsById = {
        ...assetsById,
        [asset.id]: { ...asset, cashCents: cents(balance) },
      };
    }
  };
  if (request.source.kind !== "external")
    writeBalance(request.source, sourceBalance - request.amountCents);
  if (request.destination.kind !== "external")
    writeBalance(request.destination, destBalance + request.amountCents);

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
    ...(request.relatedAssetId !== undefined
      ? { relatedAssetId: request.relatedAssetId }
      : {}),
    ...(request.relatedMarketInstrumentId !== undefined
      ? { relatedMarketInstrumentId: request.relatedMarketInstrumentId }
      : {}),
    ...(request.relatedTransactionId !== undefined
      ? { relatedTransactionId: request.relatedTransactionId }
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
      assetsById,
    },
    counters: nextCounters,
    entry,
  };
}
