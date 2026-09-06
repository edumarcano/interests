import {
  PUBLIC_MARKET_INSTRUMENT_IDS,
  PUBLIC_MARKET_INSTRUMENTS,
  type PublicMarketInstrumentId,
  STANDARD_V1_OPENING_CASH_YIELD_BPS,
} from "@finance-game/rules";
import type {
  AssetId,
  LoanId,
  PlayerId,
  SettlementId,
} from "@finance-game/shared";

import { nextDeterministicId } from "../game/deterministicIds";
import { assertGameState } from "../invariants/assertGameState";
import type {
  GameState,
  LegacyBankLoan,
  QuarterStartFinanceBasis,
} from "../model/gameState";
import { externalCashAccount, playerCashAccount } from "./account";
import { calculateLegacyBankLoanNextPayment } from "./amortization";
import type { JournalEntry } from "./journal";
import { calculateQuarterlyYieldCents } from "./markets";
import { cents } from "./money";
import { allocateProportionalCents } from "./ownership";
import { type CashPostingRequest, postCash } from "./posting";
import { calculatePropertyCashFlow } from "./property";

export interface SettleQuarterRequest {
  readonly quarter: number;
}

export type SettleQuarterErrorCode =
  | "WRONG_PHASE"
  | "INVALID_QUARTER"
  | "QUARTER_ALREADY_SETTLED"
  | "WRONG_QUARTER"
  | "DESTINATION_OVERFLOW"
  | "INSUFFICIENT_FUNDS";

export type SettleQuarterResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly settlementId: SettlementId;
      readonly journalEntries: readonly JournalEntry[];
    }
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly code: SettleQuarterErrorCode;
      readonly journalEntries: readonly [];
    };

interface PlannedCashYield {
  readonly playerId: PlayerId;
  readonly amountCents: number;
}

interface PlannedDividend {
  readonly playerId: PlayerId;
  readonly instrumentId: PublicMarketInstrumentId;
  readonly amountCents: number;
}

interface PlannedPersonalIncome {
  readonly playerId: PlayerId;
  readonly amountCents: number;
}

interface PlannedPropertyDistribution {
  readonly sourceAccount: ReturnType<typeof externalCashAccount>;
  readonly destinationPlayerId: PlayerId;
  readonly amountCents: number;
  readonly reason: string;
  readonly quarter: number;
  readonly assetId: AssetId;
}

interface PlannedLivingExpense {
  readonly playerId: PlayerId;
  readonly amountCents: number;
}

interface PlannedLegacyBankLoanPayment {
  readonly loanId: LoanId;
  readonly borrowerPlayerId: PlayerId;
  readonly paymentCents: number;
  readonly principalCents: number;
  readonly interestCents: number;
  readonly closingPrincipalCents: number;
  readonly reason: string;
  readonly relatedAssetId?: AssetId;
}

/**
 * Pure internal authoritative quarter-settlement operation.
 *
 * Supported in PR #10:
 * - Cash yield from quarter-start cash (bank -> player)
 * - Public-market dividends from quarter-start holdings (market -> player)
 * - Recurring personal/spendable income (personal-earned-income -> player)
 * - Debt-free property operating cash-flow distribution (property-operating-cashflow -> player)
 * - Recurring living expenses (player -> living-expense-sink)
 * - Opening legacy bank loans: personal debt and Property Starter mortgage (player -> bank)
 * - Authoritative quarter-start finance basis capture for Quarter N+1
 *
 * Deliberately NOT supported (A4-A6 remain OPEN):
 * - Business distributions;
 * - Business-debt schedules;
 * - Player-loan automatic settlement;
 * - Market price movements, trading, transaction fees, default/recovery/collateral.
 *
 * Guarantees:
 * - Solvency and destination overflow validated for all players during planning;
 * - Deterministic plan computed before any state mutation;
 * - Rejection preserves state, revision, counters, RNG, and emits zero journal entries;
 * - Settlement requires completed setup (ready-for-first-round phase);
 * - Atomic execution of postings in strict canonical order:
 *     1. Cash yield (PlayerId)
 *     2. Public-market dividends (instrument-ID canonical order, then PlayerId)
 *     3. Personal income (PlayerId)
 *     4. Property distributions (AssetId then PlayerId)
 *     5. Living expenses (PlayerId)
 *     6. Legacy bank loan payments (LoanId)
 * - Exactly one SettlementId created and counter advanced once per successful settlement.
 * - Next quarter finance basis captured from closing Quarter N state.
 */
