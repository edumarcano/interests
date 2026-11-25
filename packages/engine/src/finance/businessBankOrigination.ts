import type { AssetId, PlayerId, TransactionId } from "@interests/shared";
import { nextDeterministicId } from "../game/deterministicIds";
import type { AssetBankLoan, GameState } from "../model/gameState";
import { getAvailableCashCents } from "../transactions/reservations";
import { businessCashAccount, externalCashAccount } from "./account";
import { calculateAmortizingSchedule } from "./amortization";
import { quoteAssetBankLoan } from "./bank";
import { FinanceDecimal } from "./decimal";
import type { JournalEntry } from "./journal";
import { basisPoints, type Cents, cents, isNonNegativeCents } from "./money";
import { calculateLoanObligation } from "./obligations";
import { postCash } from "./posting";

/** Values come from one frozen, confirmed engine closing plan, never a wire payload. */
export interface BusinessAcquisitionBankTerms {
  readonly transactionId: TransactionId;
  readonly borrowerAssetId: AssetId;
  readonly leadPlayerId: PlayerId;
  readonly principalCents: number;
  /** Entire secondary consideration, excluding fees and reserve capital. */
  readonly acquisitionConsiderationCents: number;
  /** Seller consideration plus all company-paid closing fees/payoffs still to post. */
  readonly remainingCompanyClosingOutflowCents: number;
}
export type BusinessBankOriginationError =
  | "INVALID_TERMS"
  | "WRONG_PHASE"
  | "UNRELEASED_RESERVATIONS"
  | "UNKNOWN_PLAYER"
  | "UNKNOWN_BUSINESS"
  | "UNSCHEDULED_BUSINESS_DEBT"
  | "BORROWER_OVERDUE"
  | "BANK_UNDERWRITING_FAILED"
  | "PERSONAL_RESERVE_SHORTFALL"
  | "ASSET_RESERVE_SHORTFALL"
  | "EXCESS_BANK_FUNDING"
  | "COUNTER_EXHAUSTED"
  | "DESTINATION_OVERFLOW";
export interface BusinessAcquisitionBankQuote {
  readonly annualRateBps: number;
  readonly creditGrade: string;
  readonly principalCents: Cents;
  readonly termQuarters: number;
  readonly firstDueQuarter: number;
  readonly maturityQuarter: number;
  readonly scheduledQuarterlyPaymentCents: Cents;
  readonly personalReserveCents: Cents;
  readonly assetReserveCents: Cents;
  readonly closingCompanyCashCents: Cents;
  readonly existingQuarterlyDebtServiceCents: Cents;
  readonly qualifyingQuarterlyOperatingCashCents: Cents;
}
export type BusinessAcquisitionBankQuoteResult =
  | { readonly ok: true; readonly quote: BusinessAcquisitionBankQuote }
  | { readonly ok: false; readonly code: BusinessBankOriginationError };

