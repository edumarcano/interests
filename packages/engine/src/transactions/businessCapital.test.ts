import { asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/createGame";
import {
  applyPlayerCommand,
  type WirePlayerCommand,
} from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState } from "../model/gameState";
import { getReservedCashCents } from "./reservations";

const players = ["one", "two", "three", "four"].map(asPlayerId);

function send(state: GameState, actor: PlayerId, command: WirePlayerCommand) {
  const outcome = applyPlayerCommand(state, actor, command);
  if (!outcome.ok) throw new Error(outcome.code);
  return outcome;
}

function start() {
  let state = createGame({
    gameId: "capital-test",
    seed: "business-expansion",
    playerIds: players,
  });
  for (const playerId of players) {
    const player = state.players[playerId];
    if (!player) throw new Error("Expected player");
    state = send(state, playerId, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: player.offeredObjectiveIds[0],
    }).state;
  }
  state = send(state, players[0]!, { type: "BEGIN_ROUND" }).state;
  while (state.currentQuarter === 1) {
    const owner = getActiveSpotlightPlayerId(state)!;
    const asset = Object.values(state.finance.assetsById).find(
      (item) =>
        item.kind === "business" &&
        item.ownershipByPlayerPpm[owner] &&
        item.cashPolicyId === "starting-company-v1",
    );
    if (asset?.kind === "business") {
      const [buyer, second, rival] = players.filter(
        (player) => player !== owner,
      );
      if (!buyer || !second || !rival) throw new Error("Expected all seats");
      return { state, owner, asset, buyer, second, rival };
    }
    state = send(state, owner, { type: "PASS_SPOTLIGHT" }).state;
  }
  throw new Error("Expected a normal starting business");
}

function binding(state: GameState) {
  const tx = state.activeTransaction;
  if (tx?.kind !== "business-capital")
    throw new Error("Expected capital proposal");
  return { transactionId: tx.id, expectedTermsRevision: tx.termsRevision };
}

