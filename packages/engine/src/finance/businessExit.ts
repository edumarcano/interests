import { TRANSACTION_FEES_BPS } from "@interests/rules";
import type {
  AssetId,
  LoanId,
  PlayerId,
  TransactionId,
} from "@interests/shared";
import type { ActionErrorCode } from "../game/actions";
import { advanceSpotlight, getActiveSpotlightPlayerId } from "../game/round";
import type { BusinessAsset, GameState, Loan } from "../model/gameState";
import {
  businessCashAccount,
  externalCashAccount,
  playerCashAccount,
} from "./account";
import { bankPayoff, roundedRatio } from "./bank";
import { calculateBusinessEquity } from "./business";
import { FinanceDecimal } from "./decimal";
import type { JournalEntry } from "./journal";
import { type Cents, cents, isNonNegativeCents } from "./money";
import { allocateProportionalCents } from "./ownership";
import { type CashPostingRequest, postCash } from "./posting";
import { allocateStakeSliceCents, disposeStakeBasis } from "./stakeBasis";

/** Trusted matching output, later supplied by a persisted recurring opportunity. Never wire terms. */
export interface MatchedIndependentBusinessBuyer {
  readonly kind: "matched-independent-business-buyer";
  readonly quoteId: string;
  readonly buyerId: string;
  readonly assetId: AssetId;
  readonly quarter: number;
  readonly operatingEnterpriseBidCents: number;
  readonly retainedCompanyCashCents: number;
  readonly sellerOwnershipByPlayerPpm: BusinessAsset["ownershipByPlayerPpm"];
}
export interface BusinessExitQuote {
  readonly grossConsiderationCents: Cents;
  readonly saleFeeCents: Cents;
  readonly bankPayoffs: readonly {
    readonly loanId: LoanId;
    readonly principalCents: Cents;
    readonly interestCents: Cents;
    readonly totalCents: Cents;
  }[];
  readonly bankPayoffCents: Cents;
  readonly bankInterestPaidCents: Cents;
  readonly operatingArrearsPaidCents: Cents;
  readonly workArrearsPaidCents: Cents;
  readonly netOwnerProceedsCents: Cents;
  readonly proceedsByPlayer: Readonly<Record<PlayerId, Cents>>;
}
type ExitError =
  | "INVALID_MATCHED_BUYER"
  | "UNKNOWN_BUSINESS"
  | "UNSCHEDULED_BUSINESS_DEBT"
  | "INSUFFICIENT_PAYOFF"
  | "QUOTE_CHANGED"
  | "OWNER_CONSENT_REQUIRED"
  | "WRONG_PHASE"
  | "NOT_ACTIVE_SPOTLIGHT"
  | "UNRELEASED_RESERVATIONS"
  | "COUNTER_EXHAUSTED"
  | "DESTINATION_OVERFLOW";
export type BusinessExitQuoteResult =
  | { readonly ok: true; readonly quote: BusinessExitQuote }
  | { readonly ok: false; readonly code: ExitError };
export type BusinessExitDraftResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly journalEntries: readonly JournalEntry[];
    }
  | {
      readonly ok: false;
      readonly code: ExitError;
      readonly state: GameState;
      readonly journalEntries: readonly [];
    };

function linkedDebt(loan: Loan, id: AssetId) {
  return (
    (loan.kind === "company-loan" ||
      (loan.kind === "asset-bank-loan" &&
        loan.purpose === "business-acquisition")) &&
    loan.borrowerAssetId === id
  );
}