export function settleQuarter(
  state: GameState,
  request: SettleQuarterRequest,
): SettleQuarterResult {
  const reject = (code: SettleQuarterErrorCode): SettleQuarterResult => ({
    ok: false,
    state,
    code,
    journalEntries: [],
  });

  // 1. Phase validation: must have completed setup (ready-for-first-round)
  if (state.phase !== "ready-for-first-round") {
    return reject("WRONG_PHASE");
  }

  // 2. Quarter validation
  if (!Number.isSafeInteger(request.quarter) || request.quarter <= 0) {
    return reject("INVALID_QUARTER");
  }

  if (request.quarter <= state.lastSettledQuarter) {
    return reject("QUARTER_ALREADY_SETTLED");
  }

  if (request.quarter !== state.currentQuarter) {
    return reject("WRONG_QUARTER");
  }

  if (state.currentQuarter >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      "currentQuarter has reached the maximum safe integer limit",
    );
  }

  // 3. Settlement Planning (Pure, zero state mutation)
  const plannedInflowByPlayer: Partial<Record<PlayerId, number>> = {};
  const plannedOutflowByPlayer: Partial<Record<PlayerId, number>> = {};

  const sortedPlayerIds = [...state.playerOrder].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  // A. Cash yield, ordered by PlayerId (calculated from quarter-start cash basis)
  const plannedCashYields: PlannedCashYield[] = [];
  for (const playerId of sortedPlayerIds) {
    const basisCash =
      state.finance.quarterStartBasis.cashByPlayer[playerId] ?? 0;
    if (basisCash > 0) {
      const yieldCents = calculateQuarterlyYieldCents({
        principalCents: basisCash,
        annualYieldBps: STANDARD_V1_OPENING_CASH_YIELD_BPS,
      });
      if (yieldCents > 0) {
        const prevInflow = plannedInflowByPlayer[playerId] ?? 0;
        if (yieldCents > Number.MAX_SAFE_INTEGER - prevInflow) {
          return reject("DESTINATION_OVERFLOW");
        }
        plannedInflowByPlayer[playerId] = prevInflow + yieldCents;
        plannedCashYields.push({
          playerId,
          amountCents: yieldCents,
        });
      }
    }
  }

  // B. Public-market dividends, ordered by instrument canonical ID order, then PlayerId
  const plannedDividends: PlannedDividend[] = [];
  for (const instrumentId of PUBLIC_MARKET_INSTRUMENT_IDS) {
    const instrumentDef = PUBLIC_MARKET_INSTRUMENTS[instrumentId];
    for (const playerId of sortedPlayerIds) {
      const basisPortfolio =
        state.finance.quarterStartBasis.publicMarketsByPlayer[playerId];
      const basisHolding = basisPortfolio?.[instrumentId] ?? 0;
      if (basisHolding > 0) {
        const divCents = calculateQuarterlyYieldCents({
          principalCents: basisHolding,
          annualYieldBps: instrumentDef.annualDividendYieldBps,
        });
        if (divCents > 0) {
          const prevInflow = plannedInflowByPlayer[playerId] ?? 0;
          if (divCents > Number.MAX_SAFE_INTEGER - prevInflow) {
            return reject("DESTINATION_OVERFLOW");
          }
          plannedInflowByPlayer[playerId] = prevInflow + divCents;
          plannedDividends.push({
            playerId,
            instrumentId,
            amountCents: divCents,
          });
        }
      }
    }
  }

  // C. Recurring personal income, ordered by PlayerId
  const plannedIncomes: PlannedPersonalIncome[] = [];
  for (const playerId of sortedPlayerIds) {
    const rec = state.finance.recurringByPlayer?.[playerId];
    if (rec !== undefined && rec.quarterlyIncomeCents > 0) {
      const prevInflow = plannedInflowByPlayer[playerId] ?? 0;
      if (rec.quarterlyIncomeCents > Number.MAX_SAFE_INTEGER - prevInflow) {
        return reject("DESTINATION_OVERFLOW");
      }
      plannedInflowByPlayer[playerId] = prevInflow + rec.quarterlyIncomeCents;
      plannedIncomes.push({
        playerId,
        amountCents: rec.quarterlyIncomeCents,
      });
    }
  }

  // D. Property operating distributions, ordered by AssetId then PlayerId
  const sortedAssetIds = (
    Object.keys(state.finance.assetsById) as AssetId[]
  ).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const plannedPropertyDistributions: PlannedPropertyDistribution[] = [];

  for (const assetId of sortedAssetIds) {
    const asset = state.finance.assetsById[assetId];
    if (asset === undefined) continue;

    // Business assets are intentionally NOT cash-settled in PR #8 (A4 remains OPEN)
    if (asset.kind === "business") {
      continue;
    }

    if (asset.kind === "property") {
      const cashFlow = calculatePropertyCashFlow(asset);
      if (cashFlow.netOperatingIncomeCents <= 0) {
        continue;
      }

      const allocations = allocateProportionalCents(
        cashFlow.netOperatingIncomeCents,
        asset.ownershipByPlayerPpm,
      );

      const sortedOwnerIds = (Object.keys(allocations) as PlayerId[]).sort(
        (a, b) => (a < b ? -1 : a > b ? 1 : 0),
      );

      for (const ownerId of sortedOwnerIds) {
        const allocatedCents = allocations[ownerId];
        if (allocatedCents !== undefined && allocatedCents > 0) {
          const prevInflow = plannedInflowByPlayer[ownerId] ?? 0;
          if (allocatedCents > Number.MAX_SAFE_INTEGER - prevInflow) {
            return reject("DESTINATION_OVERFLOW");
          }
          plannedInflowByPlayer[ownerId] = prevInflow + allocatedCents;

          plannedPropertyDistributions.push({
            sourceAccount: externalCashAccount("property-operating-cashflow"),
            destinationPlayerId: ownerId,
            amountCents: allocatedCents,
            reason: "property-operating-distribution",
            quarter: request.quarter,
            assetId: asset.id,
          });
        }
      }
    }
  }

  // C. Recurring living expenses, ordered by PlayerId
  const plannedLivingExpenses: PlannedLivingExpense[] = [];
  for (const playerId of sortedPlayerIds) {
    const rec = state.finance.recurringByPlayer?.[playerId];
    if (rec !== undefined && rec.quarterlyLivingExpenseCents > 0) {
      const prevOutflow = plannedOutflowByPlayer[playerId] ?? 0;
      if (
        rec.quarterlyLivingExpenseCents >
        Number.MAX_SAFE_INTEGER - prevOutflow
      ) {
        return reject("INSUFFICIENT_FUNDS");
      }
      plannedOutflowByPlayer[playerId] =
        prevOutflow + rec.quarterlyLivingExpenseCents;
      plannedLivingExpenses.push({
        playerId,
        amountCents: rec.quarterlyLivingExpenseCents,
      });
    }
  }

  // D. Legacy bank-loan payments, ordered by LoanId
  const sortedLoanIds = (Object.keys(state.finance.loansById) as LoanId[]).sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );

  const plannedLoanPayments: PlannedLegacyBankLoanPayment[] = [];
  for (const loanId of sortedLoanIds) {
    const loan = state.finance.loansById[loanId];
    if (
      loan !== undefined &&
      loan.kind === "legacy-bank-loan" &&
      loan.outstandingPrincipalCents > 0
    ) {
      const paymentCalc = calculateLegacyBankLoanNextPayment({
        outstandingPrincipalCents: loan.outstandingPrincipalCents,
        annualRateBps: loan.annualRateBps,
        scheduledQuarterlyPaymentCents: loan.scheduledQuarterlyPaymentCents,
      });

      const borrowerId = loan.borrowerPlayerId;
      const prevOutflow = plannedOutflowByPlayer[borrowerId] ?? 0;
      if (paymentCalc.paymentCents > Number.MAX_SAFE_INTEGER - prevOutflow) {
        return reject("INSUFFICIENT_FUNDS");
      }
      plannedOutflowByPlayer[borrowerId] =
        prevOutflow + paymentCalc.paymentCents;

      plannedLoanPayments.push({
        loanId: loan.id,
        borrowerPlayerId: borrowerId,
        paymentCents: paymentCalc.paymentCents,
        principalCents: paymentCalc.principalCents,
        interestCents: paymentCalc.interestCents,
        closingPrincipalCents: paymentCalc.closingPrincipalCents,
        reason:
          loan.purpose === "property-mortgage"
            ? "legacy-mortgage-payment"
            : "legacy-personal-debt-payment",
        relatedAssetId: loan.relatedAssetId,
      });
    }
  }

  // E. Solvency & Destination Overflow Planning Validation
  for (const playerId of state.playerOrder) {
    const currentBalance = state.finance.cashByPlayer[playerId];
    if (currentBalance === undefined) {
      throw new Error(
        `Invariant violation: unknown player ${playerId} in cash balances`,
      );
    }
    const totalInflow = plannedInflowByPlayer[playerId] ?? 0;
    const totalOutflow = plannedOutflowByPlayer[playerId] ?? 0;

    if (totalInflow > Number.MAX_SAFE_INTEGER - currentBalance) {
      return reject("DESTINATION_OVERFLOW");
    }

    const projectedEndingCash = currentBalance + totalInflow - totalOutflow;
    if (projectedEndingCash < 0) {
      return reject("INSUFFICIENT_FUNDS");
    }
  }

  // 4. Atomic Application in deterministic order
  const { id: settlementId, counters: countersWithSettlement } =
    nextDeterministicId("settlement", state.counters);

  let currentFinance = state.finance;
  let currentCounters = countersWithSettlement;
  const journalEntries: JournalEntry[] = [];

  // 4.1 Apply cash yield
  for (const yieldPost of plannedCashYields) {
    const postRequest: CashPostingRequest = {
      source: externalCashAccount("bank"),
      destination: playerCashAccount(yieldPost.playerId),
      amountCents: yieldPost.amountCents,
      reason: "cash-yield",
      quarter: request.quarter,
    };

    const postResult = postCash(currentFinance, currentCounters, postRequest);
    if (!postResult.ok) {
      throw new Error(
        `Invariant violation: unexpected cash posting failure during cash yield settlement: ${postResult.code}`,
      );
    }

    currentFinance = postResult.finance;
    currentCounters = postResult.counters;
    journalEntries.push(postResult.entry);
  }

  // 4.2 Apply public-market dividends
  for (const divPost of plannedDividends) {
    const postRequest: CashPostingRequest = {
      source: externalCashAccount("market"),
      destination: playerCashAccount(divPost.playerId),
      amountCents: divPost.amountCents,
      reason: "public-market-dividend",
      quarter: request.quarter,
      relatedMarketInstrumentId: divPost.instrumentId,
    };

    const postResult = postCash(currentFinance, currentCounters, postRequest);
    if (!postResult.ok) {
      throw new Error(
        `Invariant violation: unexpected cash posting failure during public market dividend settlement: ${postResult.code}`,
      );
    }

    currentFinance = postResult.finance;
    currentCounters = postResult.counters;
    journalEntries.push(postResult.entry);
  }

  // 4.3 Apply recurring personal income
  for (const inc of plannedIncomes) {
    const postRequest: CashPostingRequest = {
      source: externalCashAccount("personal-earned-income"),
      destination: playerCashAccount(inc.playerId),
      amountCents: inc.amountCents,
      reason: "recurring-personal-income",
      quarter: request.quarter,
    };

    const postResult = postCash(currentFinance, currentCounters, postRequest);
    if (!postResult.ok) {
      throw new Error(
        `Invariant violation: unexpected cash posting failure during personal income settlement: ${postResult.code}`,
      );
    }

    currentFinance = postResult.finance;
    currentCounters = postResult.counters;
    journalEntries.push(postResult.entry);
  }

  // 4.4 Apply property operating distributions
  for (const distribution of plannedPropertyDistributions) {
    const postRequest: CashPostingRequest = {
      source: distribution.sourceAccount,
      destination: playerCashAccount(distribution.destinationPlayerId),
      amountCents: distribution.amountCents,
      reason: distribution.reason,
      quarter: distribution.quarter,
      relatedAssetId: distribution.assetId,
    };

    const postResult = postCash(currentFinance, currentCounters, postRequest);
    if (!postResult.ok) {
      throw new Error(
        `Invariant violation: unexpected cash posting failure during property distribution settlement: ${postResult.code}`,
      );
    }

    currentFinance = postResult.finance;
    currentCounters = postResult.counters;
    journalEntries.push(postResult.entry);
  }

  // 4.5 Apply recurring living expenses
  for (const exp of plannedLivingExpenses) {
    const postRequest: CashPostingRequest = {
      source: playerCashAccount(exp.playerId),
      destination: externalCashAccount("living-expense-sink"),
      amountCents: exp.amountCents,
      reason: "recurring-living-expense",
      quarter: request.quarter,
    };

    const postResult = postCash(currentFinance, currentCounters, postRequest);
    if (!postResult.ok) {
      throw new Error(
        `Invariant violation: unexpected cash posting failure during living expense settlement: ${postResult.code}`,
      );
    }

    currentFinance = postResult.finance;
    currentCounters = postResult.counters;
    journalEntries.push(postResult.entry);
  }

  // 4.6 Apply legacy bank-loan payments
  const updatedLoansById: Record<
    LoanId,
    GameState["finance"]["loansById"][LoanId]
  > = {
    ...currentFinance.loansById,
  };

  for (const loanPayment of plannedLoanPayments) {
    const postRequest: CashPostingRequest = {
      source: playerCashAccount(loanPayment.borrowerPlayerId),
      destination: externalCashAccount("bank"),
      amountCents: loanPayment.paymentCents,
      reason: loanPayment.reason,
      quarter: request.quarter,
      relatedLoanId: loanPayment.loanId,
      ...(loanPayment.relatedAssetId !== undefined
        ? { relatedAssetId: loanPayment.relatedAssetId }
        : {}),
      loanPayment: {
        principalCents: cents(loanPayment.principalCents),
        interestCents: cents(loanPayment.interestCents),
      },
    };

    const postResult = postCash(currentFinance, currentCounters, postRequest);
    if (!postResult.ok) {
      throw new Error(
        `Invariant violation: unexpected cash posting failure during legacy loan settlement: ${postResult.code}`,
      );
    }

    currentFinance = postResult.finance;
    currentCounters = postResult.counters;
    journalEntries.push(postResult.entry);

    const originalLoan = updatedLoansById[loanPayment.loanId];
    if (
      originalLoan === undefined ||
      originalLoan.kind !== "legacy-bank-loan"
    ) {
      throw new Error(
        `Invariant violation: missing legacy bank loan ${loanPayment.loanId}`,
      );
    }

    const updatedLoan: LegacyBankLoan = {
      ...originalLoan,
      outstandingPrincipalCents: cents(loanPayment.closingPrincipalCents),
      paymentsApplied: originalLoan.paymentsApplied + 1,
    };
    updatedLoansById[loanPayment.loanId] = updatedLoan;
  }

  const nextQuarter = request.quarter + 1;
  const nextQuarterBasis: QuarterStartFinanceBasis = {
    quarter: nextQuarter,
    cashByPlayer: { ...currentFinance.cashByPlayer },
    publicMarketsByPlayer: { ...currentFinance.publicMarketsByPlayer },
  };

  currentFinance = {
    ...currentFinance,
    loansById: updatedLoansById,
    quarterStartBasis: nextQuarterBasis,
  };

  const nextState: GameState = {
    ...state,
    revision: state.revision + 1,
    currentQuarter: nextQuarter,
    lastSettledQuarter: request.quarter,
    finance: currentFinance,
    counters: currentCounters,
  };

  assertGameState(nextState);

  return {
    ok: true,
    state: nextState,
    settlementId,
    journalEntries,
  };
}
