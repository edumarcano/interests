import { cents, createGame, type GameState } from "@interests/engine";
import {
  asMatchId,
  asPlayerId,
  asRoomId,
  asRoomMemberId,
  type PlayerId,
} from "@interests/shared";
import { expect, it } from "vitest";
import { buildMatchPlayerView } from "../src/match/projection";

function view(state: GameState, recipient: PlayerId) {
  const roomMembers = state.playerOrder.map((_, index) => ({
    id: asRoomMemberId(`member-${index}`),
    roomId: asRoomId("foundation-room"),
    nickname: `Player ${index + 1}`,
    nicknameKey: `player ${index + 1}`,
    joinOrder: index,
    createdAt: "2026-11-16T00:00:00.000Z",
  }));
  return buildMatchPlayerView({
    gameState: state,
    targetPlayerId: recipient,
    roomMembers,
    matchMembers: state.playerOrder.map((playerId, index) => ({
      matchId: asMatchId(state.gameId),
      roomMemberId: asRoomMemberId(`member-${index}`),
      playerId,
      playerOrder: index,
    })),
    hostMemberId: asRoomMemberId("member-0"),
  });
}

it("exposes fund values to their owner while preserving every unrelated recipient's view", () => {
  const state = createGame({
    gameId: "foundation-projection",
    seed: "foundation-projection",
    playerIds: ["p1", "p2", "p3", "p4"].map(asPlayerId),
  });
  const owner = state.playerOrder.find(
    (id) =>
      (state.finance.publicMarketsByPlayer[id]?.["broad-market-fund"] ?? 0) > 0,
  );
  if (!owner) throw new Error("Expected an opening public-fund owner");
  const portfolio = state.finance.publicMarketsByPlayer[owner];
  if (!portfolio) throw new Error("Missing owner's portfolio");
  const changedValue = cents(portfolio["broad-market-fund"] + 11);
  // Paired synthetic boundary states differ only in a private marked value.
  const changed: GameState = {
    ...state,
    finance: {
      ...state.finance,
      publicMarketsByPlayer: {
        ...state.finance.publicMarketsByPlayer,
        [owner]: { ...portfolio, "broad-market-fund": changedValue },
      },
    },
  };
  expect(JSON.stringify(view(changed, owner).self)).toContain(
    String(changedValue),
  );
  expect(view(changed, owner).self).not.toEqual(view(state, owner).self);
  for (const recipient of state.playerOrder) {
    if (recipient !== owner)
      expect(view(changed, recipient)).toEqual(view(state, recipient));
  }
});
