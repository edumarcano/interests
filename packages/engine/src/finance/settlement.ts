import {
  calculateCashYieldBps,
  PUBLIC_MARKET_INSTRUMENT_IDS,
  PUBLIC_MARKET_INSTRUMENTS,
  type PublicMarketInstrumentId,
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
  EconomyState,
  GameState,
  LegacyBankLoan,
  MarketUpdateRecord,
  PlayerLoan,
  PublicMarketPortfolio,
  QuarterStartFinanceBasis,
} from "../model/gameState";
import { externalCashAccount, playerCashAccount } from "./account";
import {
  calculateLegacyBankLoanNextPayment,
  calculatePlayerLoanSchedule,
} from "./amortization";
import { generateQuarterMarketUpdate } from "./economy";
import type { JournalEntry } from "./journal";
import {
  calculateQuarterlyYieldCents,
  revaluePublicMarketPortfolio,
} from "./markets";
import { cents } from "./money";
import { allocateProportionalCents } from "./ownership";
import { type CashPostingRequest, postCash } from "./posting";
import { calculatePropertyCashFlow } from "./property";

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
  | "MARKET_VALUE_OVERFLOW";

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

interface PlannedPlayerLoanPayment {
  readonly loanId: LoanId;
  readonly borrowerPlayerId: PlayerId;
  readonly lenderPlayerId: PlayerId;
  readonly paymentCents: number;
  readonly principalCents: number;
  readonly interestCents: number;
  readonly closingPrincipalCents: number;
}

