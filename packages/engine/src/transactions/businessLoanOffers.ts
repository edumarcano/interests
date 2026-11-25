import {
  asPlayerId,
  type BusinessLoanOfferView,
  type BusinessLoanRequest,
  type PlayerId,
} from "@interests/shared";
import { calculatePlayerLoanSchedule } from "../finance/amortization";
import type { JournalEntry } from "../finance/journal";
import { originateConfirmedPlayerLoan } from "../finance/loans";
import { cents, isNonNegativeCents } from "../finance/money";
import type { GameState } from "../model/gameState";
import type {
  BusinessCapitalTransaction,
  BusinessLoanOffer,
  TransactionResult,
} from "./model";

export function loanRequests(
  tx: Pick<BusinessCapitalTransaction, "terms">,
): readonly BusinessLoanRequest[] {
  return tx.terms.kind === "secondary-stake-sale"
    ? (tx.terms.loanRequests ?? [])
    : [];
}

export function canOfferBusinessLoan(
  tx: Pick<BusinessCapitalTransaction, "terms">,
  lender: PlayerId,
  slot: number,
): boolean {
  const request = loanRequests(tx)[slot];
  return (
    !!request &&
    tx.terms.kind === "secondary-stake-sale" &&
    lender !== tx.terms.buyerPlayerId &&
    lender !== tx.terms.sellerPlayerId &&
    (!request.invitedLenderId || request.invitedLenderId === lender)
  );
}

export function borrowerHasArrears(
  state: GameState,
  borrower: PlayerId,
): boolean {
  return (
    (state.finance.livingArrearsByPlayer[borrower] ?? 0) > 0 ||
    Object.values(state.finance.loansById).some(
      (loan) =>
        (loan.kind === "player-loan" || loan.kind === "legacy-bank-loan") &&
        loan.borrowerPlayerId === borrower &&
        (loan.pastDuePrincipalCents > 0 || loan.unpaidInterestCents > 0),
    )
  );
}

export function selectedBusinessLoanOffers(
  tx: BusinessCapitalTransaction,
): readonly BusinessLoanOffer[] {
  return [...(tx.selectedLoans ?? [])]
    .sort((a, b) => a.slot - b.slot)
    .map((choice) => {
      const offer = tx.loanOffers?.find(
        (row) =>
          row.slot === choice.slot &&
          row.lenderPlayerId === choice.lenderPlayerId,
      );
      if (!offer)
        throw new Error("Selected business financing offer is missing");
      return offer;
    });
}

