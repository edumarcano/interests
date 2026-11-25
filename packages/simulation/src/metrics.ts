import {
  calculateBusinessEquity,
  ENGINE_VERSION,
  type GameState,
  type JournalEntry,
  type SettleQuarterErrorCode,
  totalPublicMarketValueCents,
  WORKSPACE_COMPATIBILITY,
} from "@interests/engine";
import {
  ECONOMIC_REGIME_IDS,
  type EconomicRegimeId,
  PROFILE_IDS,
  type ProfileId,
  PUBLIC_MARKET_INSTRUMENT_IDS,
  type PublicMarketInstrumentId,
  STANDARD_V1_PLAYER_COUNT,
} from "@interests/rules";
import type { PlayerId } from "@interests/shared";

import {
  BASELINE_SCENARIO_NAME,
  type BaselineSimulationConfig,
  type BaselineSimulationEconomyReport,
  type BaselineSimulationReport,
  type BaselineSimulationTotals,
  type CashFlowSummary,
  type IntSummary,
  type MarketInstrumentReturnStatistics,
  type PassiveBaselineGameResult,
  type ProfileAggregateMetrics,
  type SimulationFinanceBalances,
  type SimulationFinanceObservation,
  type SimulationPlayerCashFlow,
  type SimulationPlayerSnapshot,
} from "./types";
import { SIMULATION_VERSION } from "./version";

export function safeAdd(a: number, b: number, context = "addition"): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    throw new RangeError(
      `Values must be safe integers for ${context}, got ${String(a)} and ${String(b)}`,
    );
  }
  const result = a + b;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(
      `Integer arithmetic overflow in ${context}: ${String(a)} + ${String(b)}`,
    );
  }
  return result;
}

export function roundedAverage(sum: number, count: number): number {
  if (count <= 0) return 0;
  return Math.round(sum / count);
}

export function createZeroPlayerCashFlow(): SimulationPlayerCashFlow {
  return {
    workCompensationReceivedCents: 0,
    playerLoanPrincipalReceivedCents: 0,
    playerLoanInterestReceivedCents: 0,
    playerLoanPrincipalPaidCents: 0,
    playerLoanInterestPaidCents: 0,
    cashYieldReceivedCents: 0,
    publicMarketDividendsReceivedCents: 0,
    recurringIncomeReceivedCents: 0,
    propertyDistributionsReceivedCents: 0,
    businessDistributionsReceivedCents: 0,
    livingExpensesPaidCents: 0,
    legacyPrincipalPaidCents: 0,
    legacyInterestPaidCents: 0,
  };
}

