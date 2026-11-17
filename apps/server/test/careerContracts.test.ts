import {
  applyPlayerCommand,
  assertGameState,
  createGame,
  getCareerOffers,
} from "@interests/engine";
import { asPlayerId } from "@interests/shared";
import { expect, it } from "vitest";
import { PlayerCommandPayloadSchema } from "../src/match/schema";
import { loadAndValidateSnapshot } from "../src/match/snapshotLoader";
import { getCurrentVersionMetadata } from "../src/match/versions";

it("validates ID-only career commands and rejects client-authored pay, role and identity", () => {
  expect(
    PlayerCommandPayloadSchema.safeParse({
      type: "ACCEPT_CAREER_OFFER",
      offerId: "quote",
    }).success,
  ).toBe(true);
  expect(
    PlayerCommandPayloadSchema.safeParse({ type: "RESIGN_LABOR" }).success,
  ).toBe(true);
  for (const extra of [
    { annualCompensationCents: 999 },
    { playerId: "victim" },
    { role: "executive" },
    { ownershipCostCents: 0 },
  ]) {
    expect(
      PlayerCommandPayloadSchema.safeParse({
        type: "ACCEPT_CAREER_OFFER",
        offerId: "quote",
        ...extra,
      }).success,
    ).toBe(false);
  }
  expect(
    PlayerCommandPayloadSchema.safeParse({
      type: "RESIGN_LABOR",
      assetId: "victim-company",
    }).success,
  ).toBe(false);
});
it("round-trips accepted employment through the actual snapshot validator with stable quotes", () => {
  let state = createGame({
    gameId: "career-persistence",
    seed: "persist",
    playerIds: ["a", "b", "c", "d"].map(asPlayerId),
  });
  for (const actor of state.playerOrder)
    state = applyPlayerCommand(state, actor, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[actor]!.offeredObjectiveIds[0],
    }).state;
  const actor = state.playerOrder[0]!;
  state = applyPlayerCommand(state, actor, { type: "BEGIN_ROUND" }).state;
  state = applyPlayerCommand(state, actor, {
    type: "ACCEPT_CAREER_OFFER",
    offerId: getCareerOffers(state, actor)[0]!.id,
  }).state;
  const loaded = loadAndValidateSnapshot(
    JSON.stringify(state),
    getCurrentVersionMetadata(),
  );
  expect(loaded).toEqual(state);
  expect(getCareerOffers(loaded, actor)).toEqual(getCareerOffers(state, actor));
  assertGameState(loaded);
});
