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
import { measurePlayerObjectives } from "../objectives/measurements";

const players = ["a", "b", "c", "d"].map(asPlayerId);
const [host] = players as [PlayerId, ...PlayerId[]];

function send(state: GameState, player: PlayerId, command: WirePlayerCommand) {
  const result = applyPlayerCommand(state, player, command);
  if (!result.ok) throw new Error(result.code);
  return result;
}

function readyForLending(seed: string) {
  let state = createGame({
    gameId: "market-loan",
    seed,
    playerIds: players,
  });
  for (const player of players) {
    state = send(state, player, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[player]!.offeredObjectiveIds[0],
    }).state;
  }
  for (const player of players) {
    state = send(state, player, {
      type: "SET_FOCUS",
      focus: "financing",
    }).state;
  }
  return state;
}

function ordinaryOffer(finalSpotlight = false) {
  let state = readyForLending("ordinary-market-loan-v1");
  for (let turns = 0; turns < 32; turns++) {
    if (state.round?.stage === "round-start")
      state = send(state, host, { type: "BEGIN_ROUND" }).state;
    const player = getActiveSpotlightPlayerId(state)!;
    const card = projectPlayerGameState(state, player).self
      .recurringOpportunity;
    if (
      card?.marketLoanQuote?.canFund &&
      (state.round?.spotlightsCompleted === 3) === finalSpotlight
    )
      return { state, player, card, quote: card.marketLoanQuote };
    state = send(state, player, { type: "PASS_SPOTLIGHT" }).state;
  }
  throw new Error("Expected an ordinary private market loan by quarter eight");
}

const advanceQuarter = (original: GameState) => {
  let state = original;
  if (state.round?.stage === "round-start")
    state = send(state, host, { type: "BEGIN_ROUND" }).state;
  while (
    state.phase !== "finished" &&
    state.currentQuarter === original.currentQuarter
  ) {
    const player = getActiveSpotlightPlayerId(state)!;
    state = send(state, player, { type: "PASS_SPOTLIGHT" }).state;
  }
  return state;
};

describe("ordinary recurring market lending", () => {
  it("retains the last generated loan terms through the quarter-32 boundary", () => {
    let state = readyForLending("loan-horizon-0");
    while (state.currentQuarter < 32) state = advanceQuarter(state);
    const before = Object.values(state.content.cardsByPlayer).find(
      (card) => card?.npcFundingTerms,
    );
    if (!before?.npcFundingTerms)
      throw new Error("Expected a quarter-32 market loan");
    expect(before.npcFundingTerms.openingBaseRateBps).toBe(
      state.economy.baseRateBps,
    );
    const closed = advanceQuarter(state);
    assertGameState(closed);
    expect(closed.content.cardsByPlayer[before.targetPlayerId]).toEqual({
      ...before,
      status: "expired",
    });
  });

  it("funds the private quote once and persists real principal and interest payments", () => {
    const { state, player, card, quote } = ordinaryOffer();
    expect(ordinaryOffer().card).toEqual(card);
    const rival = players.find((id) => id !== player)!;
    expect(JSON.stringify(projectPlayerGameState(state, rival))).not.toContain(
      card.id,
    );
    expect(card).not.toHaveProperty("npcFundingTerms");
    expect(quote).not.toHaveProperty("quarterlyRepaymentCapacityCents");
    const command = {
      type: "FUND_RECURRING_LOAN",
      opportunityId: card.id,
    } as const;
    expect(applyPlayerCommand(state, rival, command)).toMatchObject({
      ok: false,
      code: "NOT_ACTIVE_SPOTLIGHT",
      state,
      journalEntries: [],
    });
    const funded = send(state, player, command);
    const posting = funded.journalEntries[0]!;
    const loanId = posting.relatedLoanId!;
    const loan = funded.state.finance.loansById[loanId];
    expect(posting).toMatchObject({
      amountCents: quote.principalCents,
      reason: "npc-loan-advance",
      relatedOpportunityId: card.id,
    });
    expect(loan).toMatchObject({
      kind: "npc-loan",
      lenderPlayerId: player,
      fundedOpportunityId: card.id,
      originalPrincipalCents: quote.principalCents,
      annualRateBps: quote.annualRateBps,
      interestReceipts: [],
    });
    expect(funded.state.revision).toBe(state.revision + 1);
    expect(funded.state.finance.cashByPlayer[player]).toBe(
      state.finance.cashByPlayer[player]! - quote.principalCents,
    );
    expect(
      projectPlayerGameState(funded.state, player).self.recurringOpportunity,
    ).toMatchObject({ status: "funded" });
    expect(
      JSON.stringify(projectPlayerGameState(funded.state, rival)),
    ).not.toContain(loanId);
    const restored = JSON.parse(JSON.stringify(funded.state)) as GameState;
    assertGameState(restored);
    expect(restored).toEqual(funded.state);
    const afterOpening = advanceQuarter(restored);
    expect(afterOpening.finance.loansById[loanId]).toEqual(loan);
    expect(measurePlayerObjectives(afterOpening, player)).toMatchObject({
      performingFinancingBookCents: quote.principalCents,
      earnedFinancingProfitCents: 0,
      distinctPerformingBorrowers: quote.principalCents >= 5_000_000 ? 1 : 0,
    });
    const afterPayment = advanceQuarter(afterOpening);
    expect(afterPayment.finance.loansById[loanId]).toMatchObject({
      kind: "npc-loan",
      interestReceipts: [
        { quarter: quote.firstDueQuarter, receivedCents: expect.any(Number) },
      ],
    });
    expect(
      afterPayment.finance.loansById[loanId]!.outstandingPrincipalCents,
    ).toBeLessThan(quote.principalCents);
    const paidInterest = afterPayment.finance.lastSettlement?.loanPayments.find(
      (row) => row.loanId === loanId,
    )?.interestPaidCents;
    expect(paidInterest).toBeGreaterThan(0);
    expect(
      measurePlayerObjectives(afterPayment, player).earnedFinancingProfitCents,
    ).toBe(paidInterest);
  });

  it("retains the original snapshot when the final spotlight cannot settle", () => {
    const { state, player, card } = ordinaryOffer(true);
    // Synthetic exhausted persistence counter around an ordinary final spotlight.
    const invalid: GameState = {
      ...state,
      counters: { ...state.counters, settlement: Number.MAX_SAFE_INTEGER },
    };
    const result = applyPlayerCommand(invalid, player, {
      type: "FUND_RECURRING_LOAN",
      opportunityId: card.id,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "SETTLEMENT_ID_EXHAUSTED",
    });
    expect(result.state).toBe(invalid);
    expect(result.journalEntries).toEqual([]);
  });
});