export function createPlayerSnapshot(
  state: GameState,
  playerId: PlayerId,
): SimulationPlayerSnapshot {
  const player = state.players[playerId];
  if (player === undefined) {
    throw new Error(`Simulation invariant failed: unknown player ${playerId}`);
  }

  const cashCents = state.finance.cashByPlayer[playerId];
  if (cashCents === undefined) {
    throw new Error(
      `Simulation invariant failed: missing cash for player ${playerId}`,
    );
  }

  const portfolio = state.finance.publicMarketsByPlayer[playerId];
  if (portfolio === undefined) {
    throw new Error(
      `Simulation invariant failed: missing public market portfolio for player ${playerId}`,
    );
  }
  const publicMarketValueCents = totalPublicMarketValueCents(portfolio);
  const liquidCapitalCents = safeAdd(
    cashCents,
    publicMarketValueCents,
    "liquidCapitalCents",
  );

  let unpaidObligationsCents =
    state.finance.livingArrearsByPlayer[playerId] ?? 0;
  let legacyBankDebtCents = 0;
  let playerLoanDebtCents = 0;
  let playerLoanReceivableCents = 0;
  let unpaidInterestReceivableCents = 0;

  for (const loan of Object.values(state.finance.loansById)) {
    if (
      loan.kind !== "company-loan" &&
      loan.kind !== "asset-bank-loan" &&
      loan.borrowerPlayerId === playerId
    )
      unpaidObligationsCents = safeAdd(
        unpaidObligationsCents,
        loan.unpaidInterestCents,
        "unpaid obligations",
      );
    if (loan.kind === "player-loan" && loan.lenderPlayerId === playerId)
      unpaidInterestReceivableCents = safeAdd(
        unpaidInterestReceivableCents,
        loan.unpaidInterestCents,
        "unpaid interest receivable",
      );
    if (loan.kind === "legacy-bank-loan") {
      if (loan.borrowerPlayerId === playerId) {
        legacyBankDebtCents = safeAdd(
          legacyBankDebtCents,
          loan.outstandingPrincipalCents,
          "legacyBankDebtCents",
        );
      }
    } else if (loan.kind === "player-loan") {
      if (loan.borrowerPlayerId === playerId) {
        playerLoanDebtCents = safeAdd(
          playerLoanDebtCents,
          loan.outstandingPrincipalCents,
          "playerLoanDebtCents",
        );
      }
      if (loan.lenderPlayerId === playerId) {
        playerLoanReceivableCents = safeAdd(
          playerLoanReceivableCents,
          loan.outstandingPrincipalCents,
          "playerLoanReceivableCents",
        );
      }
    }
  }

  const positivePosition = safeAdd(
    safeAdd(cashCents, publicMarketValueCents, "liquidNetPositivePart1"),
    safeAdd(
      playerLoanReceivableCents,
      unpaidInterestReceivableCents,
      "nominal receivables",
    ),
    "liquidNetPositivePart2",
  );
  const totalDebt = safeAdd(
    safeAdd(
      legacyBankDebtCents,
      unpaidObligationsCents,
      "unpaid obligation debt",
    ),
    playerLoanDebtCents,
    "liquidNetDebtPart",
  );
  const liquidNetPositionCents = positivePosition - totalDebt;
  if (!Number.isSafeInteger(liquidNetPositionCents)) {
    throw new RangeError(
      "liquidNetPositionCents calculation resulted in non-safe integer",
    );
  }

  return {
    playerId,
    profileId: player.profileId,
    selectedObjectiveId: player.selectedObjectiveId,
    cashCents,
    publicMarketValueCents,
    liquidCapitalCents,
    legacyBankDebtCents,
    playerLoanDebtCents,
    playerLoanReceivableCents,
    unpaidObligationsCents,
    unpaidInterestReceivableCents,
    liquidNetPositionCents,
  };
}

