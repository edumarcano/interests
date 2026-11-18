import {
  calculateCashYieldBps,
  OPERATING_RULES,
  OBJECTIVE_MEASUREMENT_RULES,
  PUBLIC_MARKET_INSTRUMENT_IDS,
  PUBLIC_MARKET_INSTRUMENTS,
} from "@interests/rules";
import type {
  AssetId,
  LoanId,
  PlayerId,
  SettlementId,
} from "@interests/shared";
import { nextDeterministicId } from "../game/deterministicIds";
import { assertGameState } from "../invariants/assertGameState";
import type {
  GameState,
  Loan,
  PublicMarketPortfolio,
} from "../model/gameState";
import { generateRecurringContent } from "../opportunities/recurring";
import {
  type CashAccount,
  externalCashAccount,
  playerCashAccount,
} from "./account";
import { allocateWeightedCents } from "./allocation";
import { isAssetBorrower, resetVariableAssetLoan, roundedRatio } from "./bank";
import {
  BusinessCashOverflowError,
  type BusinessSettlementOutcome,
  captureBusinessBasis,
  planBusinessSettlement,
} from "./businessSettlement";
import { FinanceDecimal } from "./decimal";
import { generateQuarterMarketUpdate } from "./economy";
import type { JournalEntry } from "./journal";
import { isPersonalBorrower } from "./loanParties";
import {
  calculateQuarterlyYieldCents,
  revaluePublicMarketPortfolio,
} from "./markets";
import { basisPoints, type Cents, cents } from "./money";
import {
  applyLoanPaymentAllocation,
  calculateLoanObligation,
  type LivingPaymentOutcome,
  type LoanObligation,
  type LoanPaymentOutcome,
  type SettlementOutcome,
} from "./obligations";
import { planQuarterOperatingUpdate } from "./operatingEconomy";
import { allocateProportionalCents } from "./ownership";
import { type CashPostingRequest, postCash } from "./posting";
import {
  capturePropertyBasis,
  captureRecurringBasis,
  recordQuarterObservations,
} from "./progress";
import { calculatePropertyCashFlow } from "./property";
import { planPropertySettlement } from "./propertySettlement";

export interface SettleQuarterRequest {
  readonly quarter: number;
}
export type SettleQuarterErrorCode =
  | "WRONG_PHASE"
  | "ACTIVE_TRANSACTION"
  | "INVALID_QUARTER"
  | "QUARTER_ALREADY_SETTLED"
  | "WRONG_QUARTER"
  | "DESTINATION_OVERFLOW"
  | "INSUFFICIENT_FUNDS"
  | "MARKET_VALUE_OVERFLOW"
  | "OBLIGATION_OVERFLOW"
  | "JOURNAL_ID_EXHAUSTED"
  | "SETTLEMENT_ID_EXHAUSTED"
  | "OPPORTUNITY_ID_EXHAUSTED";
export type SettleQuarterResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly settlementId: SettlementId;
      readonly settlementOutcome: SettlementOutcome;
      readonly journalEntries: readonly JournalEntry[];
    }
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly code: SettleQuarterErrorCode;
      readonly journalEntries: readonly [];
    };

function required<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error("Missing authoritative finance record");
  return value;
}

class SettlementPlanningError extends Error {
  constructor(readonly code: SettleQuarterErrorCode) {
    super(code);
  }
}

