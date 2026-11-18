import {
  cents,
  createGame,
  createRandomState,
  type GameState,
  generateRecurringContent,
} from "@interests/engine";
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

it("allowlists recurring card DTOs and keeps unseen persistent facts out of every other recipient", () => {
  let state: GameState | undefined;
  let owner: PlayerId | undefined;
  for (let seed = 0; seed < 100; seed++) {
    const initial = createGame({
      gameId: "recurring-projection",
      seed: `recurring-projection-${seed}`,
      playerIds: ["p1", "p2", "p3", "p4"].map(asPlayerId),
    });
    // Synthetic liquidity isolates projection behavior; no ordinary acquisition claim.
    const rich = generateRecurringContent({
      ...initial,
      finance: {
        ...initial.finance,
        cashByPlayer: Object.fromEntries(
          initial.playerOrder.map((player) => [player, cents(20_000_000)]),
        ),
      },
      content: {
        ...initial.content,
        generatedQuarter: 0,
        random: createRandomState(
          `recurring-projection-${seed}:recurring-content-v1`,
        ),
        cardsByPlayer: Object.fromEntries(
          initial.playerOrder.map((player) => [player, null]),
        ),
        recentCategoriesByPlayer: Object.fromEntries(
          initial.playerOrder.map((player) => [player, []]),
        ),
      },
    });
    owner = rich.playerOrder.find(
      (player) => rich.content.cardsByPlayer[player]?.facts,
    );
    if (owner) {
      state = rich;
      break;
    }
  }
  if (!state || !owner) throw new Error("Missing diligence projection fixture");
  const card = state.content.cardsByPlayer[owner]!;
  const facts = card.facts!;
  const changedFacts =
    facts.kind === "business"
      ? {
          ...facts,
          annualOperatingProfitCents: facts.annualOperatingProfitCents + 1,
        }
      : { ...facts, marketValueCents: facts.marketValueCents + 1 };
  const changed: GameState = {
    ...state,
    content: {
      ...state.content,
      cardsByPlayer: {
        ...state.content.cardsByPlayer,
        [owner]: { ...card, facts: changedFacts },
      },
    },
  };
  for (const recipient of state.playerOrder) {
    const originalView = view(state, recipient);
    expect(view(changed, recipient)).toEqual(originalView);
    expect(JSON.stringify(originalView)).not.toContain("recurring-content-v1");
    expect(Object.hasOwn(originalView, "content")).toBe(false);
    for (const rival of state.playerOrder)
      if (rival !== recipient)
        expect(JSON.stringify(originalView)).not.toContain(
          state.content.cardsByPlayer[rival]!.id,
        );
  }
  const revealed = {
    ...changed,
    content: {
      ...changed.content,
      cardsByPlayer: {
        ...changed.content.cardsByPlayer,
        [owner]: {
          ...changed.content.cardsByPlayer[owner]!,
          investigated: true,
        },
      },
    },
  };
  expect(view(revealed, owner).self.recurringOpportunity!.facts).toEqual(
    changed.content.cardsByPlayer[owner]!.facts,
  );
  for (const recipient of state.playerOrder)
    if (recipient !== owner)
      expect(view(revealed, recipient)).toEqual(view(state, recipient));
});