export function validateBusinessLoanOffer(
  tx: BusinessCapitalTransaction,
  offer: BusinessLoanOffer,
): boolean {
  if (
    !Number.isInteger(offer.slot) ||
    offer.slot < 0 ||
    !canOfferBusinessLoan(tx, offer.lenderPlayerId, offer.slot)
  )
    return false;
  const request = loanRequests(tx)[offer.slot];
  if (!request || !isNonNegativeCents(offer.annualRateBps)) return false;
  try {
    calculatePlayerLoanSchedule({
      principalCents: request.principalCents,
      annualRateBps: offer.annualRateBps,
      termQuarters: offer.termQuarters,
    });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

export function reservedBusinessLoanCash(
  tx: BusinessCapitalTransaction,
  lender: PlayerId,
): number {
  return (tx.loanOffers ?? []).reduce(
    (total, offer) =>
      offer.lenderPlayerId === lender
        ? cents(total + (loanRequests(tx)[offer.slot]?.principalCents ?? 0))
        : total,
    0,
  );
}

export function assertBusinessLoanOffers(
  state: GameState,
  tx: BusinessCapitalTransaction,
): void {
  const offers = new Set<string>();
  const slots = new Set<number>();
  if (
    (tx.loanOffers !== undefined && !Array.isArray(tx.loanOffers)) ||
    (tx.selectedLoans !== undefined && !Array.isArray(tx.selectedLoans))
  )
    throw new Error("Invalid business financing lists");
  for (const offer of tx.loanOffers ?? []) {
    const key = JSON.stringify([offer.slot, offer.lenderPlayerId]);
    if (
      !Object.hasOwn(state.players, offer.lenderPlayerId) ||
      offers.has(key) ||
      !validateBusinessLoanOffer(tx, offer)
    )
      throw new Error("Invalid business loan offer");
    offers.add(key);
  }
  for (const id of state.playerOrder) {
    if (
      reservedBusinessLoanCash(tx, id) > (state.finance.cashByPlayer[id] ?? 0)
    )
      throw new Error("Business loan offers exceed available cash");
  }
  for (const selection of tx.selectedLoans ?? []) {
    if (
      slots.has(selection.slot) ||
      !offers.has(JSON.stringify([selection.slot, selection.lenderPlayerId]))
    )
      throw new Error("Invalid business loan selection");
    slots.add(selection.slot);
  }
}

export function businessLoanOfferViews(
  tx: BusinessCapitalTransaction,
  viewer: PlayerId,
): readonly BusinessLoanOfferView[] {
  if (tx.terms.kind !== "secondary-stake-sale") return [];
  const isBorrower = tx.terms.buyerPlayerId === viewer;
  return (tx.loanOffers ?? []).flatMap((offer) => {
    const selected = (tx.selectedLoans ?? []).some(
      (choice) =>
        choice.slot === offer.slot &&
        choice.lenderPlayerId === offer.lenderPlayerId,
    );
    return isBorrower ||
      offer.lenderPlayerId === viewer ||
      (selected &&
        tx.terms.kind === "secondary-stake-sale" &&
        tx.terms.sellerPlayerId === viewer)
      ? [
          {
            lenderPlayerId: offer.lenderPlayerId,
            slot: offer.slot,
            annualRateBps: offer.annualRateBps,
            termQuarters: offer.termQuarters,
            selected,
          },
        ]
      : [];
  });
}

/** Draft all selected loans before posting the secondary purchase. */
export function fundBusinessSaleWithPlayerLoans(
  state: GameState,
  tx: BusinessCapitalTransaction,
): TransactionResult {
  const reject = (
    code: Extract<TransactionResult, { ok: false }>["code"],
  ): TransactionResult => ({ ok: false, state, code, journalEntries: [] });
  const requests = loanRequests(tx);
  if (tx.terms.kind !== "secondary-stake-sale" || !requests.length)
    return { ok: true, state, journalEntries: [] };
  const borrowerPlayerId = asPlayerId(tx.terms.buyerPlayerId);
  if (borrowerHasArrears(state, borrowerPlayerId))
    return reject("FINANCING_NOT_READY");
  const offers = selectedBusinessLoanOffers(tx);
  if (offers.length !== requests.length) return reject("FINANCING_NOT_READY");
  let { finance, counters } = state;
  const journalEntries: JournalEntry[] = [];
  for (const offer of offers) {
    const request = requests[offer.slot];
    if (!request) return reject("FINANCING_NOT_READY");
    if (counters.journal >= Number.MAX_SAFE_INTEGER)
      return reject("JOURNAL_ID_EXHAUSTED");
    const result = originateConfirmedPlayerLoan(finance, counters, {
      lenderPlayerId: offer.lenderPlayerId,
      borrowerPlayerId,
      principalCents: request.principalCents,
      annualRateBps: offer.annualRateBps,
      termQuarters: offer.termQuarters,
      quarter: state.currentQuarter,
      relatedTransactionId: tx.id,
    });
    if (!result.ok)
      return reject(
        result.code === "SAME_PLAYER"
          ? "SAME_PARTY"
          : result.code === "INVALID_PRINCIPAL"
            ? "INVALID_FINANCING_REQUEST"
            : result.code,
      );
    finance = result.finance;
    counters = result.counters;
    journalEntries.push(result.entry);
  }
  return { ok: true, state: { ...state, finance, counters }, journalEntries };
}
