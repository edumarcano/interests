import type { MatchId, PlayerId, TransactionId } from "@finance-game/shared";
import type { GameState } from "../model/gameState.js";

export interface PurePlayerSummary {
  readonly playerId: PlayerId;
  readonly hasSelectedObjective: boolean;
}

export interface PureSelfView {
  readonly playerId: PlayerId;
  readonly profileId: string;
  readonly offeredObjectiveIds: readonly [string, string];
  readonly selectedObjectiveId: string | null;
}

export interface PureActiveTransactionSummary {
  readonly transactionId: TransactionId;
  readonly kind: string;
}

export interface PurePlayerProjection {
  readonly matchId: MatchId;
  readonly modeId: string;
  readonly revision: number;
  readonly phase: string;
  readonly currentQuarter: number;
  readonly players: readonly PurePlayerSummary[];
  readonly self: PureSelfView;
  readonly activeTransaction: PureActiveTransactionSummary | null;
}

/**
 * Pure GameState privacy projection for a specific player.
 *
 * Produces an allowlisted, recipient-specific view of the game state.
 * Never includes:
 * - other players' offered or selected objectives
 * - exact cash balances or private finances
 * - random state or private seeds
 * - deterministic counters
 * - unrevealed opportunities or raw reservations
 */
export function projectPlayerGameState(
  state: GameState,
  playerId: PlayerId,
): PurePlayerProjection {
  const selfPlayer = state.players[playerId];
  if (!selfPlayer) {
    throw new Error(`Player ${playerId} not found in game state`);
  }

  const players: PurePlayerSummary[] = state.playerOrder.map((pId) => {
    const p = state.players[pId];
    return {
      playerId: pId,
      hasSelectedObjective: p ? p.selectedObjectiveId !== null : false,
    };
  });

  const self: PureSelfView = {
    playerId,
    profileId: selfPlayer.profileId,
    offeredObjectiveIds: selfPlayer.offeredObjectiveIds,
    selectedObjectiveId: selfPlayer.selectedObjectiveId,
  };

  const activeTransaction: PureActiveTransactionSummary | null =
    state.activeTransaction !== null
      ? {
          transactionId: state.activeTransaction.id,
          kind: state.activeTransaction.kind,
        }
      : null;

  return {
    matchId: state.gameId as unknown as MatchId,
    modeId: state.modeId,
    revision: state.revision,
    phase: state.phase,
    currentQuarter: state.currentQuarter,
    players,
    self,
    activeTransaction,
  };
}
