import { asPlayerId } from "@interests/shared";
import { expect, it } from "vitest";
import { cents } from "../finance/money";
import { draftFundNpcLoan } from "../finance/npcLending";
import { createGame } from "../game/createGame";
import {
  applyPlayerCommand,
  type WirePlayerCommand,
} from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";

it("keeps the standing offer private and commits it only through an explicit, fully funded finale", () => {
  const players = ["player-1", "player-2", "player-3", "player-4"].map(
    asPlayerId,
  );
  const host = players[0]!;
  const financier = players[1]!;
  let state = createGame({
    gameId: "standing-finale-test",
    seed: "m7-acceptance-financier-7",
    playerIds: players,
  });
  function act(player: typeof host, command: WirePlayerCommand) {
    const result = applyPlayerCommand(state, player, command);
    if (!result.ok) throw new Error(result.code);
    state = result.state;
  }
  for (const player of players)
    act(player, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId:
        player === financier
          ? "financier"
          : state.players[player]!.offeredObjectiveIds[0],
    });
  expect(
    projectPlayerGameState(state, financier).self.financialDetails
      .standingFinaleOffer,
  ).toBeUndefined();
  // Synthetic capital boundary. Servicing and interest receipts still use actual production settlements.
  state = {
    ...state,
    finance: {
      ...state.finance,
      cashByPlayer: {
        ...state.finance.cashByPlayer,
        [financier]: cents(130_000_000),
      },
    },
  };
  for (const borrower of ["one", "two", "three"]) {
    const funded = draftFundNpcLoan(state, financier, {
      borrowerId: `test-${borrower}`,
      borrowerName: `Test ${borrower}`,
      principalCents: 30_000_000,
      annualRateBps: 1_350,
      termQuarters: 8,
      quarterlyRepaymentCapacityCents: 5_000_000,
    });
    if (!funded.ok) throw new Error(funded.code);
    state = funded.state;
  }
  while (
    state.currentQuarter < 5 ||
    getActiveSpotlightPlayerId(state) !== financier
  ) {
    if (state.round?.stage === "round-start")
      act(host, { type: "BEGIN_ROUND" });
    else act(getActiveSpotlightPlayerId(state)!, { type: "PASS_SPOTLIGHT" });
  }
  const own = projectPlayerGameState(state, financier);
  const offer = own.self.financialDetails.standingFinaleOffer;
  if (offer?.kind !== "financing")
    throw new Error("Expected qualified market offer");
  expect(offer.opportunityId).not.toBe(own.self.recurringOpportunity?.id);
  expect(Object.keys(offer.quote)).not.toContain(
    "quarterlyRepaymentCapacityCents",
  );
  const otherObjective = state.players[financier]!.offeredObjectiveIds.find(
    (id) => id !== "financier",
  )!;
  const paired: GameState = {
    ...state,
    players: {
      ...state.players,
      [financier]: {
        ...state.players[financier]!,
        selectedObjectiveId: otherObjective,
      },
    },
  };
  assertGameState(paired);
  expect(
    projectPlayerGameState(paired, financier).self.financialDetails
      .standingFinaleOffer,
  ).toBeUndefined();
  for (const rival of players.filter((id) => id !== financier))
    expect(projectPlayerGameState(state, rival)).toEqual(
      projectPlayerGameState(paired, rival),
    );
  const funding = {
    type: "FUND_RECURRING_LOAN",
    opportunityId: offer.opportunityId,
  } as const;
  expect(applyPlayerCommand(state, financier, funding)).toMatchObject({
    ok: false,
    state,
    journalEntries: [],
  });
  const before = state;
  act(financier, { type: "PURSUE_FINALE", action: funding });
  expect(state.result).toEqual({
    kind: "objective-victory",
    winnerPlayerId: financier,
    completedQuarter: 5,
  });
  expect(state.finance.cashByPlayer[financier]).toBe(
    before.finance.cashByPlayer[financier]! - offer.quote.principalCents,
  );
  expect(state.lastSettledQuarter).toBe(before.lastSettledQuarter);
  expect(state.content.random).toEqual(before.content.random);
  assertGameState(state);
});
