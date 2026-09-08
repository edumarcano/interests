import { type GameState, projectPlayerGameState } from "@finance-game/engine";
import type {
  MatchPlayerSummaryView,
  MatchPlayerView,
  PlayerId,
  RoomMemberId,
} from "@finance-game/shared";
import type { RoomMemberRecord } from "../lobby/types.js";
import type { MatchMemberRecord } from "./types.js";

/**
 * Combines pure engine GameState projection with lobby member metadata
 * to produce the allowlisted, personalized MatchPlayerView for a client.
 */
export function buildMatchPlayerView(params: {
  gameState: GameState;
  targetPlayerId: PlayerId;
  roomMembers: readonly RoomMemberRecord[];
  matchMembers: readonly MatchMemberRecord[];
  hostMemberId: RoomMemberId;
}): MatchPlayerView {
  const pureProjection = projectPlayerGameState(
    params.gameState,
    params.targetPlayerId,
  );

  const memberByPlayerId = new Map<PlayerId, MatchMemberRecord>();
  for (const mm of params.matchMembers) {
    memberByPlayerId.set(mm.playerId, mm);
  }

  const roomMemberById = new Map<RoomMemberId, RoomMemberRecord>();
  for (const rm of params.roomMembers) {
    roomMemberById.set(rm.id, rm);
  }

  const players: MatchPlayerSummaryView[] = pureProjection.players.map(
    (summary) => {
      const matchMember = memberByPlayerId.get(summary.playerId);
      const roomMember = matchMember
        ? roomMemberById.get(matchMember.roomMemberId)
        : undefined;

      return {
        playerId: summary.playerId,
        roomMemberId: matchMember?.roomMemberId ?? ("" as RoomMemberId),
        nickname: roomMember?.nickname ?? "Unknown",
        joinOrder: matchMember?.playerOrder ?? 0,
        isHost: matchMember?.roomMemberId === params.hostMemberId,
        hasSelectedObjective: summary.hasSelectedObjective,
      };
    },
  );

  return {
    matchId: pureProjection.matchId,
    modeId: pureProjection.modeId,
    revision: pureProjection.revision,
    phase: pureProjection.phase,
    currentQuarter: pureProjection.currentQuarter,
    players,
    self: pureProjection.self,
    activeTransaction: pureProjection.activeTransaction,
  };
}
