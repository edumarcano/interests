import { asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import {
  ORDINARY_OBJECTIVE_PLANS,
  type OrdinaryObjectivePlan,
} from "../../test/ordinaryObjectivePlans";
import { getCareerOffers } from "../game/career";
import { createGame } from "../game/createGame";
import {
  applyPlayerCommand,
  type WirePlayerCommand,
} from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { evaluateObjective } from "./evaluate";
import { measurePlayerObjectives } from "./measurements";

const players = ["player-1", "player-2", "player-3", "player-4"].map(
  asPlayerId,
);

function replayToFinale(plan: OrdinaryObjectivePlan) {
  let state = createGame({
    gameId: `ordinary-acceptance-${plan.objectiveId}`,
    seed: plan.seed,
    playerIds: players,
    setupScenario: "standard-v1",
  });
  const winner = asPlayerId(plan.winnerId);
  const accepted: {
    quarter: number;
    actor: PlayerId;
    command: WirePlayerCommand;
  }[] = [];
  function send(actor: PlayerId, command: WirePlayerCommand) {
    const result = applyPlayerCommand(state, actor, command);
    if (!result.ok)
      throw new Error(
        `${plan.objectiveId} Q${state.currentQuarter} ${actor} ${JSON.stringify(command)}: ${result.code}`,
      );
    accepted.push({ quarter: state.currentQuarter, actor, command });
    assertGameState(result.state);
    expect(result.state.result).toBeNull();
    state = result.state;
  }
  expect(state.content.scenario).toBe("standard-v1");
  expect(state.players[winner]?.profileId).toBe(plan.profileId);
  for (const actor of players) {
    const objectiveId =
      actor === winner
        ? plan.objectiveId
        : state.players[actor]?.offeredObjectiveIds[0];
    if (!objectiveId) throw new Error(`Missing ordinary offer for ${actor}`);
    send(actor, { type: "CHOOSE_OBJECTIVE", objectiveId });
  }
  send(winner, { type: "SET_FOCUS", focus: plan.initialFocus });

  const consumedQuarters: number[] = [];
  let closestIneligible: { state: GameState; outstanding: number } | undefined;
  while (state.currentQuarter <= plan.winningQuarter) {
    send(asPlayerId("player-1"), { type: "BEGIN_ROUND" });
    while (state.round?.stage === "spotlight") {
      const actor = getActiveSpotlightPlayerId(state);
      if (!actor) throw new Error("Missing ordinary spotlight actor");
      if (actor === winner) {
        if (state.currentQuarter === plan.winningQuarter)
          return {
            state,
            accepted,
            consumedQuarters,
            winner,
            closestIneligible,
          };
        const evaluation = evaluateObjective(
          measurePlayerObjectives(state, winner),
          plan.objectiveId,
        );
        const outstanding = evaluation.checks.filter(
          (check) => !check.met,
        ).length;
        if (
          outstanding > 0 &&
          outstanding <= (closestIneligible?.outstanding ?? Infinity)
        )
          closestIneligible = { state, outstanding };
        const actions = plan.actions.find(
          (row) => row.quarter === state.currentQuarter,
        );
        if (actions) {
          consumedQuarters.push(actions.quarter);
          for (const command of actions.commands) {
            expect(command.type).not.toBe("PURSUE_FINALE");
            send(actor, command);
          }
        }
        // Focus changes do not finish a spotlight; every omitted action is a pass.
        if (getActiveSpotlightPlayerId(state) === actor)
          send(actor, { type: "PASS_SPOTLIGHT" });
      } else send(actor, { type: "PASS_SPOTLIGHT" });
    }
  }
  throw new Error(`Missing finale turn for ${plan.objectiveId}`);
}

function complete(plan: OrdinaryObjectivePlan) {
  const replay = replayToFinale(plan);
  const { state: before, winner } = replay;
  expect(replay.consumedQuarters).toEqual(
    plan.actions.map((row) => row.quarter),
  );
  expect(replay.accepted).toHaveLength(plan.acceptedCommandCount - 1);
  expect(before.revision).toBe(plan.acceptedCommandCount - 1);
  expect(before.currentQuarter).toBe(plan.winningQuarter);
  expect(before.lastSettledQuarter).toBe(plan.winningQuarter - 1);
  const unchanged = JSON.stringify(before);
  const command = { type: "PURSUE_FINALE", action: plan.finalAction } as const;
  function rejectsUnchanged(
    state: GameState,
    actor: PlayerId,
    attempt: WirePlayerCommand,
  ) {
    const outcome = applyPlayerCommand(state, actor, attempt);
    expect(outcome.ok).toBe(false);
    expect(outcome.state).toBe(state);
    expect(outcome.journalEntries).toEqual([]);
    return outcome;
  }
  if (!replay.closestIneligible)
    throw new Error("Expected a real earlier ineligible position");
  expect(
    rejectsUnchanged(replay.closestIneligible.state, winner, command),
  ).toMatchObject({ code: "FINALE_INELIGIBLE" });
  rejectsUnchanged(
    before,
    players.find((player) => player !== winner)!,
    command,
  );
  const forgedWinner = { ...command, winnerPlayerId: winner };
  expect(rejectsUnchanged(before, winner, forgedWinner)).toMatchObject({
    code: "INVALID_ACTION",
  });

  let failedAction:
    | typeof command.action
    | { readonly type: "CONFIRM_INDEPENDENCE" };
  switch (command.action.type) {
    case "ACCEPT_CAREER_OFFER": {
      const ordinaryRole = getCareerOffers(before, winner).find(
        (offer) => offer.ownershipCostCents === 0 && offer.affordable,
      );
      if (!ordinaryRole)
        throw new Error("Expected a nonownership career alternative");
      failedAction = { type: "ACCEPT_CAREER_OFFER", offerId: ordinaryRole.id };
      break;
    }
    case "RESIGN_LABOR":
      failedAction = { type: "CONFIRM_INDEPENDENCE" };
      break;
    case "ACQUIRE_RECURRING_OPPORTUNITY":
    case "SELL_RECURRING_BUSINESS":
      failedAction = { ...command.action, quoteId: "expired-quote" };
      break;
    case "FUND_RECURRING_LOAN":
      failedAction = { ...command.action, opportunityId: "expired-offer" };
      break;
    default:
      failedAction = {
        type: "TRADE_PUBLIC_MARKETS",
        trades: [
          {
            instrumentId: "income-defensive-fund",
            buyCents: 100,
            sellCents: 0,
          },
        ],
      };
  }
  rejectsUnchanged(before, winner, {
    type: "PURSUE_FINALE",
    action: failedAction,
  });

  // Branch from the same ordinary position: eligibility is never an implicit win.
  const ordinary = applyPlayerCommand(before, winner, plan.finalAction);
  if (plan.standingFinaleOffer) {
    const own = projectPlayerGameState(before, winner).self;
    const offer = own.financialDetails.standingFinaleOffer;
    if (plan.finalAction.type === "FUND_RECURRING_LOAN") {
      expect(offer).toMatchObject({
        kind: "financing",
        opportunityId: plan.finalAction.opportunityId,
        quote: { principalCents: 15_000_000, canFund: true },
      });
    } else if (
      plan.finalAction.type === "ACQUIRE_RECURRING_OPPORTUNITY" &&
      offer?.kind === "landmark"
    ) {
      expect(offer.opportunityId).toBe(plan.finalAction.opportunityId);
      expect(offer.quotes).toContainEqual(
        expect.objectContaining({
          id: plan.finalAction.quoteId,
          askingPriceCents: 65_000_000,
          canClose: true,
        }),
      );
    } else throw new Error("Expected an ordinary standing finale offer");
    expect(own.recurringOpportunity?.id).not.toBe(offer?.opportunityId);
    expect(ordinary).toMatchObject({
      ok: false,
      state: before,
      journalEntries: [],
    });
  } else {
    if (!ordinary.ok) throw new Error(ordinary.code);
    assertGameState(ordinary.state);
    expect(ordinary.state.result).toBeNull();
    expect(ordinary.state.phase).toBe("ready-for-first-round");
  }

  if (plan.objectiveId === "property-magnate" && !plan.standingFinaleOffer) {
    const offer = projectPlayerGameState(before, winner).self.financialDetails
      .standingFinaleOffer;
    if (offer?.kind !== "landmark")
      throw new Error("Expected standing landmark offer");
    const quote = offer.quotes.find((route) => route.canClose);
    if (!quote) throw new Error("Expected affordable standing landmark");
    const closed = applyPlayerCommand(before, winner, {
      type: "PURSUE_FINALE",
      action: {
        type: "ACQUIRE_RECURRING_OPPORTUNITY",
        opportunityId: offer.opportunityId,
        quoteId: quote.id,
      },
    });
    if (!closed.ok) throw new Error(closed.code);
    expect(closed.state.result).toEqual({
      kind: "objective-victory",
      winnerPlayerId: winner,
      completedQuarter: before.currentQuarter,
    });
  }

  const finale = applyPlayerCommand(before, winner, command);
  expect(finale.ok).toBe(true);
  if (!finale.ok) throw new Error(finale.code);
  const finished = finale.state;
  assertGameState(finished);
  expect(finished.phase).toBe("finished");
  expect(finished.result).toEqual({
    kind: "objective-victory",
    winnerPlayerId: winner,
    completedQuarter: plan.winningQuarter,
  });
  expect(finished.round).toBeNull();
  expect(finished.revision).toBe(before.revision + 1);
  expect(finished.currentQuarter).toBe(before.currentQuarter);
  expect(finished.lastSettledQuarter).toBe(before.lastSettledQuarter);
  expect(finished.random).toEqual(before.random);
  expect(finished.content.random).toEqual(before.content.random);
  expect(finished.economy.operatingRandom).toEqual(
    before.economy.operatingRandom,
  );
  expect(JSON.stringify(before)).toBe(unchanged);

  const restored = JSON.parse(JSON.stringify(finished)) as GameState;
  assertGameState(restored);
  expect(restored).toEqual(finished);
  return {
    accepted: [
      ...replay.accepted,
      { quarter: before.currentQuarter, actor: winner, command },
    ],
    finished: restored,
  };
}

describe("ordinary command objective acceptance", () => {
  it.each(ORDINARY_OBJECTIVE_PLANS)(
    "$objectiveId wins explicitly at Q$winningQuarter from $seed",
    (plan) => {
      // A second full production replay also protects deterministic accepted order.
      expect(complete(plan)).toEqual(complete(plan));
    },
  );
});