export function applySettlementJournalToCashFlows(
  cashFlows: Record<PlayerId, SimulationPlayerCashFlow>,
  journalEntries: readonly JournalEntry[],
): void {
  for (const entry of journalEntries) {
    if (entry.destination.kind === "player") {
      const pId = entry.destination.playerId;
      const flow = cashFlows[pId];
      if (flow === undefined) {
        throw new Error(
          `Simulation invariant failed: unknown destination player ${pId} in settlement journal`,
        );
      }
      if (
        entry.reason === "business-work-compensation" ||
        entry.reason === "business-work-compensation-arrears"
      ) {
        flow.workCompensationReceivedCents = safeAdd(
          flow.workCompensationReceivedCents,
          entry.amountCents,
        );
      } else if (entry.reason === "loan-payment") {
        if (!entry.loanPayment)
          throw new Error("Missing player loan payment breakdown");
        flow.playerLoanPrincipalReceivedCents = safeAdd(
          flow.playerLoanPrincipalReceivedCents,
          entry.loanPayment.principalCents,
        );
        flow.playerLoanInterestReceivedCents = safeAdd(
          flow.playerLoanInterestReceivedCents,
          entry.loanPayment.interestCents,
        );
      } else if (entry.reason === "cash-yield") {
        flow.cashYieldReceivedCents = safeAdd(
          flow.cashYieldReceivedCents,
          entry.amountCents,
          "cashYieldReceivedCents",
        );
      } else if (entry.reason === "public-market-dividend") {
        flow.publicMarketDividendsReceivedCents = safeAdd(
          flow.publicMarketDividendsReceivedCents,
          entry.amountCents,
          "publicMarketDividendsReceivedCents",
        );
      } else if (entry.reason === "recurring-personal-income") {
        flow.recurringIncomeReceivedCents = safeAdd(
          flow.recurringIncomeReceivedCents,
          entry.amountCents,
          "recurringIncomeReceivedCents",
        );
      } else if (entry.reason === "business-distribution") {
        flow.businessDistributionsReceivedCents = safeAdd(
          flow.businessDistributionsReceivedCents,
          entry.amountCents,
          "businessDistributionsReceivedCents",
        );
      } else if (entry.reason === "property-operating-distribution") {
        flow.propertyDistributionsReceivedCents = safeAdd(
          flow.propertyDistributionsReceivedCents,
          entry.amountCents,
          "propertyDistributionsReceivedCents",
        );
      }
    }

    if (entry.source.kind === "player") {
      const pId = entry.source.playerId;
      const flow = cashFlows[pId];
      if (flow === undefined) {
        throw new Error(
          `Simulation invariant failed: unknown source player ${pId} in settlement journal`,
        );
      }
      if (entry.reason === "loan-payment") {
        if (!entry.loanPayment)
          throw new Error("Missing player loan payment breakdown");
        flow.playerLoanPrincipalPaidCents = safeAdd(
          flow.playerLoanPrincipalPaidCents,
          entry.loanPayment.principalCents,
        );
        flow.playerLoanInterestPaidCents = safeAdd(
          flow.playerLoanInterestPaidCents,
          entry.loanPayment.interestCents,
        );
      } else if (
        entry.reason === "recurring-living-expense" ||
        entry.reason === "living-expense-arrears-payment"
      ) {
        flow.livingExpensesPaidCents = safeAdd(
          flow.livingExpensesPaidCents,
          entry.amountCents,
          "livingExpensesPaidCents",
        );
      } else if (
        entry.reason === "legacy-personal-debt-payment" ||
        entry.reason === "legacy-mortgage-payment"
      ) {
        if (entry.loanPayment === undefined) {
          throw new Error(
            `Simulation invariant failed: missing structured loanPayment metadata on loan payment journal entry for ${pId}`,
          );
        }
        flow.legacyPrincipalPaidCents = safeAdd(
          flow.legacyPrincipalPaidCents,
          entry.loanPayment.principalCents,
          "legacyPrincipalPaidCents",
        );
        flow.legacyInterestPaidCents = safeAdd(
          flow.legacyInterestPaidCents,
          entry.loanPayment.interestCents,
          "legacyInterestPaidCents",
        );
      }
    }
  }
}

interface ProfileAccumulator {
  workCompensationReceived: number[];
  playerLoanPrincipalReceived: number[];
  playerLoanInterestReceived: number[];
  playerLoanPrincipalPaid: number[];
  playerLoanInterestPaid: number[];
  exposures: number;
  openingCash: number[];
  endingCash: number[];
  minimumCash: number[];
  openingPublicMarketValue: number[];
  endingPublicMarketValue: number[];
  openingLiquidCapital: number[];
  endingLiquidCapital: number[];
  openingLegacyDebt: number[];
  endingLegacyDebt: number[];
  openingLiquidNetPosition: number[];
  endingLiquidNetPosition: number[];
  cashYieldReceived: number[];
  publicMarketDividendsReceived: number[];
  recurringIncomeReceived: number[];
  propertyDistributionsReceived: number[];
  businessDistributionsReceived: number[];
  livingExpensesPaid: number[];
  legacyPrincipalPaid: number[];
  legacyInterestPaid: number[];
}

