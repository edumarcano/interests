import {
  BANK_CREDIT_GRADES,
  BANK_LENDING_RULES,
  MARKET_BORROWER_TEMPLATES,
} from "@interests/rules";
import type { MarketLoanQuoteView, PlayerId } from "@interests/shared";
import type { ActionResult } from "../game/actions";
import { nextDeterministicId } from "../game/deterministicIds";
import type { GameState, NpcLoan } from "../model/gameState";
import { getAvailableCashCents } from "../transactions/reservations";
import { externalCashAccount, playerCashAccount } from "./account";
import { calculatePlayerLoanSchedule } from "./amortization";
import { addCents, basisPoints, cents, isNonNegativeCents } from "./money";
import { postCash } from "./posting";

/** Terms come from the authoritative recurring card; they are never a wire payload. */
export interface NpcFundingTerms {
  readonly borrowerId: string;
  readonly borrowerName: string;
  readonly principalCents: number;
  readonly annualRateBps: number;
  readonly termQuarters: number;
  readonly quarterlyRepaymentCapacityCents: number;
}

/** Resolve once at card generation. Store the result with the card, not a current-rate reference. */
export function materializeNpcFundingTerms(
  cardTemplateId: string,
  principalCents: number,
  openingBaseRateBps: number,
): NpcFundingTerms | null {
  const template = MARKET_BORROWER_TEMPLATES.find(
    (row) => row.cardTemplateId === cardTemplateId,
  );
  if (
    !template ||
    !isNonNegativeCents(openingBaseRateBps) ||
    !isNonNegativeCents(principalCents) ||
    !principalCents
  )
    return null;
  const grade = BANK_CREDIT_GRADES.find(
    (row) => row.id === template.creditGrade,
  );
  if (!grade) throw new Error("Missing authored borrower credit spread");
  const terms: NpcFundingTerms = {
    borrowerId: template.borrowerId,
    borrowerName: template.name,
    principalCents,
    annualRateBps:
      openingBaseRateBps +
      grade.spreadBps +
      BANK_LENDING_RULES.businessPremiumBps,
    termQuarters: template.termQuarters,
    quarterlyRepaymentCapacityCents: template.quarterlyRepaymentCapacityCents,
  };
  return validNpcFundingTerms(terms) ? terms : null;
}

export function npcOfferAvailable(
  state: GameState,
  borrowerId: string,
): boolean {
  return !Object.values(state.finance.loansById).some(
    (loan) =>
      loan.kind === "npc-loan" &&
      loan.borrowerId === borrowerId &&
      (loan.outstandingPrincipalCents > 0 || loan.unpaidInterestCents > 0),
  );
}

