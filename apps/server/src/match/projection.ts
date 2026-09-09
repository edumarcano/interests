import { type GameState, projectPlayerGameState } from "@interests/engine";
import {
  OBJECTIVES,
  type ObjectiveId,
  PROFILES,
  type ProfileId,
} from "@interests/rules";
import type {
  MatchObjectiveOptionView,
  MatchPlayerSummaryView,
  MatchPlayerView,
  MatchProfileView,
  MatchSelfView,
  PlayerId,
  RoomMemberId,
} from "@interests/shared";
import type { MatchMemberRecord, MatchRoomMember } from "./types.js";

/**
 * Combines pure engine GameState projection with lobby member metadata
 * to produce the allowlisted, personalized MatchPlayerView for a client.
 */
export function buildMatchPlayerView(params: {
  gameState: GameState;
  targetPlayerId: PlayerId;
  roomMembers: readonly MatchRoomMember[];
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

  const roomMemberById = new Map<RoomMemberId, MatchRoomMember>();
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

  const profileDef = PROFILES[pureProjection.self.profileId as ProfileId];
  const profile: MatchProfileView | undefined = profileDef
    ? {
        id: profileDef.id,
        name: profileDef.name,
        startingCashCents: profileDef.startingCashCents,
      }
    : undefined;

  const offeredObjectives = pureProjection.self.offeredObjectiveIds.map(
    (id) => {
      const objDef = OBJECTIVES[id as ObjectiveId];
      return objDef
        ? { id: objDef.id, name: objDef.name, family: objDef.family }
        : { id, name: id, family: "unknown" };
    },
  ) as [MatchObjectiveOptionView, MatchObjectiveOptionView];

  const selectedObjective: MatchObjectiveOptionView | null = pureProjection.self
    .selectedObjectiveId
    ? (() => {
        const objDef =
          OBJECTIVES[pureProjection.self.selectedObjectiveId as ObjectiveId];
        return objDef
          ? { id: objDef.id, name: objDef.name, family: objDef.family }
          : {
              id: pureProjection.self.selectedObjectiveId,
              name: pureProjection.self.selectedObjectiveId,
              family: "unknown",
            };
      })()
    : null;

  const enrichedSelf: MatchSelfView = {
    ...pureProjection.self,
    profile,
    offeredObjectives,
    selectedObjective,
  };

  return {
    matchId: pureProjection.matchId,
    modeId: pureProjection.modeId,
    revision: pureProjection.revision,
    phase: pureProjection.phase,
    currentQuarter: pureProjection.currentQuarter,
    round: pureProjection.round,
    players,
    self: enrichedSelf,
    activeTransaction: pureProjection.activeTransaction,
  };
}
