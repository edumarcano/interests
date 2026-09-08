import {
  applyAction,
  createGame,
  ENGINE_VERSION,
  type GameState,
  settleQuarter,
  totalPublicMarketValueCents,
} from "@interests/engine";
import {
  asGameId,
  asPlayerId,
  type GameId,
  type PlayerId,
} from "@interests/shared";

import {
  aggregateBatchReport,
  applySettlementJournalToCashFlows,
  createPlayerSnapshot,
  createZeroPlayerCashFlow,
  safeAdd,
} from "./metrics";
import { createSimulationSeed } from "./seed";
import type {
  BaselineSimulationConfig,
  BaselineSimulationReport,
  PassiveBaselineGameResult,
  SimulationPlayerCashFlow,
  SimulationPlayerLiquidity,
  SimulationQuarterPlayerTrace,
  SimulationQuarterTrace,
  SimulationSettlementFailure,
} from "./types";
import { SIMULATION_VERSION } from "./version";

export { SIMULATION_VERSION };

export const STANDARD_SIMULATION_PLAYER_IDS: readonly PlayerId[] = [
  asPlayerId("simulation-player-1"),
  asPlayerId("simulation-player-2"),
  asPlayerId("simulation-player-3"),
  asPlayerId("simulation-player-4"),
] as const;

export const DEFAULT_BASELINE_GAMES = 1000;
export const DEFAULT_BASELINE_QUARTERS = 20;

export function validateBaselineSimulationConfig(
  config: unknown,
): asserts config is BaselineSimulationConfig {
  if (typeof config !== "object" || config === null) {
    throw new TypeError("BaselineSimulationConfig must be a non-null object");
  }

  const { gameCount, quarterCount, seedPrefix } =
    config as Partial<BaselineSimulationConfig>;

  if (
    typeof gameCount !== "number" ||
    !Number.isSafeInteger(gameCount) ||
    gameCount <= 0
  ) {
    throw new RangeError(
      `gameCount must be a positive safe integer, got ${String(gameCount)}`,
    );
  }

  if (
    typeof quarterCount !== "number" ||
    !Number.isSafeInteger(quarterCount) ||
    quarterCount <= 0
  ) {
    throw new RangeError(
      `quarterCount must be a positive safe integer, got ${String(quarterCount)}`,
    );
  }

  if (typeof seedPrefix !== "string" || seedPrefix.trim() === "") {
    throw new TypeError(
      `seedPrefix must be a non-empty string, got ${JSON.stringify(seedPrefix)}`,
    );
  }
}

/**
 * Completes the objective selection phase using the approved passive baseline policy:
 * selects the first offered objective (offeredObjectiveIds[0]) for each player
 * in canonical playerOrder through the real engine applyAction API.
 */
export function completePassiveBaselineSetup(state: GameState): GameState {
  let currentState = state;

  for (const playerId of currentState.playerOrder) {
    const player = currentState.players[playerId];
    if (player === undefined) {
      throw new Error(
        `Passive baseline setup failed: missing player ${playerId}`,
      );
    }

    const firstObjectiveId = player.offeredObjectiveIds[0];
    const actionResult = applyAction(currentState, {
      type: "CHOOSE_OBJECTIVE",
      playerId,
      objectiveId: firstObjectiveId,
    });

    if (!actionResult.ok) {
      throw new Error(
        `Passive baseline setup action rejected for player ${playerId}: ${actionResult.code}`,
      );
    }

    currentState = actionResult.state;
  }

  if (currentState.phase !== "ready-for-first-round") {
    throw new Error(
      `Passive baseline setup invariant failed: expected phase 'ready-for-first-round', got '${currentState.phase}'`,
    );
  }

  for (const playerId of currentState.playerOrder) {
    const player = currentState.players[playerId];
    if (player?.selectedObjectiveId === null) {
      throw new Error(
        `Passive baseline setup invariant failed: player ${playerId} has no selected objective`,
      );
    }
  }

  return currentState;
}

/**
 * Runs a ready game through sequential quarter settlements up to quarterCount
 * or until the engine returns a settlement rejection.
 */