export function validNpcFundingTerms(terms: NpcFundingTerms): boolean {
  if (
    typeof terms.borrowerId !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(terms.borrowerId) ||
    typeof terms.borrowerName !== "string" ||
    !terms.borrowerName.trim() ||
    terms.borrowerName.length > 100 ||
    !isNonNegativeCents(terms.principalCents) ||
    !terms.principalCents ||
    !isNonNegativeCents(terms.annualRateBps) ||
    !isNonNegativeCents(terms.quarterlyRepaymentCapacityCents)
  )
    return false;
  try {
    calculatePlayerLoanSchedule(terms).reduce(
      (total, row) => addCents(total, row.interestCents),
      cents(0),
    );
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

/** Public fields for the card's recipient; do not expose the internal repayment capacity. */
export function quoteNpcFunding(
  state: GameState,
  lender: PlayerId,
  terms: NpcFundingTerms,
): MarketLoanQuoteView | null {
  if (!Object.hasOwn(state.players, lender) || !validNpcFundingTerms(terms))
    return null;
  const schedule = calculatePlayerLoanSchedule(terms);
  const first = schedule[0];
  if (!first) throw new Error("Missing market loan schedule");
  const unavailableReason = state.activeTransaction
    ? "transaction-active"
    : !npcOfferAvailable(state, terms.borrowerId)
      ? "borrower-funded"
      : getAvailableCashCents(state, lender) < terms.principalCents
        ? "insufficient-cash"
        : null;
  return {
    borrowerName: terms.borrowerName,
    principalCents: terms.principalCents,
    annualRateBps: terms.annualRateBps,
    termQuarters: terms.termQuarters,
    firstDueQuarter: state.currentQuarter + 1,
    scheduledQuarterlyPaymentCents: first.paymentCents,
    onTimeTotalInterestCents: schedule.reduce(
      (total, row) => addCents(total, row.interestCents),
      cents(0),
    ),
    repaymentRisk: schedule.some(
      (row) => row.paymentCents > terms.quarterlyRepaymentCapacityCents,
    )
      ? "tight-budget"
      : "full-budget",
    canFund: unavailableReason === null,
    unavailableReason,
  };
}

/** Draft a matched advance from actual lender cash. The card lifecycle owns legality and settlement. */
export function draftFundNpcLoan(
  state: GameState,
  lender: PlayerId,
  terms: NpcFundingTerms,
): ActionResult {
  const reject = (
    code: Extract<ActionResult, { ok: false }>["code"],
  ): ActionResult => ({ ok: false, state, code, journalEntries: [] });
  if (!Object.hasOwn(state.players, lender)) return reject("UNKNOWN_PLAYER");
  const quote = quoteNpcFunding(state, lender, terms);
  if (!quote) return reject("UNSUPPORTED_TERMS");
  if (quote.unavailableReason === "transaction-active")
    return reject("ACTIVE_TRANSACTION");
  if (quote.unavailableReason === "borrower-funded")
    return reject("NPC_BORROWER_UNAVAILABLE");
  if (quote.unavailableReason === "insufficient-cash")
    return reject("INSUFFICIENT_AVAILABLE_CASH");
  if (state.counters.transaction >= Number.MAX_SAFE_INTEGER)
    return reject("TRANSACTION_ID_EXHAUSTED");
  if (state.counters.loan >= Number.MAX_SAFE_INTEGER)
    return reject("LOAN_ID_EXHAUSTED");
  if (state.counters.journal >= Number.MAX_SAFE_INTEGER)
    return reject("JOURNAL_ID_EXHAUSTED");
  const deal = nextDeterministicId("transaction", state.counters);
  const generated = nextDeterministicId("loan", deal.counters);
  const principal = cents(terms.principalCents);
  const posted = postCash(state.finance, generated.counters, {
    source: playerCashAccount(lender),
    destination: externalCashAccount("npc-borrower"),
    amountCents: principal,
    reason: "npc-loan-advance",
    quarter: state.currentQuarter,
    relatedLoanId: generated.id,
    relatedTransactionId: deal.id,
  });
  if (!posted.ok)
    return reject(
      posted.code === "INSUFFICIENT_FUNDS" ? posted.code : "INVALID_ACTION",
    );
  const loan: NpcLoan = {
    id: generated.id,
    kind: "npc-loan",
    borrowerId: terms.borrowerId,
    borrowerName: terms.borrowerName,
    lenderPlayerId: lender,
    originalPrincipalCents: principal,
    outstandingPrincipalCents: principal,
    annualRateBps: basisPoints(terms.annualRateBps),
    termQuarters: terms.termQuarters,
    originatedQuarter: state.currentQuarter,
    installmentsProcessed: 0,
    fundedTransactionId: deal.id,
    quarterlyRepaymentCapacityCents: cents(
      terms.quarterlyRepaymentCapacityCents,
    ),
    principalRepaidCents: cents(0),
    pastDuePrincipalCents: cents(0),
    unpaidInterestCents: cents(0),
    lastProcessedQuarter: 0,
    interestReceipts: [],
  };
  return {
    ok: true,
    state: {
      ...state,
      counters: posted.counters,
      finance: {
        ...posted.finance,
        loansById: { ...posted.finance.loansById, [loan.id]: loan },
      },
    },
    journalEntries: [posted.entry],
  };
}