/** Quote the same funded draft as origination without changing balances, counters or RNG. */
export function quoteBusinessAcquisitionBankLoan(
  fundedDraft: GameState,
  terms: BusinessAcquisitionBankTerms,
): BusinessAcquisitionBankQuoteResult {
  const reject = (
    code: BusinessBankOriginationError,
  ): BusinessAcquisitionBankQuoteResult => ({ ok: false, code });
  if (
    !Number.isSafeInteger(fundedDraft.currentQuarter) ||
    fundedDraft.currentQuarter < 1
  )
    return reject("INVALID_TERMS");
  if (fundedDraft.phase !== "ready-for-first-round")
    return reject("WRONG_PHASE");
  if (fundedDraft.activeTransaction !== null)
    return reject("UNRELEASED_RESERVATIONS");
  if (!fundedDraft.players[terms.leadPlayerId]) return reject("UNKNOWN_PLAYER");
  const asset = fundedDraft.finance.assetsById[terms.borrowerAssetId];
  if (asset?.kind !== "business") return reject("UNKNOWN_BUSINESS");
  if (
    !terms.transactionId ||
    typeof terms.transactionId !== "string" ||
    !isNonNegativeCents(terms.principalCents) ||
    !terms.principalCents ||
    !isNonNegativeCents(terms.acquisitionConsiderationCents) ||
    !terms.acquisitionConsiderationCents ||
    !isNonNegativeCents(terms.remainingCompanyClosingOutflowCents) ||
    terms.remainingCompanyClosingOutflowCents <
      terms.acquisitionConsiderationCents
  )
    return reject("INVALID_TERMS");
  if ((asset.debtPrincipalCents ?? 0) !== 0)
    return reject("UNSCHEDULED_BUSINESS_DEBT");
  if (
    asset.operatingArrearsCents > 0 ||
    (asset.workCompensation?.arrearsCents ?? 0) > 0
  )
    return reject("BORROWER_OVERDUE");
  try {
    let existingQuarterlyDebtServiceCents = cents(0);
    for (const loan of Object.values(fundedDraft.finance.loansById)) {
      if (
        !(
          (loan.kind === "company-loan" ||
            (loan.kind === "asset-bank-loan" &&
              loan.purpose === "business-acquisition")) &&
          loan.borrowerAssetId === asset.id
        )
      )
        continue;
      if (loan.pastDuePrincipalCents > 0 || loan.unpaidInterestCents > 0)
        return reject("BORROWER_OVERDUE");
      const dueQuarter = Math.max(
        fundedDraft.currentQuarter,
        loan.firstDueQuarter,
        loan.lastProcessedQuarter + 1,
      );
      existingQuarterlyDebtServiceCents = cents(
        existingQuarterlyDebtServiceCents +
          (calculateLoanObligation(loan, dueQuarter)?.amountDueCents ?? 0),
      );
    }
    // This field is already after necessary owner labor or replacement management cost.
    const quarterlyAfterLabor = cents(
      new FinanceDecimal(asset.annualOperatingProfitCents)
        .div(4)
        .round()
        .toNumber(),
    );
    const qualifyingQuarterlyOperatingCashCents = cents(
      quarterlyAfterLabor - existingQuarterlyDebtServiceCents,
    );
    if (qualifyingQuarterlyOperatingCashCents <= 0)
      return reject("BANK_UNDERWRITING_FAILED");
    const bank = quoteAssetBankLoan(fundedDraft, terms.leadPlayerId, {
      purpose: "business-acquisition",
      qualifyingValueCents: terms.acquisitionConsiderationCents,
      quarterlyOperatingIncomeCents: qualifyingQuarterlyOperatingCashCents,
      principalCents: terms.principalCents,
      rateKind: "fixed",
    });
    if (bank.overdue) return reject("BORROWER_OVERDUE");
    if (!bank.approved) return reject("BANK_UNDERWRITING_FAILED");
    const schedule = calculateAmortizingSchedule({
      principalCents: terms.principalCents,
      annualRateBps: bank.annualRateBps,
      termQuarters: bank.termQuarters,
    });
    const payment = schedule[0]?.paymentCents;
    if (payment === undefined) return reject("INVALID_TERMS");
    if (
      getAvailableCashCents(fundedDraft, terms.leadPlayerId) <
      bank.personalQuarterlyObligationsCents
    )
      return reject("PERSONAL_RESERVE_SHORTFALL");
    const fundedCash = cents(asset.cashCents + terms.principalCents);
    const closingCompanyCashCents = cents(
      fundedCash - terms.remainingCompanyClosingOutflowCents,
    );
    if (closingCompanyCashCents < payment)
      return reject("ASSET_RESERVE_SHORTFALL");
    // Borrow only the actual unfunded consideration/cost/reserve gap, not spare cash.
    if (closingCompanyCashCents > payment) return reject("EXCESS_BANK_FUNDING");
    const maturityQuarter = bank.firstDueQuarter + bank.termQuarters - 1;
    if (!Number.isSafeInteger(maturityQuarter)) return reject("INVALID_TERMS");
    if (
      !Number.isSafeInteger(fundedDraft.counters.loan) ||
      fundedDraft.counters.loan < 0 ||
      !Number.isSafeInteger(fundedDraft.counters.journal) ||
      fundedDraft.counters.journal < 0 ||
      fundedDraft.counters.loan >= Number.MAX_SAFE_INTEGER ||
      fundedDraft.counters.journal >= Number.MAX_SAFE_INTEGER
    )
      return reject("COUNTER_EXHAUSTED");
    if (
      fundedDraft.finance.loansById[
        nextDeterministicId("loan", fundedDraft.counters).id
      ]
    )
      return reject("COUNTER_EXHAUSTED");
    return {
      ok: true,
      quote: {
        annualRateBps: bank.annualRateBps,
        creditGrade: bank.grade,
        principalCents: cents(terms.principalCents),
        termQuarters: bank.termQuarters,
        firstDueQuarter: bank.firstDueQuarter,
        maturityQuarter,
        scheduledQuarterlyPaymentCents: payment,
        personalReserveCents: bank.personalQuarterlyObligationsCents,
        assetReserveCents: payment,
        closingCompanyCashCents,
        existingQuarterlyDebtServiceCents,
        qualifyingQuarterlyOperatingCashCents,
      },
    };
  } catch (error) {
    if (error instanceof RangeError) return reject("DESTINATION_OVERFLOW");
    throw error;
  }
}

export type DraftBusinessAcquisitionBankLoanResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly loan: AssetBankLoan;
      readonly quote: BusinessAcquisitionBankQuote;
      readonly journalEntries: readonly [JournalEntry];
    }
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly code: BusinessBankOriginationError;
      readonly journalEntries: readonly [];
    };

/**
 * Internal closing primitive, intentionally absent from player commands and the package root API.
 *
 * The caller freezes seller consideration, fees/payoffs, contributions and acceptances at one
 * terms revision. In an uncommitted clone it then posts confirmed buyer/partner funding to the
 * company, releases spent reservations and leaves ownership unchanged. Quote and originate on
 * that SAME funded clone. The cash equation is non-bank funded company cash + bank principal
 * = seller consideration + remaining fees/payoffs + one quarter of new debt service. Existing
 * canonical debt still counts as required service until a payoff has actually been drafted.
 * Annual operating profit already excludes necessary labor; existing
 * asset service is subtracted once. Bank principal is a liability, never another equity pledge.
 *
 * After success, use company cash to pay each frozen counterparty and fee exactly once, leaving
 * quote.assetReserveCents. Secondary consideration goes to the seller; reserve capital stays
 * with the company. Apply ownership/basis, validate, advance the spotlight and commit all journals
 * together. On ANY later failure discard the entire clone, including contributions and this loan.
 * This helper does not close a transaction, move ownership, increment revision, consume RNG, or
 * authorize funding. Never persist its intermediate funded state independently of the close.
 */
export function draftBusinessAcquisitionBankLoan(
  fundedDraft: GameState,
  terms: BusinessAcquisitionBankTerms,
): DraftBusinessAcquisitionBankLoanResult {
  const reject = (
    code: BusinessBankOriginationError,
  ): DraftBusinessAcquisitionBankLoanResult => ({
    ok: false,
    state: fundedDraft,
    code,
    journalEntries: [],
  });
  const quoted = quoteBusinessAcquisitionBankLoan(fundedDraft, terms);
  if (!quoted.ok) return reject(quoted.code);
  const quote = quoted.quote;
  const { id, counters } = nextDeterministicId("loan", fundedDraft.counters);
  const loan: AssetBankLoan = {
    id,
    kind: "asset-bank-loan",
    borrowerAssetId: terms.borrowerAssetId,
    leadPlayerId: terms.leadPlayerId,
    purpose: "business-acquisition",
    originalPrincipalCents: quote.principalCents,
    outstandingPrincipalCents: quote.principalCents,
    annualRateBps: basisPoints(quote.annualRateBps),
    pricing: { kind: "fixed" },
    scheduledQuarterlyPaymentCents: quote.scheduledQuarterlyPaymentCents,
    firstDueQuarter: quote.firstDueQuarter,
    maturityQuarter: quote.maturityQuarter,
    termQuarters: quote.termQuarters,
    periodsProcessed: 0,
    interestPaidThroughQuarter: fundedDraft.currentQuarter,
    paymentResetQuarter: quote.firstDueQuarter,
    paymentBasisPrincipalCents: quote.principalCents,
    principalRepaidCents: cents(0),
    pastDuePrincipalCents: cents(0),
    unpaidInterestCents: cents(0),
    lastProcessedQuarter: 0,
  };
  const posted = postCash(fundedDraft.finance, counters, {
    source: externalCashAccount("bank"),
    destination: businessCashAccount(terms.borrowerAssetId),
    amountCents: quote.principalCents,
    quarter: fundedDraft.currentQuarter,
    reason: "asset-bank-loan-origination",
    relatedAssetId: terms.borrowerAssetId,
    relatedLoanId: id,
    relatedTransactionId: terms.transactionId,
  });
  if (!posted.ok) return reject("DESTINATION_OVERFLOW");
  return {
    ok: true,
    state: {
      ...fundedDraft,
      finance: {
        ...posted.finance,
        loansById: { ...posted.finance.loansById, [id]: loan },
      },
      counters: posted.counters,
    },
    loan,
    quote,
    journalEntries: [posted.entry],
  };
}