describe("business capital lifecycle", () => {
  it("binds targeted sale terms, protects funds and privacy, and closes only the initiator's spotlight", () => {
    const { state, owner, asset, buyer, rival } = start();
    const terms = {
      kind: "secondary-stake-sale" as const,
      sellerPlayerId: owner,
      buyerPlayerId: buyer,
      priceCents: 1_000_000,
      ownershipPpm: 250_000,
    };
    let active = send(state, owner, {
      type: "OPEN_BUSINESS_CAPITAL",
      terms,
      assetId: asset.id,
    }).state;
    expect(getReservedCashCents(active, buyer)).toBe(0);
    const v1 = binding(active);
    active = send(active, buyer, {
      type: "CONFIRM_BUSINESS_CAPITAL",
      ...v1,
    }).state;
    expect(getReservedCashCents(active, buyer)).toBe(1_020_000);
    expect(
      projectPlayerGameState(active, buyer).businessCapital
        ?.yourContributionCents,
    ).toBe(1_020_000);
    expect(projectPlayerGameState(active, rival).businessCapital).toBeNull();
    active = send(active, owner, {
      type: "REVISE_BUSINESS_CAPITAL",
      ...v1,
      terms: { ...terms, priceCents: 900_000 },
    }).state;
    expect(getReservedCashCents(active, buyer)).toBe(0);
    expect(
      applyPlayerCommand(active, buyer, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...v1,
      }),
    ).toEqual({
      ok: false,
      code: "STALE_TERMS_REVISION",
      state: active,
      journalEntries: [],
    });
    const v2 = binding(active);
    expect(
      applyPlayerCommand(active, owner, {
        type: "CLOSE_BUSINESS_CAPITAL",
        ...v2,
      }),
    ).toMatchObject({ ok: false, code: "CAPITAL_CONFIRMATIONS_REQUIRED" });
    expect(
      applyPlayerCommand(active, rival, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...v2,
      }),
    ).toMatchObject({ ok: false, code: "CAPITAL_PARTICIPANT_REQUIRED" });
    active = send(active, buyer, {
      type: "CONFIRM_BUSINESS_CAPITAL",
      ...v2,
    }).state;
    active = send(active, owner, {
      type: "CONFIRM_BUSINESS_CAPITAL",
      ...v2,
    }).state;
    const rehydrated = JSON.parse(JSON.stringify(active)) as GameState;
    assertGameState(rehydrated);
    const close = send(rehydrated, owner, {
      type: "CLOSE_BUSINESS_CAPITAL",
      ...v2,
    });
    expect(close.state.revision).toBe(active.revision + 1);
    expect(close.state.activeTransaction).toBeNull();
    expect(
      close.state.finance.assetsById[asset.id]?.ownershipByPlayerPpm[buyer],
    ).toBe(250_000);
    expect(
      close.journalEntries.slice(0, 3).map((entry) => entry.amountCents),
    ).toEqual([900_000, 18_000, 27_000]);
    expect(
      applyPlayerCommand(close.state, owner, {
        type: "CLOSE_BUSINESS_CAPITAL",
        ...v2,
      }),
    ).toMatchObject({
      ok: false,
      code: expect.stringMatching(/NO_ACTIVE_TRANSACTION|WRONG_ROUND_STAGE/),
    });
  });

  it("allows contribution withdrawal and lets only the initiator cancel the contract", () => {
    const { state, owner, asset, buyer, second } = start();
    let active = send(state, owner, {
      type: "OPEN_BUSINESS_CAPITAL",
      assetId: asset.id,
      terms: {
        kind: "primary-issuance",
        contributions: [
          {
            playerId: buyer,
            amountCents: 20_000,
            postMoneyOwnershipPpm: 100_000,
          },
          {
            playerId: second,
            amountCents: 30_000,
            postMoneyOwnershipPpm: 150_000,
          },
        ],
      },
    }).state;
    const args = binding(active);
    for (const player of [buyer, second, owner])
      active = send(active, player, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...args,
      }).state;
    expect(getReservedCashCents(active, buyer)).toBe(20_000);
    expect(getReservedCashCents(active, second)).toBe(30_000);
    active = send(active, second, {
      type: "WITHDRAW_BUSINESS_CAPITAL",
      ...args,
    }).state;
    expect(getReservedCashCents(active, second)).toBe(0);
    expect(
      applyPlayerCommand(active, owner, {
        type: "CLOSE_BUSINESS_CAPITAL",
        ...args,
      }),
    ).toMatchObject({ ok: false, code: "CAPITAL_CONFIRMATIONS_REQUIRED" });
    const cancel = {
      type: "CANCEL_ACTIVE_TRANSACTION",
      transactionId: args.transactionId,
    } as const;
    expect(applyPlayerCommand(active, buyer, cancel)).toMatchObject({
      ok: false,
      code: "NOT_ACTIVE_SPOTLIGHT",
    });
    const cleared = send(active, owner, cancel);
    expect(cleared.state.activeTransaction).toBeNull();
    expect(getReservedCashCents(cleared.state, buyer)).toBe(0);
    expect(
      cleared.journalEntries.some(
        (entry) => entry.relatedTransactionId === args.transactionId,
      ),
    ).toBe(false);
  });

  it("keeps an agreed issuance intact when final-spotlight settlement fails", () => {
    const { state, owner, asset, buyer, second } = start();
    let current = state;
    while (
      getActiveSpotlightPlayerId(current) !== owner ||
      current.round?.spotlightsCompleted !== 3
    ) {
      if (current.currentQuarter > 4)
        throw new Error("Expected a last spotlight");
      const active = getActiveSpotlightPlayerId(current);
      current = active
        ? send(current, active, { type: "PASS_SPOTLIGHT" }).state
        : send(current, players[0]!, { type: "BEGIN_ROUND" }).state;
    }
    let confirmed = send(current, owner, {
      type: "OPEN_BUSINESS_CAPITAL",
      assetId: asset.id,
      terms: {
        kind: "primary-issuance",
        contributions: [
          {
            playerId: buyer,
            amountCents: 20_000,
            postMoneyOwnershipPpm: 100_000,
          },
          {
            playerId: second,
            amountCents: 30_000,
            postMoneyOwnershipPpm: 150_000,
          },
        ],
      },
    }).state;
    const args = binding(confirmed);
    for (const player of [owner, buyer, second])
      confirmed = send(confirmed, player, {
        type: "CONFIRM_BUSINESS_CAPITAL",
        ...args,
      }).state;
    const close = { type: "CLOSE_BUSINESS_CAPITAL", ...args } as const;
    const exhausted = {
      ...confirmed,
      counters: { ...confirmed.counters, settlement: Number.MAX_SAFE_INTEGER },
    };
    const rejected = applyPlayerCommand(exhausted, owner, close);
    expect(rejected).toEqual({
      ok: false,
      state: exhausted,
      code: "SETTLEMENT_ID_EXHAUSTED",
      journalEntries: [],
    });
    expect(rejected.state).toBe(exhausted);
    expect(getReservedCashCents(rejected.state, second)).toBe(30_000);
    const posted = send(confirmed, owner, close);
    expect(posted.state.currentQuarter).toBe(confirmed.currentQuarter + 1);
    expect(
      posted.state.finance.assetsById[asset.id]?.ownershipByPlayerPpm,
    ).toEqual({
      [owner]: 750_000,
      [buyer]: 100_000,
      [second]: 150_000,
    });
    expect(
      posted.journalEntries
        .filter((entry) => entry.relatedTransactionId === args.transactionId)
        .map((entry) => entry.amountCents)
        .sort((a, b) => a - b),
    ).toEqual([20_000, 30_000]);
  });
});