/** No buyer generation or displayed-EV sale route: matching owns bid amount and buyer eligibility. */
export function quoteMatchedBusinessExit(
  state: GameState,
  match: MatchedIndependentBusinessBuyer,
): BusinessExitQuoteResult {
  const asset = state.finance.assetsById[match.assetId];
  if (asset?.kind !== "business" || asset.npcSale)
    return { ok: false, code: "UNKNOWN_BUSINESS" };
  if (
    match.kind !== "matched-independent-business-buyer" ||
    typeof match.quoteId !== "string" ||
    !match.quoteId.trim() ||
    typeof match.buyerId !== "string" ||
    !match.buyerId.trim() ||
    state.playerOrder.some((id) => id === match.buyerId) ||
    match.quarter !== state.currentQuarter ||
    !isNonNegativeCents(match.operatingEnterpriseBidCents) ||
    !match.operatingEnterpriseBidCents ||
    match.retainedCompanyCashCents !== asset.cashCents ||
    !match.sellerOwnershipByPlayerPpm ||
    Object.keys(match.sellerOwnershipByPlayerPpm).length !==
      Object.keys(asset.ownershipByPlayerPpm).length ||
    Object.entries(asset.ownershipByPlayerPpm).some(
      ([id, units]) =>
        units !== match.sellerOwnershipByPlayerPpm[id as PlayerId],
    )
  )
    return { ok: false, code: "INVALID_MATCHED_BUYER" };
  if ((asset.debtPrincipalCents ?? 0) > 0)
    return { ok: false, code: "UNSCHEDULED_BUSINESS_DEBT" };
  try {
    const grossConsiderationCents = cents(
      match.operatingEnterpriseBidCents + asset.cashCents,
    );
    const saleFeeCents = cents(
      roundedRatio(grossConsiderationCents, TRANSACTION_FEES_BPS.business.sale),
    );
    const bankPayoffs = Object.values(state.finance.loansById)
      .filter((loan) => linkedDebt(loan, asset.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .flatMap((loan) =>
        loan.outstandingPrincipalCents || loan.unpaidInterestCents
          ? [{ loanId: loan.id, ...bankPayoff(state, loan) }]
          : [],
      );
    const bankPayoffCents = bankPayoffs.reduce(
      (sum, claim) => cents(sum + claim.totalCents),
      cents(0),
    );
    const bankInterestPaidCents = bankPayoffs.reduce(
      (sum, claim) => cents(sum + claim.interestCents),
      cents(0),
    );
    const operatingArrearsPaidCents = asset.operatingArrearsCents;
    const workArrearsPaidCents =
      asset.workCompensation?.arrearsCents ?? cents(0);
    const netOwnerProceedsCents = cents(
      new FinanceDecimal(grossConsiderationCents)
        .minus(saleFeeCents)
        .minus(bankPayoffCents)
        .minus(operatingArrearsPaidCents)
        .minus(workArrearsPaidCents)
        .toNumber(),
    );
    if (netOwnerProceedsCents < 0)
      return { ok: false, code: "INSUFFICIENT_PAYOFF" };
    return {
      ok: true,
      quote: {
        grossConsiderationCents,
        saleFeeCents,
        bankPayoffs,
        bankPayoffCents,
        bankInterestPaidCents,
        operatingArrearsPaidCents,
        workArrearsPaidCents,
        netOwnerProceedsCents,
        proceedsByPlayer: allocateProportionalCents(
          netOwnerProceedsCents,
          asset.ownershipByPlayerPpm,
        ),
      },
    };
  } catch (error) {
    if (error instanceof RangeError)
      return { ok: false, code: "DESTINATION_OVERFLOW" };
    throw error;
  }
}

/** Compose with the trusted matched-opportunity close; discard this entire draft if any later step fails. */
export function draftMatchedBusinessExit(
  state: GameState,
  seller: PlayerId,
  transactionId: TransactionId,
  match: MatchedIndependentBusinessBuyer,
  expectedQuote: BusinessExitQuote,
  consent: "sole-owner" | "unanimous-owners" = "sole-owner",
): BusinessExitDraftResult {
  const reject = (code: ExitError): BusinessExitDraftResult => ({
    ok: false,
    code,
    state,
    journalEntries: [],
  });
  if (state.phase !== "ready-for-first-round") return reject("WRONG_PHASE");
  if (getActiveSpotlightPlayerId(state) !== seller)
    return reject("NOT_ACTIVE_SPOTLIGHT");
  if (state.activeTransaction !== null)
    return reject("UNRELEASED_RESERVATIONS");
  const asset = state.finance.assetsById[match.assetId];
  if (
    asset?.kind !== "business" ||
    !(asset.ownershipByPlayerPpm[seller] ?? 0) ||
    asset.npcSale
  )
    return reject("UNKNOWN_BUSINESS");
  if (
    Object.keys(asset.ownershipByPlayerPpm).length > 1 &&
    consent !== "unanimous-owners"
  )
    return reject("OWNER_CONSENT_REQUIRED");
  if (!/^transaction-[1-9]\d*$/.test(transactionId))
    return reject("INVALID_MATCHED_BUYER");
  const quoted = quoteMatchedBusinessExit(state, match);
  if (!quoted.ok) return reject(quoted.code);
  const quote = quoted.quote;
  if (JSON.stringify(quote) !== JSON.stringify(expectedQuote))
    return reject("QUOTE_CHANGED");
  let draft = state;
  const journalEntries: JournalEntry[] = [];
  try {
    const posting = (
      request: Omit<
        CashPostingRequest,
        "quarter" | "relatedAssetId" | "relatedTransactionId"
      >,
    ) => {
      if (!request.amountCents) return;
      const posted = postCash(draft.finance, draft.counters, {
        ...request,
        quarter: state.currentQuarter,
        relatedAssetId: asset.id,
        relatedTransactionId: transactionId,
      });
      if (!posted.ok) throw new RangeError("DESTINATION_OVERFLOW");
      draft = { ...draft, finance: posted.finance, counters: posted.counters };
      journalEntries.push(posted.entry);
    };
    posting({
      source: externalCashAccount("market"),
      destination: businessCashAccount(asset.id),
      amountCents: quote.grossConsiderationCents,
      reason: "npc-business-sale-consideration",
    });
    posting({
      source: businessCashAccount(asset.id),
      destination: externalCashAccount("market"),
      amountCents: quote.saleFeeCents,
      reason: "business-sale-fee",
    });
    for (const claim of quote.bankPayoffs) {
      posting({
        source: businessCashAccount(asset.id),
        destination: externalCashAccount("bank"),
        amountCents: claim.totalCents,
        reason: "business-bank-loan-payoff",
        relatedLoanId: claim.loanId,
        loanPayment: {
          principalCents: claim.principalCents,
          interestCents: claim.interestCents,
        },
      });
      const loan = draft.finance.loansById[claim.loanId]!;
      draft = {
        ...draft,
        finance: {
          ...draft.finance,
          loansById: {
            ...draft.finance.loansById,
            [loan.id]: {
              ...loan,
              outstandingPrincipalCents: cents(0),
              principalRepaidCents: loan.originalPrincipalCents,
              pastDuePrincipalCents: cents(0),
              unpaidInterestCents: cents(0),
              lastProcessedQuarter: state.currentQuarter,
              ...(loan.kind === "company-loan"
                ? { periodsProcessed: state.currentQuarter }
                : { interestPaidThroughQuarter: state.currentQuarter }),
            },
          },
        },
      };
    }
    posting({
      source: businessCashAccount(asset.id),
      destination: externalCashAccount("business-operating-costs"),
      amountCents: quote.operatingArrearsPaidCents,
      reason: "business-operating-arrears-payment",
    });
    if (asset.workCompensation)
      posting({
        source: businessCashAccount(asset.id),
        destination: playerCashAccount(asset.workCompensation.playerId),
        amountCents: quote.workArrearsPaidCents,
        reason: "business-work-compensation-arrears",
      });
    for (const owner of state.playerOrder)
      if (asset.ownershipByPlayerPpm[owner])
        posting({
          source: businessCashAccount(asset.id),
          destination: playerCashAccount(owner),
          amountCents: quote.proceedsByPlayer[owner]!,
          reason: "npc-business-sale-proceeds",
        });
    const fullEquity = calculateBusinessEquity(
      asset,
      state.finance.loansById,
    ).equityValueCents;
    const references = allocateProportionalCents(
      cents(Math.abs(fullEquity)),
      asset.ownershipByPlayerPpm,
    );
    const gross = allocateProportionalCents(
      quote.grossConsiderationCents,
      asset.ownershipByPlayerPpm,
    );
    const byPlayer = { ...state.progress.byPlayer };
    for (const owner of state.playerOrder) {
      const units = asset.ownershipByPlayerPpm[owner];
      if (!units) continue;
      const progress = byPlayer[owner]!,
        basis = progress.assetsById[asset.id];
      if (!basis) throw new Error("Missing business disposal basis");
      const slices = basis.slices ?? [
        {
          costCents: basis.costCents,
          ownershipPpm: basis.ownershipPpm,
          acquiredQuarter: basis.acquiredQuarter,
        },
      ];
      const disposal = disposeStakeBasis(
        slices,
        units,
        quote.proceedsByPlayer[owner]!,
      );
      const grossSlices = allocateStakeSliceCents(
        gross[owner]!,
        disposal.disposedSlices,
      );
      const refSlices = allocateStakeSliceCents(
        references[owner]!,
        disposal.disposedSlices,
      );
      const assetsById = { ...progress.assetsById };
      delete assetsById[asset.id];
      byPlayer[owner] = {
        ...progress,
        assetsById,
        realizedGainsCents: cents(
          new FinanceDecimal(progress.realizedGainsCents)
            .plus(quote.proceedsByPlayer[owner]!)
            .minus(disposal.removedCostCents)
            .toNumber(),
        ),
        disposals: [
          ...progress.disposals,
          ...disposal.disposedSlices.map((slice, index) => ({
            assetId: asset.id,
            category: "business" as const,
            counterpartyPlayerId: null,
            transactionId,
            acquiredQuarter: slice.acquiredQuarter,
            soldQuarter: state.currentQuarter,
            proceedsCents: slice.netProceedsCents,
            grossProceedsCents: grossSlices[index]!,
            costCents: slice.costCents,
            referenceEquityCents: cents(
              fullEquity < 0 ? -refSlices[index]! : refSlices[index]!,
            ),
          })),
        ],
        labor:
          progress.labor.kind === "owner-work" &&
          progress.labor.assetId === asset.id
            ? { kind: "not-working" }
            : progress.labor,
      };
    }
    const postedAsset = draft.finance.assetsById[asset.id] as BusinessAsset;
    if (postedAsset.cashCents !== match.retainedCompanyCashCents)
      throw new Error("NPC business cash identity failed");
    return {
      ok: true,
      journalEntries,
      state: {
        ...draft,
        progress: { byPlayer },
        finance: {
          ...draft.finance,
          assetsById: {
            ...draft.finance.assetsById,
            [asset.id]: {
              ...postedAsset,
              ownershipByPlayerPpm: {},
              operatingArrearsCents: cents(0),
              ...(postedAsset.workCompensation
                ? {
                    workCompensation: {
                      ...postedAsset.workCompensation,
                      arrearsCents: cents(0),
                    },
                  }
                : {}),
              npcSale: {
                quoteId: match.quoteId,
                buyerId: match.buyerId,
                quarter: state.currentQuarter,
                transactionId,
                operatingEnterpriseBidCents: cents(
                  match.operatingEnterpriseBidCents,
                ),
                retainedCompanyCashCents: cents(match.retainedCompanyCashCents),
                sellerOwnershipByPlayerPpm: { ...asset.ownershipByPlayerPpm },
                grossConsiderationCents: quote.grossConsiderationCents,
                saleFeeCents: quote.saleFeeCents,
                bankPayoffCents: quote.bankPayoffCents,
                bankInterestPaidCents: quote.bankInterestPaidCents,
                operatingArrearsPaidCents: quote.operatingArrearsPaidCents,
                workArrearsPaidCents: quote.workArrearsPaidCents,
                netOwnerProceedsCents: quote.netOwnerProceedsCents,
              },
            },
          },
        },
      },
    };
  } catch (error) {
    if (error instanceof RangeError)
      return reject(
        draft.counters.journal >= Number.MAX_SAFE_INTEGER
          ? "COUNTER_EXHAUSTED"
          : "DESTINATION_OVERFLOW",
      );
    throw error;
  }
}

/** Trusted atomic close for callers whose only remaining step is spotlight advancement. */
export function closeMatchedBusinessExitAndAdvanceSpotlight(
  ...args: Parameters<typeof draftMatchedBusinessExit>
):
  | BusinessExitDraftResult
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly journalEntries: readonly [];
      readonly code: ActionErrorCode;
    } {
  const draft = draftMatchedBusinessExit(...args);
  if (!draft.ok) return draft;
  const advanced = advanceSpotlight(draft.state, args[1]);
  if (!advanced.ok) return { ...advanced, state: args[0], journalEntries: [] };
  return {
    ...advanced,
    journalEntries: [...draft.journalEntries, ...advanced.journalEntries],
  };
}