/** Plan the entire quarter before applying cash, claims, IDs, or RNG. */
export function applyQuarterSettlement(
  state: GameState,
  request: SettleQuarterRequest,
): SettleQuarterResult {
  const reject = (code: SettleQuarterErrorCode): SettleQuarterResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });
  if (state.phase !== "ready-for-first-round") return reject("WRONG_PHASE");
  if (state.activeTransaction !== null) return reject("ACTIVE_TRANSACTION");
  const quarter = request.quarter;
  if (!Number.isSafeInteger(quarter) || quarter <= 0)
    return reject("INVALID_QUARTER");
  if (quarter <= state.lastSettledQuarter)
    return reject("QUARTER_ALREADY_SETTLED");
  if (quarter !== state.currentQuarter) return reject("WRONG_QUARTER");

  if (state.currentQuarter >= Number.MAX_SAFE_INTEGER)
    throw new RangeError(
      "currentQuarter has reached the maximum safe integer limit",
    );
  try {
    const playerIds = [...state.playerOrder].sort();
    const postings: CashPostingRequest[] = [];
    const balances: Record<PlayerId, Cents> = { ...state.finance.cashByPlayer };
    const businessBalances: Record<AssetId, Cents> = {};
    for (const asset of Object.values(state.finance.assetsById))
      if (asset.kind === "business" || asset.kind === "property")
        businessBalances[asset.id] = asset.cashCents ?? cents(0);
    const balanceOf = (account: CashAccount): Cents =>
      account.kind === "player"
        ? required(balances[account.playerId])
        : account.kind === "business" || account.kind === "property"
          ? required(businessBalances[account.assetId])
          : cents(0);
    const writeBalance = (account: CashAccount, amount: Cents) => {
      if (account.kind === "player") balances[account.playerId] = amount;
      else if (account.kind === "business" || account.kind === "property")
        businessBalances[account.assetId] = amount;
    };
    const planPosting = (request: CashPostingRequest) => {
      if (request.amountCents === 0) return;
      if (request.source.kind !== "external") {
        const next = cents(balanceOf(request.source) - request.amountCents);
        if (next < 0) throw new SettlementPlanningError("INSUFFICIENT_FUNDS");
        writeBalance(request.source, next);
      }
      if (request.destination.kind !== "external") {
        const previous = balanceOf(request.destination);
        if (request.amountCents > Number.MAX_SAFE_INTEGER - previous)
          throw new SettlementPlanningError("DESTINATION_OVERFLOW");
        writeBalance(
          request.destination,
          cents(previous + request.amountCents),
        );
      }
      postings.push(request);
    };
    const inflow = (
      playerId: PlayerId,
      amountCents: number,
      reason: string,
      account:
        | "bank"
        | "market"
        | "personal-earned-income"
        | "property-operating-cashflow",
      related: Partial<CashPostingRequest> = {},
    ) =>
      planPosting({
        source: externalCashAccount(account),
        destination: playerCashAccount(playerId),
        amountCents,
        reason,
        quarter,
        ...related,
      });

    for (const playerId of playerIds) {
      inflow(
        playerId,
        calculateQuarterlyYieldCents({
          principalCents: required(
            state.finance.quarterStartBasis.cashByPlayer[playerId],
          ),
          annualYieldBps: calculateCashYieldBps(state.economy.baseRateBps),
        }),
        "cash-yield",
        "bank",
      );
    }
    for (const instrumentId of PUBLIC_MARKET_INSTRUMENT_IDS) {
      for (const playerId of playerIds) {
        inflow(
          playerId,
          calculateQuarterlyYieldCents({
            principalCents: required(
              state.finance.quarterStartBasis.publicMarketsByPlayer[playerId],
            )[instrumentId],
            annualYieldBps:
              PUBLIC_MARKET_INSTRUMENTS[instrumentId].annualDividendYieldBps,
          }),
          "public-market-dividend",
          "market",
          { relatedMarketInstrumentId: instrumentId },
        );
      }
    }
    for (const playerId of playerIds) {
      inflow(
        playerId,
        required(state.finance.quarterStartBasis.recurringByPlayer[playerId])
          .quarterlyIncomeCents,
        "recurring-personal-income",
        "personal-earned-income",
      );
    }
    const loansById: Record<LoanId, Loan> = { ...state.finance.loansById };
    const loanPayments: LoanPaymentOutcome[] = [];
    for (const assetId of (
      Object.keys(state.finance.quarterStartBasis.propertiesById) as AssetId[]
    ).sort()) {
      const asset = state.finance.quarterStartBasis.propertiesById[assetId];
      if (!asset || asset.kind !== "property") continue;
      const current = state.finance.assetsById[assetId];
      if (current?.kind === "property" && current.cashCents !== undefined) {
        const plan = planPropertySettlement(current, asset, quarter, loansById);
        for (const posting of plan.postings) planPosting(posting);
        Object.assign(loansById, plan.loansById);
        loanPayments.push(...plan.loanPayments);
        continue;
      }
      const allocations = allocateProportionalCents(
        calculatePropertyCashFlow(asset).netOperatingIncomeCents,
        asset.ownershipByPlayerPpm,
      );
      for (const playerId of (Object.keys(allocations) as PlayerId[]).sort()) {
        inflow(
          playerId,
          required(allocations[playerId]),
          "property-operating-distribution",
          "property-operating-cashflow",
          { relatedAssetId: asset.id },
        );
      }
    }

    const businesses: BusinessSettlementOutcome[] = [];
    for (const assetId of (
      Object.keys(state.finance.quarterStartBasis.businessesById) as AssetId[]
    ).sort()) {
      const asset = state.finance.assetsById[assetId];
      if (!asset || asset.kind !== "business")
        throw new Error("Missing business entitlement asset");
      const plan = planBusinessSettlement(
        asset,
        required(state.finance.quarterStartBasis.businessesById[assetId]),
        quarter,
        loansById,
      );
      if (!plan) continue;
      for (const posting of plan.postings) planPosting(posting);
      businesses.push(plan.outcome);
      Object.assign(loansById, plan.loansById);
      loanPayments.push(...plan.loanPayments);
    }

    const livingByPlayer = {} as Record<PlayerId, LivingPaymentOutcome>;
    const livingArrearsByPlayer = {} as Record<PlayerId, Cents>;
    for (const playerId of playerIds) {
      const currentDue = required(
        state.finance.quarterStartBasis.recurringByPlayer[playerId],
      ).quarterlyLivingExpenseCents;
      const oldDue = required(state.finance.livingArrearsByPlayer[playerId]);
      cents(currentDue + oldDue);
      const currentPaid = cents(
        Math.min(required(balances[playerId]), currentDue),
      );
      planPosting({
        source: playerCashAccount(playerId),
        destination: externalCashAccount("living-expense-sink"),
        amountCents: currentPaid,
        reason: "recurring-living-expense",
        quarter,
      });
      const oldPaid = cents(Math.min(required(balances[playerId]), oldDue));
      planPosting({
        source: playerCashAccount(playerId),
        destination: externalCashAccount("living-expense-sink"),
        amountCents: oldPaid,
        reason: "living-expense-arrears-payment",
        quarter,
      });
      const closingArrearsCents = cents(
        cents(oldDue - oldPaid) + cents(currentDue - currentPaid),
      );
      livingArrearsByPlayer[playerId] = closingArrearsCents;
      livingByPlayer[playerId] = {
        currentDueCents: currentDue,
        arrearsDueCents: oldDue,
        currentPaidCents: currentPaid,
        arrearsPaidCents: oldPaid,
        closingArrearsCents,
      };
    }

    const loanIds = (Object.keys(state.finance.loansById) as LoanId[]).sort();
    const obligations = {} as Record<LoanId, LoanObligation>;
    for (const loanId of loanIds) {
      const loan = state.finance.loansById[loanId];
      if (!loan || isAssetBorrower(loan)) continue;
      const obligation = calculateLoanObligation(loan, quarter);
      if (obligation) obligations[loanId] = obligation;
    }
    const allocated = {} as Record<LoanId, Cents>;
    // All borrower budgets are fixed before any loan receipt is planned.
    for (const playerId of playerIds) {
      const weights = {} as Record<LoanId, number>;
      let totalDue = new FinanceDecimal(0);
      for (const loanId of loanIds) {
        const due = obligations[loanId];
        const candidate = state.finance.loansById[loanId];
        if (
          due &&
          candidate &&
          isPersonalBorrower(candidate) &&
          candidate.borrowerPlayerId === playerId
        ) {
          weights[loanId] = due.amountDueCents;
          totalDue = totalDue.plus(due.amountDueCents);
        }
      }
      const payable = totalDue.greaterThan(required(balances[playerId]))
        ? required(balances[playerId])
        : cents(totalDue.toNumber());
      Object.assign(allocated, allocateWeightedCents(payable, weights));
    }
    for (const loanId of loanIds) {
      const due = obligations[loanId];
      const loan = loansById[loanId];
      if (!due || !loan || !isPersonalBorrower(loan)) continue;
      const applied = applyLoanPaymentAllocation(
        loan,
        due,
        required(allocated[loanId]),
        quarter,
      );
      loansById[loanId] = applied.loan;
      loanPayments.push(applied.outcome);
      planPosting({
        source: playerCashAccount(loan.borrowerPlayerId),
        destination:
          loan.kind === "player-loan"
            ? playerCashAccount(loan.lenderPlayerId)
            : externalCashAccount("bank"),
        amountCents: applied.outcome.paidCents,
        reason:
          loan.kind === "player-loan"
            ? "loan-payment"
            : loan.purpose === "property-mortgage"
              ? "legacy-mortgage-payment"
              : "legacy-personal-debt-payment",
        quarter,
        relatedLoanId: loanId,
        ...(loan.kind === "legacy-bank-loan" && loan.relatedAssetId
          ? { relatedAssetId: loan.relatedAssetId }
          : {}),
        loanPayment: {
          principalCents: applied.outcome.principalPaidCents,
          interestCents: applied.outcome.interestPaidCents,
        },
      });
    }
    // Market borrower receipts are posted only after personal budgets are fixed.
    for (const loanId of loanIds) {
      const loan = loansById[loanId];
      const due = obligations[loanId];
      if (loan?.kind !== "npc-loan" || !due) continue;
      const applied = applyLoanPaymentAllocation(
        loan,
        due,
        cents(
          Math.min(due.amountDueCents, loan.quarterlyRepaymentCapacityCents),
        ),
        quarter,
      );
      loansById[loanId] = applied.loan;
      loanPayments.push(applied.outcome);
      planPosting({
        source: externalCashAccount("npc-borrower"),
        destination: playerCashAccount(loan.lenderPlayerId),
        amountCents: applied.outcome.paidCents,
        reason: "npc-loan-payment",
        quarter,
        relatedLoanId: loanId,
        relatedTransactionId: loan.fundedTransactionId,
        loanPayment: {
          principalCents: applied.outcome.principalPaidCents,
          interestCents: applied.outcome.interestPaidCents,
        },
      });
    }
    if (state.counters.settlement >= Number.MAX_SAFE_INTEGER)
      return reject("SETTLEMENT_ID_EXHAUSTED");
    if (postings.length > Number.MAX_SAFE_INTEGER - state.counters.journal)
      return reject("JOURNAL_ID_EXHAUSTED");

    const marketUpdate = generateQuarterMarketUpdate({
      regime: state.economy.currentRegime,
      random: state.random,
    });
    const revaluedMarketsByPlayer = {} as Record<
      PlayerId,
      PublicMarketPortfolio
    >;
    try {
      for (const playerId of playerIds)
        revaluedMarketsByPlayer[playerId] = revaluePublicMarketPortfolio(
          required(state.finance.publicMarketsByPlayer[playerId]),
          marketUpdate.returnBpsByInstrument,
        );
    } catch {
      return reject("MARKET_VALUE_OVERFLOW");
    }

    const { id: settlementId, counters } = nextDeterministicId(
      "settlement",
      state.counters,
    );
    const settlementOutcome: SettlementOutcome = {
      businesses,
      settlementId,
      quarter,
      livingByPlayer,
      loanPayments,
    };
    let finance = state.finance;
    let currentCounters = counters;
    const journalEntries: JournalEntry[] = [];
    for (const posting of postings) {
      const result = postCash(finance, currentCounters, posting);
      if (!result.ok)
        throw new Error(
          `Preflighted settlement posting failed: ${result.code}`,
        );
      finance = result.finance;
      currentCounters = result.counters;
      journalEntries.push(result.entry);
    }
    let assetsById = finance.assetsById;
    for (const business of businesses) {
      const asset = assetsById[business.assetId];
      if (
        !asset ||
        asset.kind !== "business" ||
        asset.cashCents !== business.closingCashCents
      )
        throw new Error("Business cash postings do not reconcile");
      assetsById = {
        ...assetsById,
        [asset.id]: {
          ...asset,
          operatingArrearsCents: business.closingOperatingArrearsCents,
          ...(asset.workCompensation && business.workCompensation
            ? {
                workCompensation: {
                  ...asset.workCompensation,
                  arrearsCents: business.workCompensation.closingArrearsCents,
                },
              }
            : {}),
        },
      };
    }
    for (const loan of Object.values(loansById))
      if (loan.kind === "asset-bank-loan")
        loansById[loan.id] = resetVariableAssetLoan(
          loan,
          state.economy.baseRateBps,
          quarter + 1,
        );
    for (const asset of Object.values(assetsById)) {
      if (
        asset.kind !== "property" ||
        !asset.renovationPending ||
        asset.renovationPending.effectiveQuarter !== quarter + 1
      )
        continue;
      const { renovationPending, ...property } = asset;
      assetsById = {
        ...assetsById,
        [asset.id]: {
          ...property,
          marketValueCents: cents(
            asset.marketValueCents +
              roundedRatio(
                renovationPending.costCents,
                OPERATING_RULES.renovationValuePerCostBps,
              ),
          ),
          scheduledQuarterlyRentCents: cents(
            asset.scheduledQuarterlyRentCents +
              roundedRatio(
                asset.scheduledQuarterlyRentCents,
                OPERATING_RULES.renovationRentIncreaseBps,
              ),
          ),
          occupancyBps: basisPoints(
            Math.min(
              10_000,
              asset.occupancyBps +
                OPERATING_RULES.renovationOccupancyIncreaseBps,
            ),
          ),
        },
      };
    }
    for (const asset of Object.values(assetsById)) {
      if (
        asset.kind !== "business" ||
        asset.pendingAnnualProfitIncreaseCents === undefined
      )
        continue;
      const { pendingAnnualProfitIncreaseCents, ...business } = asset;
      assetsById = {
        ...assetsById,
        [business.id]: {
          ...business,
          annualOperatingProfitCents: cents(
            business.annualOperatingProfitCents +
              pendingAnnualProfitIncreaseCents,
          ),
        },
      };
    }
    const operating = planQuarterOperatingUpdate(
      state,
      assetsById,
      marketUpdate.nextRegime,
      businesses,
    );
    assetsById = operating.assetsById;
    const nextRecurring = operating.recurringByPlayer;
    const operatingState: GameState = {
      ...state,
      progress: recordQuarterObservations(
        state,
        settlementOutcome,
        journalEntries,
      ),
      currentQuarter: quarter + 1,
      lastSettledQuarter: quarter,
      finance: {
        ...finance,
        loansById,
        assetsById,
        recurringByPlayer: nextRecurring,
        livingArrearsByPlayer,
        lastSettlement: settlementOutcome,
        publicMarketsByPlayer: revaluedMarketsByPlayer,
        quarterStartBasis: {
          businessesById: captureBusinessBasis(assetsById),
          propertiesById: capturePropertyBasis(assetsById),
          recurringByPlayer: captureRecurringBasis(nextRecurring),
          quarter: quarter + 1,
          cashByPlayer: { ...finance.cashByPlayer },
          publicMarketsByPlayer: { ...revaluedMarketsByPlayer },
        },
      },
      economy: {
        currentRegime: marketUpdate.nextRegime,
        baseRateBps: basisPoints(operating.nextBaseRateBps),
        operatingRandom: operating.nextOperatingRandom,
        lastMarketUpdate: {
          quarter,
          regimeUsed: marketUpdate.regimeUsed,
          returnBpsByInstrument: marketUpdate.returnBpsByInstrument,
        },
      },
      random: marketUpdate.nextRandom,
      counters: currentCounters,
      round: state.round
        ? { stage: "round-start", spotlightsCompleted: 0 }
        : null,
    };
    if (
      operatingState.content.scenario === "standard-v1" &&
      operatingState.currentQuarter <=
        OBJECTIVE_MEASUREMENT_RULES.safetyDrawQuarter &&
      operatingState.counters.opportunity >
        Number.MAX_SAFE_INTEGER - operatingState.playerOrder.length
    )
      throw new SettlementPlanningError("OPPORTUNITY_ID_EXHAUSTED");
    const nextState = generateRecurringContent(operatingState);
    assertGameState(nextState);
    return {
      ok: true,
      state: nextState,
      settlementId,
      settlementOutcome,
      journalEntries,
    };
  } catch (error) {
    if (error instanceof SettlementPlanningError) return reject(error.code);
    if (error instanceof BusinessCashOverflowError)
      return reject("DESTINATION_OVERFLOW");
    if (error instanceof RangeError) return reject("OBLIGATION_OVERFLOW");
    throw error;
  }
}

/** Trusted finance entry point; player commands use the round controller. */
export function settleQuarter(
  state: GameState,
  request: SettleQuarterRequest,
): SettleQuarterResult {
  const result = applyQuarterSettlement(state, request);
  if (!result.ok) return result;
  const nextState = { ...result.state, revision: state.revision + 1 };
  assertGameState(nextState);
  return { ...result, state: nextState };
}
