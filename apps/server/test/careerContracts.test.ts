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

it("accepts only strictly nested explicit finale actions without client objective or financial authority", () => {
  const actions = [
    { type: "RESIGN_LABOR" },
    {
      type: "ACCEPT_CAREER_OFFER",
      offerId: "career:5:executive:20000000:employment",
    },
    { type: "CONFIRM_INDEPENDENCE" },
  ];
  for (const action of actions) {
    const command = { type: "PURSUE_FINALE", action };
    expect(PlayerCommandPayloadSchema.parse(command)).toEqual(command);
    for (const extra of [
      { objectiveId: "independent" },
      { actorPlayerId: "other" },
      { eligible: true },
      { result: { kind: "objective-victory" } },
    ]) {
      expect(
        PlayerCommandPayloadSchema.safeParse({ ...command, ...extra }).success,
      ).toBe(false);
      expect(
        PlayerCommandPayloadSchema.safeParse({
          ...command,
          action: { ...action, ...extra },
        }).success,
      ).toBe(false);
    }
  }
  for (const action of [
    null,
    [],
    { type: "PASS_SPOTLIGHT" },
    { type: "RESPOND_BUSINESS_AUCTION", transactionId: "auction", bidCents: 1 },
    { type: "PURSUE_FINALE", action: { type: "RESIGN_LABOR" } },
    { type: "ACCEPT_CAREER_OFFER", offerId: "" },
    { type: "ACCEPT_CAREER_OFFER", offerId: "x".repeat(201) },
  ])
    expect(
      PlayerCommandPayloadSchema.safeParse({ type: "PURSUE_FINALE", action })
        .success,
    ).toBe(false);
  expect(
    PlayerCommandPayloadSchema.safeParse({ type: "CONFIRM_INDEPENDENCE" })
      .success,
  ).toBe(false);
});