function summarizeInts(values: readonly number[]): IntSummary {
  const first = values[0];
  if (values.length === 0 || first === undefined) {
    return { sum: 0, roundedAverage: 0, min: 0, max: 0 };
  }
  let sum = 0;
  let min = first;
  let max = first;
  for (const v of values) {
    sum = safeAdd(sum, v, "summarizeInts sum");
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    sum,
    roundedAverage: roundedAverage(sum, values.length),
    min,
    max,
  };
}

function summarizeCashFlow(values: readonly number[]): CashFlowSummary {
  if (values.length === 0) {
    return { sum: 0, roundedAverage: 0 };
  }
  let sum = 0;
  for (const v of values) {
    sum = safeAdd(sum, v, "summarizeCashFlow sum");
  }
  return {
    sum,
    roundedAverage: roundedAverage(sum, values.length),
  };
}

export function aggregateBatchReport(
  config: BaselineSimulationConfig,
  results: readonly PassiveBaselineGameResult[],
  simulationVersion: string = SIMULATION_VERSION,
  engineVersion: string = ENGINE_VERSION,
): BaselineSimulationReport {
  const finance = {
    endingBalances: emptyFinanceBalances(),
    bankPrincipalPaidCents: 0,
    bankInterestPaidCents: 0,
    operatingCostsPaidCents: 0,
    missedLoanPayments: 0,
    curedClaims: 0,
    retainedFromSurplusCents: 0,
  };
  let completedHorizon = 0;
  let withFailure = 0;
  let totalSettledQuarters = 0;
  const settlementFailuresByCode: Record<string, number> = {};
  const settlementFailuresByQuarter: Record<number, number> = {};

  const profileAccumulators: Record<ProfileId, ProfileAccumulator> =
    {} as Record<ProfileId, ProfileAccumulator>;
  for (const pid of PROFILE_IDS) {
    profileAccumulators[pid] = {
      workCompensationReceived: [],
      playerLoanPrincipalReceived: [],
      playerLoanInterestReceived: [],
      playerLoanPrincipalPaid: [],
      playerLoanInterestPaid: [],
      exposures: 0,
      openingCash: [],
      endingCash: [],
      minimumCash: [],
      openingPublicMarketValue: [],
      endingPublicMarketValue: [],
      openingLiquidCapital: [],
      endingLiquidCapital: [],
      openingLegacyDebt: [],
      endingLegacyDebt: [],
      openingLiquidNetPosition: [],
      endingLiquidNetPosition: [],
      cashYieldReceived: [],
      publicMarketDividendsReceived: [],
      recurringIncomeReceived: [],
      propertyDistributionsReceived: [],
      businessDistributionsReceived: [],
      livingExpensesPaid: [],
      legacyPrincipalPaid: [],
      legacyInterestPaid: [],
    };
  }

  const regimeOccupancy: Record<EconomicRegimeId, number> = {
    expansion: 0,
    overheating: 0,
    slowdown: 0,
    recession: 0,
    recovery: 0,
  };

  const transitions: Record<
    EconomicRegimeId,
    Record<EconomicRegimeId, number>
  > = {
    expansion: {
      expansion: 0,
      overheating: 0,
      slowdown: 0,
      recession: 0,
      recovery: 0,
    },
    overheating: {
      expansion: 0,
      overheating: 0,
      slowdown: 0,
      recession: 0,
      recovery: 0,
    },
    slowdown: {
      expansion: 0,
      overheating: 0,
      slowdown: 0,
      recession: 0,
      recovery: 0,
    },
    recession: {
      expansion: 0,
      overheating: 0,
      slowdown: 0,
      recession: 0,
      recovery: 0,
    },
    recovery: {
      expansion: 0,
      overheating: 0,
      slowdown: 0,
      recession: 0,
      recovery: 0,
    },
  };

  const instrumentReturnsRaw: Record<PublicMarketInstrumentId, number[]> = {
    "broad-market-fund": [],
    "growth-fund": [],
    "income-defensive-fund": [],
  };

  for (const game of results) {
    const ending = game.finalFinanceBalances;
    for (const key of Object.keys(
      ending,
    ) as (keyof SimulationFinanceBalances)[]) {
      finance.endingBalances[key] = safeAdd(
        finance.endingBalances[key],
        ending[key],
      );
    }
    for (const trace of game.quarterTraces) {
      finance.missedLoanPayments = safeAdd(
        finance.missedLoanPayments,
        trace.finance.missedLoanPayments,
      );
      finance.curedClaims = safeAdd(
        finance.curedClaims,
        trace.finance.curedClaims,
      );
      finance.bankPrincipalPaidCents = safeAdd(
        finance.bankPrincipalPaidCents,
        trace.finance.bankPrincipalPaidCents,
      );
      finance.bankInterestPaidCents = safeAdd(
        finance.bankInterestPaidCents,
        trace.finance.bankInterestPaidCents,
      );
      finance.operatingCostsPaidCents = safeAdd(
        finance.operatingCostsPaidCents,
        trace.finance.operatingCostsPaidCents,
      );
      finance.retainedFromSurplusCents = safeAdd(
        finance.retainedFromSurplusCents,
        trace.finance.retainedFromSurplusCents,
      );
    }
    totalSettledQuarters = safeAdd(
      totalSettledQuarters,
      game.completedQuarters,
      "totalSettledQuarters",
    );
    if (game.failure === null) {
      completedHorizon = safeAdd(completedHorizon, 1, "completedHorizon");
    } else {
      withFailure = safeAdd(withFailure, 1, "withFailure");
      const { code, quarter } = game.failure;
      settlementFailuresByCode[code] = safeAdd(
        settlementFailuresByCode[code] ?? 0,
        1,
        "failuresByCode",
      );
      settlementFailuresByQuarter[quarter] = safeAdd(
        settlementFailuresByQuarter[quarter] ?? 0,
        1,
        "failuresByQuarter",
      );
    }

    const openingPlayerIds = Object.keys(game.openingPlayers) as PlayerId[];
    if (openingPlayerIds.length !== STANDARD_V1_PLAYER_COUNT) {
      throw new Error(
        `Simulation invariant failed: game ${game.gameId} expected exactly ${STANDARD_V1_PLAYER_COUNT} opening players, got ${openingPlayerIds.length}`,
      );
    }

    const finalPlayerIds = Object.keys(game.finalPlayers) as PlayerId[];
    if (finalPlayerIds.length !== STANDARD_V1_PLAYER_COUNT) {
      throw new Error(
        `Simulation invariant failed: game ${game.gameId} expected exactly ${STANDARD_V1_PLAYER_COUNT} final players, got ${finalPlayerIds.length}`,
      );
    }

    const cashFlowPlayerIds = Object.keys(game.playerCashFlows) as PlayerId[];
    if (cashFlowPlayerIds.length !== STANDARD_V1_PLAYER_COUNT) {
      throw new Error(
        `Simulation invariant failed: game ${game.gameId} expected exactly ${STANDARD_V1_PLAYER_COUNT} player cash flow records, got ${cashFlowPlayerIds.length}`,
      );
    }

    const liquidityPlayerIds = Object.keys(game.playerLiquidity) as PlayerId[];
    if (liquidityPlayerIds.length !== STANDARD_V1_PLAYER_COUNT) {
      throw new Error(
        `Simulation invariant failed: game ${game.gameId} expected exactly ${STANDARD_V1_PLAYER_COUNT} player liquidity records, got ${liquidityPlayerIds.length}`,
      );
    }

    for (const pId of openingPlayerIds) {
      const open = game.openingPlayers[pId];
      const final = game.finalPlayers[pId];
      const flow = game.playerCashFlows[pId];
      const liq = game.playerLiquidity[pId];

      if (
        open === undefined ||
        final === undefined ||
        flow === undefined ||
        liq === undefined
      ) {
        throw new Error(
          `Simulation invariant failed: missing player measurement data for player ${pId} in game ${game.gameId}`,
        );
      }

      const acc = profileAccumulators[open.profileId];
      if (acc === undefined) {
        throw new Error(
          `Simulation invariant failed: unknown profile ID ${open.profileId} for player ${pId} in game ${game.gameId}`,
        );
      }

      acc.exposures = safeAdd(acc.exposures, 1, "profile exposures");
      acc.openingCash.push(open.cashCents);
      acc.endingCash.push(final.cashCents);
      acc.minimumCash.push(liq.minimumCashCents);
      acc.openingPublicMarketValue.push(open.publicMarketValueCents);
      acc.endingPublicMarketValue.push(final.publicMarketValueCents);
      acc.openingLiquidCapital.push(open.liquidCapitalCents);
      acc.endingLiquidCapital.push(final.liquidCapitalCents);
      acc.openingLegacyDebt.push(open.legacyBankDebtCents);
      acc.endingLegacyDebt.push(final.legacyBankDebtCents);
      acc.openingLiquidNetPosition.push(open.liquidNetPositionCents);
      acc.endingLiquidNetPosition.push(final.liquidNetPositionCents);

      acc.workCompensationReceived.push(flow.workCompensationReceivedCents);
      acc.playerLoanPrincipalReceived.push(
        flow.playerLoanPrincipalReceivedCents,
      );
      acc.playerLoanInterestReceived.push(flow.playerLoanInterestReceivedCents);
      acc.playerLoanPrincipalPaid.push(flow.playerLoanPrincipalPaidCents);
      acc.playerLoanInterestPaid.push(flow.playerLoanInterestPaidCents);
      acc.cashYieldReceived.push(flow.cashYieldReceivedCents);
      acc.publicMarketDividendsReceived.push(
        flow.publicMarketDividendsReceivedCents,
      );
      acc.recurringIncomeReceived.push(flow.recurringIncomeReceivedCents);
      acc.businessDistributionsReceived.push(
        flow.businessDistributionsReceivedCents,
      );
      acc.propertyDistributionsReceived.push(
        flow.propertyDistributionsReceivedCents,
      );
      acc.livingExpensesPaid.push(flow.livingExpensesPaidCents);
      acc.legacyPrincipalPaid.push(flow.legacyPrincipalPaidCents);
      acc.legacyInterestPaid.push(flow.legacyInterestPaidCents);
    }

    for (const trace of game.quarterTraces) {
      if (!ECONOMIC_REGIME_IDS.includes(trace.regimeUsed)) {
        throw new Error(
          `Simulation invariant failed: invalid regimeUsed ${String(trace.regimeUsed)} in game ${game.gameId}`,
        );
      }
      if (!ECONOMIC_REGIME_IDS.includes(trace.nextRegime)) {
        throw new Error(
          `Simulation invariant failed: invalid nextRegime ${String(trace.nextRegime)} in game ${game.gameId}`,
        );
      }

      regimeOccupancy[trace.regimeUsed] = safeAdd(
        regimeOccupancy[trace.regimeUsed],
        1,
        "regimeOccupancy",
      );

      transitions[trace.regimeUsed][trace.nextRegime] = safeAdd(
        transitions[trace.regimeUsed][trace.nextRegime],
        1,
        "transitions",
      );

      for (const instId of PUBLIC_MARKET_INSTRUMENT_IDS) {
        const bps = trace.returnBpsByInstrument[instId];
        if (bps === undefined || !Number.isSafeInteger(bps)) {
          throw new Error(
            `Simulation invariant failed: missing or non-safe integer returnBps for ${instId} in game ${game.gameId} quarter ${trace.quarter}`,
          );
        }
        instrumentReturnsRaw[instId].push(bps);
      }
    }
  }

  const profileMetrics: Record<ProfileId, ProfileAggregateMetrics> =
    {} as Record<ProfileId, ProfileAggregateMetrics>;
  for (const pid of PROFILE_IDS) {
    const acc = profileAccumulators[pid];
    profileMetrics[pid] = {
      profileId: pid,
      exposures: acc.exposures,
      openingCashCents: summarizeInts(acc.openingCash),
      endingCashCents: summarizeInts(acc.endingCash),
      minimumCashCents: summarizeInts(acc.minimumCash),
      openingPublicMarketValueCents: summarizeInts(
        acc.openingPublicMarketValue,
      ),
      endingPublicMarketValueCents: summarizeInts(acc.endingPublicMarketValue),
      openingLiquidCapitalCents: summarizeInts(acc.openingLiquidCapital),
      endingLiquidCapitalCents: summarizeInts(acc.endingLiquidCapital),
      openingLegacyDebtCents: summarizeInts(acc.openingLegacyDebt),
      endingLegacyDebtCents: summarizeInts(acc.endingLegacyDebt),
      openingLiquidNetPositionCents: summarizeInts(
        acc.openingLiquidNetPosition,
      ),
      endingLiquidNetPositionCents: summarizeInts(acc.endingLiquidNetPosition),
      cashFlows: {
        workCompensationReceivedCents: summarizeCashFlow(
          acc.workCompensationReceived,
        ),
        playerLoanPrincipalReceivedCents: summarizeCashFlow(
          acc.playerLoanPrincipalReceived,
        ),
        playerLoanInterestReceivedCents: summarizeCashFlow(
          acc.playerLoanInterestReceived,
        ),
        playerLoanPrincipalPaidCents: summarizeCashFlow(
          acc.playerLoanPrincipalPaid,
        ),
        playerLoanInterestPaidCents: summarizeCashFlow(
          acc.playerLoanInterestPaid,
        ),
        cashYieldReceivedCents: summarizeCashFlow(acc.cashYieldReceived),
        publicMarketDividendsReceivedCents: summarizeCashFlow(
          acc.publicMarketDividendsReceived,
        ),
        recurringIncomeReceivedCents: summarizeCashFlow(
          acc.recurringIncomeReceived,
        ),
        businessDistributionsReceivedCents: summarizeCashFlow(
          acc.businessDistributionsReceived,
        ),
        propertyDistributionsReceivedCents: summarizeCashFlow(
          acc.propertyDistributionsReceived,
        ),
        livingExpensesPaidCents: summarizeCashFlow(acc.livingExpensesPaid),
        legacyPrincipalPaidCents: summarizeCashFlow(acc.legacyPrincipalPaid),
        legacyInterestPaidCents: summarizeCashFlow(acc.legacyInterestPaid),
      },
    };
  }

  const marketReturns: Record<
    PublicMarketInstrumentId,
    MarketInstrumentReturnStatistics
  > = {} as Record<PublicMarketInstrumentId, MarketInstrumentReturnStatistics>;

  for (const instId of PUBLIC_MARKET_INSTRUMENT_IDS) {
    const raw = instrumentReturnsRaw[instId];
    const first = raw[0];
    if (raw.length === 0 || first === undefined) {
      marketReturns[instId] = {
        count: 0,
        sumBps: 0,
        roundedAverageBps: 0,
        minimumBps: 0,
        maximumBps: 0,
      };
    } else {
      let sum = 0;
      let count = 0;
      let min = first;
      let max = first;
      for (const bps of raw) {
        sum = safeAdd(sum, bps, "marketReturnSum");
        count = safeAdd(count, 1, "marketReturnCount");
        if (bps < min) min = bps;
        if (bps > max) max = bps;
      }
      marketReturns[instId] = {
        count,
        sumBps: sum,
        roundedAverageBps: roundedAverage(sum, count),
        minimumBps: min,
        maximumBps: max,
      };
    }
  }

  const totals: BaselineSimulationTotals = {
    gamesRequested: config.gameCount,
    gamesCompletedHorizon: completedHorizon,
    gamesWithSettlementFailure: withFailure,
    totalSettledQuarters,
    settlementFailuresByCode: settlementFailuresByCode as Record<
      SettleQuarterErrorCode,
      number
    >,
    settlementFailuresByQuarter,
  };

  const economy: BaselineSimulationEconomyReport = {
    regimeOccupancy,
    transitions,
  };

  return {
    scenario: BASELINE_SCENARIO_NAME,
    config,
    simulationVersion,
    engineVersion,
    workspaceCompatibility: WORKSPACE_COMPATIBILITY,
    totals,
    profileMetrics,
    finance,
    economy,
    marketReturns,
  };
}

