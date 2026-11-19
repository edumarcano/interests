import { asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { BusinessAsset, GameState } from "../model/gameState";
import { recurringCandidateWeights } from "./recurring";
import {
  recurringBusinessExitQuote,
  seasonedSoleOwnedBusinesses,
} from "./recurringBusinessExit";

const ids = ["A", "B", "C", "D"].map(asPlayerId),
  seller = ids[3]!;
function act(
  state: GameState,
  actor: PlayerId,
  command: Parameters<typeof applyPlayerCommand>[2],
) {
  const result = applyPlayerCommand(state, actor, command);
  expect(result.ok, result.ok ? "" : result.code).toBe(true);
  if (!result.ok) throw new Error(result.code);
  assertGameState(result.state);
  return result;
}
function start() {
  let state = createGame({
    gameId: "npc-buyer-proof",
    seed: "npc-buyer-proof-0",
    playerIds: ids,
  });
  for (const id of ids)
    state = act(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[id]!.offeredObjectiveIds[0],
    }).state;
  for (const id of ids)
    state = act(state, id, { type: "SET_FOCUS", focus: "business" }).state;
  return state;
}
function ready() {
  let state = start();
  while (
    state.currentQuarter < 2 ||
    getActiveSpotlightPlayerId(state) !== seller
  ) {
    state =
      state.round?.stage === "round-start"
        ? act(state, ids[0]!, { type: "BEGIN_ROUND" }).state
        : act(state, getActiveSpotlightPlayerId(state)!, {
            type: "PASS_SPOTLIGHT",
          }).state;
  }
  expect(state.content.cardsByPlayer[seller]!.businessBuyer).toBeDefined();
  return state;
}
function command(state: GameState) {
  return {
    type: "SELL_RECURRING_BUSINESS" as const,
    opportunityId: state.content.cardsByPlayer[seller]!.id,
    quoteId: recurringBusinessExitQuote(state, seller)!.id,
  };
}
describe("ordinary matched recurring business exits", () => {
  it("offers no buyer before earned operations, then persists one bounded bid and exact private quote without rerolls", () => {
    const opening = start();
    expect(seasonedSoleOwnedBusinesses(opening, seller)).toEqual([]);
    expect(
      recurringCandidateWeights(opening, seller).some(
        (candidate) => candidate.template.action === "npc-business-exit",
      ),
    ).toBe(false);
    const state = ready(),
      card = state.content.cardsByPlayer[seller]!,
      buyer = card.businessBuyer!,
      quote = recurringBusinessExitQuote(state, seller)!;
    expect(state.currentQuarter).toBe(2);
    expect(quote.operatingEnterpriseBidCents).toBe(
      buyer.operatingEnterpriseBidCents,
    );
    expect(quote.operatingEnterpriseBidCents).toBeGreaterThanOrEqual(
      buyer.referenceEnterpriseValueCents * 0.975,
    );
    expect(quote.operatingEnterpriseBidCents).toBeLessThanOrEqual(
      buyer.referenceEnterpriseValueCents * 1.025,
    );
    const before = JSON.stringify(state);
    expect(recurringBusinessExitQuote(state, seller)).toEqual(quote);
    expect(recurringBusinessExitQuote(JSON.parse(before), seller)).toEqual(
      quote,
    );
    expect(JSON.stringify(state)).toBe(before);
    const refocused = act(state, seller, {
      type: "SET_FOCUS",
      focus: "general",
    }).state;
    expect(refocused.content.cardsByPlayer[seller]!.businessBuyer).toEqual(
      buyer,
    );
    expect(recurringBusinessExitQuote(refocused, seller)!.id).not.toBe(
      quote.id,
    );
    expect(quote.grossConsiderationCents).toBe(
      quote.operatingEnterpriseBidCents + quote.companyCashIncludedCents,
    );
    expect(
      quote.sellerNetCents +
        quote.saleFeeCents +
        quote.bankPayoffCents +
        quote.operatingArrearsPaidCents +
        quote.workArrearsPaidCents,
    ).toBe(quote.grossConsiderationCents);
    const corrupt = JSON.parse(before) as GameState;
    Object.assign(corrupt.content.cardsByPlayer[seller]!.businessBuyer!, {
      operatingEnterpriseBidCents: 1,
    });
    expect(() => assertGameState(corrupt)).toThrow();
  });
  it("closes an unchanged ordinary company's matched exit once with exact net proceeds, fee and bank payoff", () => {
    const state = ready(),
      quote = recurringBusinessExitQuote(state, seller)!,
      request = command(state),
      asset = state.finance.assetsById[
        quote.assetId as BusinessAsset["id"]
      ] as BusinessAsset;
    expect(state.lastSettledQuarter).toBeGreaterThanOrEqual(1);
    expect(asset.operatingModel!.quarters.length).toBeGreaterThan(0);
    const closed = act(state, seller, request);
    expect(closed.state.revision).toBe(state.revision + 1);
    expect(closed.state.finance.cashByPlayer[seller]).toBe(
      state.finance.cashByPlayer[seller]! + quote.sellerNetCents,
    );
    expect(closed.state.content.cardsByPlayer[seller]!.status).toBe(
      "completed",
    );
    expect(
      (closed.state.finance.assetsById[asset.id] as BusinessAsset).cashCents,
    ).toBe(quote.companyCashIncludedCents);
    expect(
      closed.journalEntries
        .filter((entry) => entry.reason === "business-sale-fee")
        .map((entry) => entry.amountCents),
    ).toEqual([quote.saleFeeCents]);
    expect(
      closed.journalEntries
        .filter((entry) => entry.reason === "business-bank-loan-payoff")
        .reduce((sum, entry) => sum + entry.amountCents, 0),
    ).toBe(quote.bankPayoffCents);
    expect(
      closed.state.progress.byPlayer[seller]!.disposals.at(-1),
    ).toMatchObject({
      counterpartyPlayerId: null,
      soldQuarter: 2,
      proceedsCents: quote.sellerNetCents,
    });
    expect(applyPlayerCommand(closed.state, seller, request)).toMatchObject({
      ok: false,
      state: closed.state,
      journalEntries: [],
    });
    const expired = act(state, seller, { type: "PASS_SPOTLIGHT" }).state;
    expect(applyPlayerCommand(expired, seller, request)).toMatchObject({
      ok: false,
      state: expired,
    });
  });
  it("keeps buyer identity and every financial quote field private from rivals in paired states and errors", () => {
    const state = ready(),
      rival = ids[0]!,
      other = projectPlayerGameState(state, rival),
      card = state.content.cardsByPlayer[seller]!,
      own = projectPlayerGameState(state, seller);
    expect(
      own.self.recurringOpportunity!.businessExitQuote!.sellerNetCents,
    ).toBeGreaterThan(0);
    expect(JSON.stringify(other)).not.toContain(card.businessBuyer!.buyerId);
    expect(JSON.stringify(other)).not.toContain(card.id);
    expect(other.self.recurringOpportunity!.businessExitQuote).toBeUndefined();
    const paired = {
      ...state,
      content: {
        ...state.content,
        cardsByPlayer: {
          ...state.content.cardsByPlayer,
          [seller]: {
            ...card,
            askingPriceCents: card.askingPriceCents + 100,
            businessBuyer: {
              ...card.businessBuyer!,
              operatingEnterpriseBidCents:
                card.businessBuyer!.operatingEnterpriseBidCents + 100,
            },
          },
        },
      },
    };
    assertGameState(paired);
    expect(projectPlayerGameState(paired, rival)).toEqual(other);
    const request = command(state);
    expect(applyPlayerCommand(state, rival, request)).toMatchObject({
      ok: false,
      code: "NOT_FOUND_OR_NOT_VISIBLE",
      state,
    });
    expect(applyPlayerCommand(paired, rival, request)).toMatchObject({
      ok: false,
      code: "NOT_FOUND_OR_NOT_VISIBLE",
      state: paired,
    });
  });
  it("rejects stale quotes and changed ownership without partial money or counters; cash changes affect only a fresh quote", () => {
    const state = ready(),
      request = command(state),
      quote = recurringBusinessExitQuote(state, seller)!,
      id = quote.assetId as BusinessAsset["id"],
      asset = state.finance.assetsById[id] as BusinessAsset;
    const refocused = act(state, seller, {
      type: "SET_FOCUS",
      focus: "property",
    }).state;
    expect(applyPlayerCommand(refocused, seller, request)).toMatchObject({
      ok: false,
      code: "INVALID_ACTION",
      state: refocused,
      journalEntries: [],
    });
    const cashChanged = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: {
          ...state.finance.assetsById,
          [id]: { ...asset, cashCents: asset.cashCents + 100 },
        },
      },
    } as GameState;
    expect(applyPlayerCommand(cashChanged, seller, request)).toMatchObject({
      ok: false,
      code: "INVALID_ACTION",
      state: cashChanged,
      journalEntries: [],
    });
    expect(
      recurringBusinessExitQuote(cashChanged, seller)!
        .operatingEnterpriseBidCents,
    ).toBe(quote.operatingEnterpriseBidCents);
    expect(
      recurringBusinessExitQuote(cashChanged, seller)!.companyCashIncludedCents,
    ).toBe(quote.companyCashIncludedCents + 100);
    const changed = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: {
          ...state.finance.assetsById,
          [id]: {
            ...asset,
            ownershipByPlayerPpm: { [seller]: 600_000, [ids[0]!]: 400_000 },
          },
        },
      },
    } as GameState;
    expect(applyPlayerCommand(changed, seller, request)).toMatchObject({
      ok: false,
      code: "INVALID_ACTION",
      state: changed,
      journalEntries: [],
    });
  });
});