/**
 * Pure internal authoritative quarter-settlement operation.
 *
 * Supported in PR #10 and PR #15:
 * - Cash yield from quarter-start cash (bank -> player)
 * - Public-market dividends from quarter-start holdings (market -> player)
 * - Recurring personal/spendable income (personal-earned-income -> player)
 * - Debt-free property operating cash-flow distribution (property-operating-cashflow -> player)
 * - Recurring living expenses (player -> living-expense-sink)
 * - Opening legacy bank loans: personal debt and Property Starter mortgage (player -> bank)
 * - Scheduled player-loan repayments: confirmed player loans (borrower player -> lender player, LoanId order)
 * - Authoritative quarter-start finance basis capture for Quarter N+1
 *
 * Deliberately NOT supported (A4-A6 remain OPEN):
 * - Business distributions;
 * - Business-debt schedules;
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
 *     7. Scheduled player-loan payments (LoanId)
 * - Exactly one SettlementId created and counter advanced once per successful settlement.
/**
 * Pure internal authoritative quarter-settlement operation.
 * Leaves GameState.revision unchanged so it can be composed into higher-level player commands.
 */
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

  // 1. Phase validation: must have completed setup (ready-for-first-round)
  if (state.phase !== "ready-for-first-round") {
    return reject("WRONG_PHASE");
  }

  // Active transaction validation: transactions must be resolved before quarterly settlement
  if (state.activeTransaction !== null) {
    return reject("ACTIVE_TRANSACTION");
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
      const annualCashYieldBps = calculateCashYieldBps(
        state.economy.baseRateBps,
      );
      const yieldCents = calculateQuarterlyYieldCents({
        principalCents: basisCash,
        annualYieldBps: annualCashYieldBps,
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

  // E. Solvency & Destination Overflow Planning Validation (Pre-Player-Loan Stages)
  const cashAtStartOfPlayerLoanStage: Partial<Record<PlayerId, number>> = {};
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
    cashAtStartOfPlayerLoanStage[playerId] = projectedEndingCash;
  }

  // F. Scheduled player-loan repayments, ordered by LoanId
  const plannedPlayerLoanPayments: PlannedPlayerLoanPayment[] = [];
  const plannedPlayerLoanOutflowByBorrower: Partial<Record<PlayerId, number>> =
    {};
  const plannedPlayerLoanInflowByLender: Partial<Record<PlayerId, number>> = {};

  for (const loanId of sortedLoanIds) {
    const loan = state.finance.loansById[loanId];
    if (
      loan !== undefined &&
      loan.kind === "player-loan" &&
      loan.originatedQuarter < request.quarter &&
      loan.installmentsPaid < loan.termQuarters &&
      loan.outstandingPrincipalCents > 0
    ) {
      const schedule = calculatePlayerLoanSchedule({
        principalCents: loan.originalPrincipalCents,
        annualRateBps: loan.annualRateBps,
        termQuarters: loan.termQuarters,
      });

      const nextInstallment = schedule[loan.installmentsPaid];
      if (nextInstallment === undefined) {
        throw new Error(
          `Invariant violation: missing schedule row for player loan ${loan.id} installment ${loan.installmentsPaid}`,
        );
      }

      const borrowerId = loan.borrowerPlayerId;
      const lenderId = loan.lenderPlayerId;

      const prevOutflow = plannedPlayerLoanOutflowByBorrower[borrowerId] ?? 0;
      if (
        nextInstallment.paymentCents >
        Number.MAX_SAFE_INTEGER - prevOutflow
      ) {
        return reject("INSUFFICIENT_FUNDS");
      }
      plannedPlayerLoanOutflowByBorrower[borrowerId] =
        prevOutflow + nextInstallment.paymentCents;

      const prevInflow = plannedPlayerLoanInflowByLender[lenderId] ?? 0;
      if (nextInstallment.paymentCents > Number.MAX_SAFE_INTEGER - prevInflow) {
        return reject("DESTINATION_OVERFLOW");
      }
      plannedPlayerLoanInflowByLender[lenderId] =
        prevInflow + nextInstallment.paymentCents;

      plannedPlayerLoanPayments.push({
        loanId: loan.id,
        borrowerPlayerId: borrowerId,
        lenderPlayerId: lenderId,
        paymentCents: nextInstallment.paymentCents,
        principalCents: nextInstallment.principalCents,
        interestCents: nextInstallment.interestCents,
        closingPrincipalCents: nextInstallment.closingPrincipalCents,
      });
    }
  }

  // Evaluate borrower solvency using cash at the start of the player-loan stage
  // (Incoming player-loan receipts during this stage do not fund outgoing obligations!)
  for (const playerId of state.playerOrder) {
    const stageStartCash = cashAtStartOfPlayerLoanStage[playerId] ?? 0;
    const playerLoanOutflow = plannedPlayerLoanOutflowByBorrower[playerId] ?? 0;
    if (playerLoanOutflow > stageStartCash) {
      return reject("INSUFFICIENT_FUNDS");
    }
  }

  // Simulate canonical LoanId-ordered posting to guarantee no transient destination overflow.
  // Each player's running balance starts at their cash at the beginning of the player-loan stage.
  const runningCashByPlayer: Partial<Record<PlayerId, number>> = {
    ...cashAtStartOfPlayerLoanStage,
  };

  for (const loanPayment of plannedPlayerLoanPayments) {
    const lenderCash = runningCashByPlayer[loanPayment.lenderPlayerId] ?? 0;
    if (loanPayment.paymentCents > Number.MAX_SAFE_INTEGER - lenderCash) {
      return reject("DESTINATION_OVERFLOW");
    }
    const borrowerCash = runningCashByPlayer[loanPayment.borrowerPlayerId] ?? 0;
    runningCashByPlayer[loanPayment.borrowerPlayerId] =
      borrowerCash - loanPayment.paymentCents;
    runningCashByPlayer[loanPayment.lenderPlayerId] =
      lenderCash + loanPayment.paymentCents;
  }

  // Phase C: Tentative economy planning (Pure, tentative RNG cursor, zero state mutation)
  const marketUpdate = generateQuarterMarketUpdate({
    regime: state.economy.currentRegime,
    random: state.random,
  });

  const revaluedMarketsByPlayer: Record<PlayerId, PublicMarketPortfolio> =
    {} as Record<PlayerId, PublicMarketPortfolio>;

  for (const playerId of sortedPlayerIds) {
    const currentPortfolio = state.finance.publicMarketsByPlayer[playerId];
    if (currentPortfolio === undefined) {
      throw new Error(
        `Invariant violation: unknown player ${playerId} in publicMarketsByPlayer`,
      );
    }
    try {
      const revalued = revaluePublicMarketPortfolio(
        currentPortfolio,
        marketUpdate.returnBpsByInstrument,
      );
      revaluedMarketsByPlayer[playerId] = revalued;
    } catch {
      return reject("MARKET_VALUE_OVERFLOW");
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

  // 4.7 Apply scheduled player-loan payments
  for (const loanPayment of plannedPlayerLoanPayments) {
    const postRequest: CashPostingRequest = {
      source: playerCashAccount(loanPayment.borrowerPlayerId),
      destination: playerCashAccount(loanPayment.lenderPlayerId),
      amountCents: loanPayment.paymentCents,
      reason: "loan-payment",
      quarter: request.quarter,
      relatedLoanId: loanPayment.loanId,
      loanPayment: {
        principalCents: cents(loanPayment.principalCents),
        interestCents: cents(loanPayment.interestCents),
      },
    };

    const postResult = postCash(currentFinance, currentCounters, postRequest);
    if (!postResult.ok) {
      throw new Error(
        `Invariant violation: unexpected cash posting failure during player loan settlement: ${postResult.code}`,
      );
    }

    currentFinance = postResult.finance;
    currentCounters = postResult.counters;
    journalEntries.push(postResult.entry);

    const originalLoan = updatedLoansById[loanPayment.loanId];
    if (originalLoan === undefined || originalLoan.kind !== "player-loan") {
      throw new Error(
        `Invariant violation: missing player loan ${loanPayment.loanId}`,
      );
    }

    const updatedLoan: PlayerLoan = {
      ...originalLoan,
      outstandingPrincipalCents: cents(loanPayment.closingPrincipalCents),
      installmentsPaid: originalLoan.installmentsPaid + 1,
    };
    updatedLoansById[loanPayment.loanId] = updatedLoan;
  }

  // 4.8 Record completed market update and transition economy to QN+1 regime
  const lastMarketUpdate: MarketUpdateRecord = {
    quarter: request.quarter,
    regimeUsed: marketUpdate.regimeUsed,
    returnBpsByInstrument: marketUpdate.returnBpsByInstrument,
  };

  const nextEconomy: EconomyState = {
    currentRegime: marketUpdate.nextRegime,
    baseRateBps: state.economy.baseRateBps,
    lastMarketUpdate,
  };

  const nextQuarter = request.quarter + 1;
  const nextQuarterBasis: QuarterStartFinanceBasis = {
    quarter: nextQuarter,
    cashByPlayer: { ...currentFinance.cashByPlayer },
    publicMarketsByPlayer: { ...revaluedMarketsByPlayer },
  };

  currentFinance = {
    ...currentFinance,
    publicMarketsByPlayer: revaluedMarketsByPlayer,
    loansById: updatedLoansById,
    quarterStartBasis: nextQuarterBasis,
  };

  const nextState: GameState = {
    ...state,
    currentQuarter: nextQuarter,
    lastSettledQuarter: request.quarter,
    finance: currentFinance,
    economy: nextEconomy,
    random: marketUpdate.nextRandom,
    counters: currentCounters,
    round:
      state.round !== null
        ? {
            stage: "round-start",
            spotlightsCompleted: 0,
          }
        : null,
  };

  assertGameState(nextState);

  return {
    ok: true,
    state: nextState,
    settlementId,
    journalEntries,
  };
}

/**
 * Trusted internal finance settlement operation.
 *
 * NOTE: Normal player gameplay round progression advances to settlement
 * through the round controller (advanceSpotlight / terminal transaction resolution).
 * settleQuarter directly executes quarterly settlement and increments GameState.revision by 1.
 */
export function settleQuarter(
  state: GameState,
  request: SettleQuarterRequest,
): SettleQuarterResult {
  const result = applyQuarterSettlement(state, request);
  if (!result.ok) {
    return result;
  }

  const nextState: GameState = {
    ...result.state,
    revision: state.revision + 1,
  };

  assertGameState(nextState);

  return {
    ...result,
    state: nextState,
  };
}