export function emptyFinanceBalances(): SimulationFinanceBalances {
  return {
    livingArrearsCents: 0,
    operatingArrearsCents: 0,
    workArrearsCents: 0,
    unpaidInterestCents: 0,
    pastDuePrincipalCents: 0,
    companyCashCents: 0,
    companyPrincipalCents: 0,
    companyEquityCents: 0,
  };
}

/** Counts claim cures per living account, company operating/work account, or loan. */
export function observeFinance(
  before: GameState,
  after: GameState,
): SimulationFinanceObservation {
  const balances = emptyFinanceBalances();
  let curedClaims = 0;
  const add = (key: keyof SimulationFinanceBalances, value: number) => {
    balances[key] = safeAdd(balances[key], value, key);
  };
  const cured = (old: number, current: number) => {
    if (old > 0 && current === 0) curedClaims++;
  };
  for (const id of after.playerOrder) {
    const current = after.finance.livingArrearsByPlayer[id] ?? 0;
    add("livingArrearsCents", current);
    cured(before.finance.livingArrearsByPlayer[id] ?? 0, current);
  }
  for (const loan of Object.values(after.finance.loansById)) {
    add("unpaidInterestCents", loan.unpaidInterestCents);
    add("pastDuePrincipalCents", loan.pastDuePrincipalCents);
    if (loan.kind === "company-loan" || loan.kind === "asset-bank-loan")
      add("companyPrincipalCents", loan.outstandingPrincipalCents);
    const old = before.finance.loansById[loan.id];
    if (old)
      cured(
        safeAdd(old.unpaidInterestCents, old.pastDuePrincipalCents),
        safeAdd(loan.unpaidInterestCents, loan.pastDuePrincipalCents),
      );
  }
  for (const asset of Object.values(after.finance.assetsById)) {
    if (asset.kind !== "business") continue;
    add("companyCashCents", asset.cashCents);
    add(
      "companyEquityCents",
      calculateBusinessEquity(asset, after.finance.loansById).equityValueCents,
    );
    add("operatingArrearsCents", asset.operatingArrearsCents);
    add("workArrearsCents", asset.workCompensation?.arrearsCents ?? 0);
    const old = before.finance.assetsById[asset.id];
    if (old?.kind === "business") {
      cured(old.operatingArrearsCents, asset.operatingArrearsCents);
      cured(
        old.workCompensation?.arrearsCents ?? 0,
        asset.workCompensation?.arrearsCents ?? 0,
      );
    }
  }
  const outcome = after.finance.lastSettlement;
  return {
    balances,
    curedClaims,
    bankPrincipalPaidCents:
      outcome?.loanPayments
        .filter((p) => p.lenderPlayerId === null)
        .reduce((sum, p) => safeAdd(sum, p.principalPaidCents), 0) ?? 0,
    bankInterestPaidCents:
      outcome?.loanPayments
        .filter((p) => p.lenderPlayerId === null)
        .reduce((sum, p) => safeAdd(sum, p.interestPaidCents), 0) ?? 0,
    operatingCostsPaidCents:
      outcome?.businesses.reduce(
        (sum, b) => safeAdd(sum, b.operatingPaidCents),
        0,
      ) ?? 0,
    missedLoanPayments:
      outcome?.loanPayments.filter((p) => p.paidCents < p.dueCents).length ?? 0,
    retainedFromSurplusCents:
      outcome?.businesses.reduce(
        (sum, b) => safeAdd(sum, b.retainedFromSurplusCents),
        0,
      ) ?? 0,
  };
}
