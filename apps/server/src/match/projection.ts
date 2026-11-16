import { type GameState, projectPlayerGameState } from "@interests/engine";
import {
  OBJECTIVES,
  type ObjectiveId,
  PROFILES,
  type ProfileId,
} from "@interests/rules";
import type {
  ActiveTransactionSummaryView,
  MatchObjectiveOptionView,
  MatchPlayerSummaryView,
  MatchPlayerView,
  MatchProfileView,
  MatchSelfLoanView,
  MatchSelfView,
  PlayerId,
  PrivateOpportunityView,
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

  const getNicknameForPlayer = (playerId: PlayerId): string => {
    const matchMember = memberByPlayerId.get(playerId);
    const roomMember = matchMember
      ? roomMemberById.get(matchMember.roomMemberId)
      : undefined;
    return roomMember?.nickname ?? "Unknown";
  };

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

  const opportunity: PrivateOpportunityView | null = pureProjection.self
    .opportunity
    ? {
        ...pureProjection.self.opportunity,
        sellerNickname: getNicknameForPlayer(
          pureProjection.self.opportunity.sellerPlayerId,
        ),
      }
    : null;

  const loans: readonly MatchSelfLoanView[] = pureProjection.self.loans.map(
    (l) => ({
      id: l.id,
      kind: l.kind,
      role: l.role,
      counterpartyNickname:
        l.counterpartyPlayerId === "bank"
          ? "Bank"
          : getNicknameForPlayer(l.counterpartyPlayerId),
      originalPrincipalCents: l.originalPrincipalCents,
      outstandingPrincipalCents: l.outstandingPrincipalCents,
      annualRateBps: l.annualRateBps,
      termQuarters: l.termQuarters,
      scheduledQuarterlyPaymentCents: l.scheduledQuarterlyPaymentCents,
      amountDueCents: l.amountDueCents,
      pastDuePrincipalCents: l.pastDuePrincipalCents,
      unpaidInterestCents: l.unpaidInterestCents,
      status: l.status,
    }),
  );

  const enrichedSelf: MatchSelfView = {
    ...pureProjection.self,
    profile,
    offeredObjectives,
    selectedObjective,
    opportunity,
    ownedAssets: pureProjection.self.ownedAssets,
    loans,
  };

  const activeTransaction: ActiveTransactionSummaryView | null =
    pureProjection.activeTransaction
      ? {
          ...pureProjection.activeTransaction,
          buyerNickname: getNicknameForPlayer(
            pureProjection.activeTransaction.buyerPlayerId,
          ),
          sellerNickname: getNicknameForPlayer(
            pureProjection.activeTransaction.sellerPlayerId,
          ),
          offer: pureProjection.activeTransaction.offer
            ? {
                ...pureProjection.activeTransaction.offer,
                lenderNickname: getNicknameForPlayer(
                  pureProjection.activeTransaction.offer.lenderPlayerId,
                ),
              }
            : null,
        }
      : null;

  return {
    matchId: pureProjection.matchId,
    modeId: pureProjection.modeId,
    revision: pureProjection.revision,
    phase: pureProjection.phase,
    currentQuarter: pureProjection.currentQuarter,
    round: pureProjection.round,
    players,
    self: enrichedSelf,
    activeTransaction,
  };
}
