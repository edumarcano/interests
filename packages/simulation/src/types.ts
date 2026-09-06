import type {
  SettleQuarterErrorCode,
  WORKSPACE_COMPATIBILITY,
} from "@finance-game/engine";
import type {
  EconomicRegimeId,
  ObjectiveId,
  ProfileId,
  PublicMarketInstrumentId,
} from "@finance-game/rules";
import type { GameId, PlayerId } from "@finance-game/shared";

export const BASELINE_SCENARIO_NAME = "passive-baseline-v1" as const;

export interface BaselineSimulationConfig {
  readonly gameCount: number;
  readonly quarterCount: number;
  readonly seedPrefix: string;
}

export interface SimulationPlayerSnapshot {
  readonly playerId: PlayerId;
  readonly profileId: ProfileId;
  readonly selectedObjectiveId: ObjectiveId | null;
  readonly cashCents: number;
  readonly publicMarketValueCents: number;
  readonly liquidCapitalCents: number;
  readonly legacyBankDebtCents: number;
  readonly playerLoanDebtCents: number;
  readonly playerLoanReceivableCents: number;
  readonly liquidNetPositionCents: number;
}

export interface SimulationPlayerCashFlow {
  cashYieldReceivedCents: number;
  publicMarketDividendsReceivedCents: number;
  recurringIncomeReceivedCents: number;
  propertyDistributionsReceivedCents: number;
  livingExpensesPaidCents: number;
  legacyPrincipalPaidCents: number;
  legacyInterestPaidCents: number;
}

export interface SimulationPlayerLiquidity {
  readonly minimumCashCents: number;
  readonly minimumCashQuarter: number;
}

export interface SimulationQuarterPlayerTrace {
  readonly cashCents: number;
  readonly publicMarketValueCents: number;
  readonly legacyBankDebtCents: number;
}

export interface SimulationQuarterTrace {
  readonly quarter: number;
  readonly regimeUsed: EconomicRegimeId;
  readonly nextRegime: EconomicRegimeId;
  readonly returnBpsByInstrument: Readonly<
    Record<PublicMarketInstrumentId, number>
  >;
  readonly players: Readonly<Record<PlayerId, SimulationQuarterPlayerTrace>>;
}

export interface SimulationSettlementFailure {
  readonly quarter: number;
  readonly code: SettleQuarterErrorCode;
}

export interface PassiveBaselineGameResult {
  readonly gameId: GameId;
  readonly seed: string;
  readonly completedQuarters: number;
  readonly failure: SimulationSettlementFailure | null;
  readonly openingPlayers: Readonly<Record<PlayerId, SimulationPlayerSnapshot>>;
  readonly finalPlayers: Readonly<Record<PlayerId, SimulationPlayerSnapshot>>;
  readonly playerCashFlows: Readonly<
    Record<PlayerId, SimulationPlayerCashFlow>
  >;
  readonly playerLiquidity: Readonly<
    Record<PlayerId, SimulationPlayerLiquidity>
  >;
  readonly quarterTraces: readonly SimulationQuarterTrace[];
}

export interface IntSummary {
  readonly sum: number;
  readonly roundedAverage: number;
  readonly min: number;
  readonly max: number;
}

export interface CashFlowSummary {
  readonly sum: number;
  readonly roundedAverage: number;
}

export interface ProfileAggregateMetrics {
  readonly profileId: ProfileId;
  readonly exposures: number;
  readonly openingCashCents: IntSummary;
  readonly endingCashCents: IntSummary;
  readonly minimumCashCents: IntSummary;
  readonly openingPublicMarketValueCents: IntSummary;
  readonly endingPublicMarketValueCents: IntSummary;
  readonly openingLiquidCapitalCents: IntSummary;
  readonly endingLiquidCapitalCents: IntSummary;
  readonly openingLegacyDebtCents: IntSummary;
  readonly endingLegacyDebtCents: IntSummary;
  readonly openingLiquidNetPositionCents: IntSummary;
  readonly endingLiquidNetPositionCents: IntSummary;
  readonly cashFlows: {
    readonly cashYieldReceivedCents: CashFlowSummary;
    readonly publicMarketDividendsReceivedCents: CashFlowSummary;
    readonly recurringIncomeReceivedCents: CashFlowSummary;
    readonly propertyDistributionsReceivedCents: CashFlowSummary;
    readonly livingExpensesPaidCents: CashFlowSummary;
    readonly legacyPrincipalPaidCents: CashFlowSummary;
    readonly legacyInterestPaidCents: CashFlowSummary;
  };
}

export interface MarketInstrumentReturnStatistics {
  readonly count: number;
  readonly sumBps: number;
  readonly roundedAverageBps: number;
  readonly minimumBps: number;
  readonly maximumBps: number;
}

export interface BaselineSimulationTotals {
  readonly gamesRequested: number;
  readonly gamesCompletedHorizon: number;
  readonly gamesWithSettlementFailure: number;
  readonly totalSettledQuarters: number;
  readonly settlementFailuresByCode: Readonly<
    Record<SettleQuarterErrorCode, number>
  >;
  readonly settlementFailuresByQuarter: Readonly<Record<number, number>>;
}

export interface BaselineSimulationEconomyReport {
  readonly regimeOccupancy: Readonly<Record<EconomicRegimeId, number>>;
  readonly transitions: Readonly<
    Record<EconomicRegimeId, Readonly<Record<EconomicRegimeId, number>>>
  >;
}

export interface BaselineSimulationReport {
  readonly scenario: typeof BASELINE_SCENARIO_NAME;
  readonly config: BaselineSimulationConfig;
  readonly simulationVersion: string;
  readonly engineVersion: string;
  readonly workspaceCompatibility: typeof WORKSPACE_COMPATIBILITY;
  readonly totals: BaselineSimulationTotals;
  readonly profileMetrics: Readonly<Record<ProfileId, ProfileAggregateMetrics>>;
  readonly economy: BaselineSimulationEconomyReport;
  readonly marketReturns: Readonly<
    Record<PublicMarketInstrumentId, MarketInstrumentReturnStatistics>
  >;
}
