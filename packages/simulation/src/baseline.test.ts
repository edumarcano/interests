import {
  applyAction,
  createGame,
  ENGINE_VERSION,
  settleQuarter,
  totalPublicMarketValueCents,
} from "@finance-game/engine";
import {
  ECONOMIC_REGIME_IDS,
  PROFILE_IDS,
  PUBLIC_MARKET_INSTRUMENT_IDS,
} from "@finance-game/rules";
import type { PlayerId } from "@finance-game/shared";
import { describe, expect, it } from "vitest";

import {
  completePassiveBaselineSetup,
  runPassiveBaselineBatch,
  runPassiveBaselineGame,
  STANDARD_SIMULATION_PLAYER_IDS,
  simulateReadyGame,
} from "./baseline";
import { aggregateBatchReport } from "./metrics";
import type { BaselineSimulationConfig } from "./types";
import { SIMULATION_VERSION } from "./version";

describe("passive baseline simulation", () => {
  describe("setup policy (Section 29)", () => {
    it("selects first offered objective for all players in playerOrder via applyAction", () => {
      const seed = "test-setup-seed";
      const initialState = createGame({
        gameId: "setup-test-game",
        seed,
        playerIds: STANDARD_SIMULATION_PLAYER_IDS,
      });

      expect(initialState.phase).toBe("objective-choosing");

      const readyState = completePassiveBaselineSetup(initialState);

      expect(readyState.phase).toBe("ready-for-first-round");
      expect(readyState.revision).toBe(initialState.revision + 4);

      for (const pId of readyState.playerOrder) {
        const initialPlayer = initialState.players[pId];
        const readyPlayer = readyState.players[pId];
        expect(readyPlayer?.selectedObjectiveId).toBe(
          initialPlayer?.offeredObjectiveIds[0],
        );
      }
    });
  });

  describe("direct-engine equivalence regression (Section 27)", () => {
    it("matches direct authoritative engine state across 4 settled quarters", () => {
      const seed = "baseline-equivalence-seed-42";
      const gameId = "equiv-game";
      const quarterCount = 4;

      // 1. Run simulation harness
      const simResult = runPassiveBaselineGame({
        seed,
        gameId,
        quarterCount,
      });

      // 2. Run direct step-by-step engine calls
      let engineState = createGame({
        gameId,
        seed,
        playerIds: STANDARD_SIMULATION_PLAYER_IDS,
      });

      for (const pId of engineState.playerOrder) {
        const player = engineState.players[pId];
        expect(player).toBeDefined();
        if (!player) throw new Error(`Missing player ${pId}`);

        const actionResult = applyAction(engineState, {
          type: "CHOOSE_OBJECTIVE",
          playerId: pId,
          objectiveId: player.offeredObjectiveIds[0],
        });
        expect(actionResult.ok).toBe(true);
        engineState = actionResult.state;
      }

      for (let q = 1; q <= quarterCount; q++) {
        const settleResult = settleQuarter(engineState, { quarter: q });
        expect(settleResult.ok).toBe(true);
        engineState = settleResult.state;
      }

      // 3. Compare facts
      expect(simResult.completedQuarters).toBe(4);
      expect(simResult.failure).toBeNull();
      expect(simResult.quarterTraces.length).toBe(4);

      for (const pId of engineState.playerOrder) {
        const simFinal = simResult.finalPlayers[pId];
        const engineCash = engineState.finance.cashByPlayer[pId];
        const engineMarkets = engineState.finance.publicMarketsByPlayer[pId];
        const enginePlayer = engineState.players[pId];

        expect(simFinal).toBeDefined();
        expect(engineCash).toBeDefined();
        expect(engineMarkets).toBeDefined();
        expect(enginePlayer).toBeDefined();

        if (
          !simFinal ||
          engineCash === undefined ||
          !engineMarkets ||
          !enginePlayer
        ) {
          throw new Error(`Missing state facts for player ${pId}`);
        }

        expect(simFinal.cashCents).toBe(engineCash);
        expect(simFinal.publicMarketValueCents).toBe(
          totalPublicMarketValueCents(engineMarkets),
        );
        expect(simFinal.selectedObjectiveId).toBe(
          enginePlayer.selectedObjectiveId,
        );
      }

      const lastTrace = simResult.quarterTraces[3];
      expect(lastTrace).toBeDefined();
      if (!lastTrace) throw new Error("Missing lastTrace");

      expect(lastTrace.regimeUsed).toBe(
        engineState.economy.lastMarketUpdate?.regimeUsed,
      );
      expect(lastTrace.nextRegime).toBe(engineState.economy.currentRegime);
    });
  });

  describe("settlement failure recording (Section 31)", () => {
    it("gracefully records engine settlement failure without throwing or continuing", () => {
      const seed = "failure-test-seed";
      const state = createGame({
        gameId: "failure-game",
        seed,
        playerIds: STANDARD_SIMULATION_PLAYER_IDS,
      });
      const readyState = completePassiveBaselineSetup(state);

      // Mutate cash of player 1 to 0 and remove income to guarantee INSUFFICIENT_FUNDS on living expenses
      const p1 = readyState.playerOrder[0];
      expect(p1).toBeDefined();
      if (!p1) throw new Error("Missing player 1");

      const brokeState = {
        ...readyState,
        finance: {
          ...readyState.finance,
          cashByPlayer: {
            ...readyState.finance.cashByPlayer,
            [p1]: 0,
          },
          recurringByPlayer: {
            ...readyState.finance.recurringByPlayer,
            [p1]: {
              quarterlyIncomeCents: 0,
              quarterlyLivingExpenseCents: 500_000,
            },
          },
          quarterStartBasis: {
            ...readyState.finance.quarterStartBasis,
            cashByPlayer: {
              ...readyState.finance.quarterStartBasis.cashByPlayer,
              [p1]: 0,
            },
          },
        },
      };

      const result = simulateReadyGame(brokeState, 5);

      expect(result.completedQuarters).toBe(0);
      expect(result.failure).toEqual({
        quarter: 1,
        code: "INSUFFICIENT_FUNDS",
      });
      expect(result.quarterTraces.length).toBe(0);
      const finalP1 = result.finalPlayers[p1];
      expect(finalP1).toBeDefined();
      expect(finalP1?.cashCents).toBe(0);
    });
  });

  describe("deterministic batch equality (Section 26)", () => {
    it("produces deeply equal reports when executed twice with identical configuration", () => {
      const config: BaselineSimulationConfig = {
        gameCount: 8,
        quarterCount: 6,
        seedPrefix: "determinism-fixture",
      };

      const reportA = runPassiveBaselineBatch(config);
      const reportB = runPassiveBaselineBatch(config);

      expect(reportA).toEqual(reportB);
    });
  });

  describe("aggregate reconciliation (Section 30)", () => {
    it("reconciles all batch aggregates across profile, economy, and market metrics", () => {
      const config: BaselineSimulationConfig = {
        gameCount: 12,
        quarterCount: 8,
        seedPrefix: "reconciliation-fixture",
      };

      const report = runPassiveBaselineBatch(config);

      // 1. Completed + failed == requested
      expect(
        report.totals.gamesCompletedHorizon +
          report.totals.gamesWithSettlementFailure,
      ).toBe(config.gameCount);

      // 2. Profile exposure total == gameCount * 4
      let totalExposures = 0;
      for (const pid of PROFILE_IDS) {
        totalExposures += report.profileMetrics[pid].exposures;
      }
      expect(totalExposures).toBe(config.gameCount * 4);

      // 3. Regime occupancy total == total settled quarters
      let totalOccupancy = 0;
      for (const reg of ECONOMIC_REGIME_IDS) {
        totalOccupancy += report.economy.regimeOccupancy[reg];
      }
      expect(totalOccupancy).toBe(report.totals.totalSettledQuarters);

      // 4. Transition matrix total == total settled quarters
      let totalTransitions = 0;
      for (const fromReg of ECONOMIC_REGIME_IDS) {
        for (const toReg of ECONOMIC_REGIME_IDS) {
          totalTransitions += report.economy.transitions[fromReg][toReg];
        }
      }
      expect(totalTransitions).toBe(report.totals.totalSettledQuarters);

      // 5. Each market instrument return count == total settled quarters
      for (const instId of PUBLIC_MARKET_INSTRUMENT_IDS) {
        expect(report.marketReturns[instId].count).toBe(
          report.totals.totalSettledQuarters,
        );
      }
    });
  });

  describe("centralized version & robust metrics validation", () => {
    it("uses centralized SIMULATION_VERSION matching report metadata", () => {
      const config: BaselineSimulationConfig = {
        gameCount: 1,
        quarterCount: 1,
        seedPrefix: "version-test",
      };
      const report = runPassiveBaselineBatch(config);
      expect(report.simulationVersion).toBe(SIMULATION_VERSION);
      expect(report.engineVersion).toBe(ENGINE_VERSION);
      expect(report.workspaceCompatibility.engine).toBe(ENGINE_VERSION);
    });

    it("throws when aggregateBatchReport encounters partial player measurement sets (e.g. exactly one player missing)", () => {
      const gameResult = runPassiveBaselineGame({
        seed: "partial-player-seed",
        gameId: "partial-player-game",
        quarterCount: 1,
      });

      const playerIds = Object.keys(gameResult.openingPlayers) as PlayerId[];
      expect(playerIds.length).toBe(4);
      const omittedPlayerId = playerIds[0];
      if (!omittedPlayerId) throw new Error("Expected at least one player");

      const config: BaselineSimulationConfig = {
        gameCount: 1,
        quarterCount: 1,
        seedPrefix: "partial-test",
      };

      // 1. All players missing (0 opening players)
      expect(() =>
        aggregateBatchReport(config, [
          {
            ...gameResult,
            openingPlayers: {} as typeof gameResult.openingPlayers,
          },
        ]),
      ).toThrow(
        "Simulation invariant failed: game partial-player-game expected exactly 4 opening players, got 0",
      );

      // 2. Exactly one player missing from openingPlayers (3 players)
      const partialOpeningPlayers = { ...gameResult.openingPlayers };
      delete partialOpeningPlayers[omittedPlayerId];

      expect(() =>
        aggregateBatchReport(config, [
          {
            ...gameResult,
            openingPlayers: partialOpeningPlayers,
          },
        ]),
      ).toThrow(
        "Simulation invariant failed: game partial-player-game expected exactly 4 opening players, got 3",
      );

      // 3. Exactly one player missing from finalPlayers
      const partialFinalPlayers = { ...gameResult.finalPlayers };
      delete partialFinalPlayers[omittedPlayerId];

      expect(() =>
        aggregateBatchReport(config, [
          {
            ...gameResult,
            finalPlayers: partialFinalPlayers,
          },
        ]),
      ).toThrow(
        "Simulation invariant failed: game partial-player-game expected exactly 4 final players, got 3",
      );

      // 4. Exactly one player missing from playerCashFlows
      const partialCashFlows = { ...gameResult.playerCashFlows };
      delete partialCashFlows[omittedPlayerId];

      expect(() =>
        aggregateBatchReport(config, [
          {
            ...gameResult,
            playerCashFlows: partialCashFlows,
          },
        ]),
      ).toThrow(
        "Simulation invariant failed: game partial-player-game expected exactly 4 player cash flow records, got 3",
      );

      // 5. Exactly one player missing from playerLiquidity
      const partialLiquidity = { ...gameResult.playerLiquidity };
      delete partialLiquidity[omittedPlayerId];

      expect(() =>
        aggregateBatchReport(config, [
          {
            ...gameResult,
            playerLiquidity: partialLiquidity,
          },
        ]),
      ).toThrow(
        "Simulation invariant failed: game partial-player-game expected exactly 4 player liquidity records, got 3",
      );
    });
  });
});