export function simulateReadyGame(
  state: GameState,
  quarterCount: number,
  metadata?: { gameId?: GameId; seed?: string },
): PassiveBaselineGameResult {
  if (!Number.isSafeInteger(quarterCount) || quarterCount <= 0) {
    throw new RangeError(
      `quarterCount must be a positive safe integer, got ${String(quarterCount)}`,
    );
  }

  const openingPlayers: Record<
    PlayerId,
    ReturnType<typeof createPlayerSnapshot>
  > = {} as Record<PlayerId, ReturnType<typeof createPlayerSnapshot>>;
  const playerCashFlows: Record<PlayerId, SimulationPlayerCashFlow> =
    {} as Record<PlayerId, SimulationPlayerCashFlow>;
  const playerLiquidity: Record<PlayerId, SimulationPlayerLiquidity> =
    {} as Record<PlayerId, SimulationPlayerLiquidity>;

  for (const pId of state.playerOrder) {
    const snap = createPlayerSnapshot(state, pId);
    openingPlayers[pId] = snap;
    playerCashFlows[pId] = createZeroPlayerCashFlow();
    playerLiquidity[pId] = {
      minimumCashCents: snap.cashCents,
      minimumCashQuarter: 0,
    };
  }

  const quarterTraces: SimulationQuarterTrace[] = [];
  let failure: SimulationSettlementFailure | null = null;
  let currentState = state;

  const startQuarter = state.currentQuarter;
  const targetQuarter = startQuarter + quarterCount - 1;

  for (let q = startQuarter; q <= targetQuarter; q++) {
    const settleResult = settleQuarter(currentState, { quarter: q });

    if (!settleResult.ok) {
      failure = {
        quarter: q,
        code: settleResult.code,
      };
      break;
    }

    currentState = settleResult.state;
    applySettlementJournalToCashFlows(
      playerCashFlows,
      settleResult.journalEntries,
    );

    const playerTraces: Record<PlayerId, SimulationQuarterPlayerTrace> =
      {} as Record<PlayerId, SimulationQuarterPlayerTrace>;

    for (const pId of currentState.playerOrder) {
      const closingCash = currentState.finance.cashByPlayer[pId];
      if (closingCash === undefined) {
        throw new Error(
          `Simulation invariant failed: missing cash for player ${pId}`,
        );
      }

      const liq = playerLiquidity[pId];
      if (liq !== undefined && closingCash < liq.minimumCashCents) {
        playerLiquidity[pId] = {
          minimumCashCents: closingCash,
          minimumCashQuarter: q,
        };
      }

      const portfolio = currentState.finance.publicMarketsByPlayer[pId];
      if (portfolio === undefined) {
        throw new Error(
          `Simulation invariant failed: missing portfolio for player ${pId}`,
        );
      }
      const publicMarketValueCents = totalPublicMarketValueCents(portfolio);

      let legacyBankDebtCents = 0;
      for (const loan of Object.values(currentState.finance.loansById)) {
        if (loan.kind === "legacy-bank-loan" && loan.borrowerPlayerId === pId) {
          legacyBankDebtCents = safeAdd(
            legacyBankDebtCents,
            loan.outstandingPrincipalCents,
            "legacyBankDebtCents trace",
          );
        }
      }

      playerTraces[pId] = {
        cashCents: closingCash,
        publicMarketValueCents,
        legacyBankDebtCents,
      };
    }

    const lastMarketUpdate = currentState.economy.lastMarketUpdate;
    if (lastMarketUpdate === null) {
      throw new Error(
        `Simulation invariant failed: missing lastMarketUpdate after quarter ${q} settlement`,
      );
    }

    quarterTraces.push({
      quarter: q,
      regimeUsed: lastMarketUpdate.regimeUsed,
      nextRegime: currentState.economy.currentRegime,
      returnBpsByInstrument: lastMarketUpdate.returnBpsByInstrument,
      players: playerTraces,
    });
  }

  const finalPlayers: Record<
    PlayerId,
    ReturnType<typeof createPlayerSnapshot>
  > = {} as Record<PlayerId, ReturnType<typeof createPlayerSnapshot>>;
  for (const pId of currentState.playerOrder) {
    finalPlayers[pId] = createPlayerSnapshot(currentState, pId);
  }

  const completedQuarters = quarterTraces.length;

  return {
    gameId: metadata?.gameId ?? currentState.gameId,
    seed: metadata?.seed ?? "",
    completedQuarters,
    failure,
    openingPlayers,
    finalPlayers,
    playerCashFlows,
    playerLiquidity,
    quarterTraces,
  };
}

export interface RunPassiveBaselineGameInput {
  readonly seed: string;
  readonly gameId: string;
  readonly quarterCount: number;
  readonly playerIds?: readonly PlayerId[];
}

/**
 * Runs a complete single passive baseline game:
 * 1. Creates game via authoritative engine createGame();
 * 2. Completes passive objective selection via engine applyAction();
 * 3. Settles quarters sequentially via engine settleQuarter();
 * 4. Returns typed deterministic result.
 */
export function runPassiveBaselineGame(
  input: RunPassiveBaselineGameInput,
): PassiveBaselineGameResult {
  const playerIds = input.playerIds ?? STANDARD_SIMULATION_PLAYER_IDS;
  const initialState = createGame({
    gameId: input.gameId,
    seed: input.seed,
    playerIds,
  });

  const readyState = completePassiveBaselineSetup(initialState);

  return simulateReadyGame(readyState, input.quarterCount, {
    gameId: asGameId(input.gameId),
    seed: input.seed,
  });
}

/**
 * Runs a deterministic sequential batch of passive baseline games and aggregates
 * the results into a compact canonical JSON report.
 */
export function runPassiveBaselineBatch(
  config: BaselineSimulationConfig,
): BaselineSimulationReport {
  validateBaselineSimulationConfig(config);

  const results: PassiveBaselineGameResult[] = [];

  for (let i = 0; i < config.gameCount; i++) {
    const seed = createSimulationSeed(config.seedPrefix, i);
    const gameId = `${config.seedPrefix}-game-${String(i).padStart(6, "0")}`;

    const gameResult = runPassiveBaselineGame({
      seed,
      gameId,
      quarterCount: config.quarterCount,
    });

    results.push(gameResult);
  }

  return aggregateBatchReport(
    config,
    results,
    SIMULATION_VERSION,
    ENGINE_VERSION,
  );
}
