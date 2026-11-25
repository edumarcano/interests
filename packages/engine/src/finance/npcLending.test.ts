import { asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/createGame";
import {
  applyPlayerCommand,
  type WirePlayerCommand,
} from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { advanceSpotlight, getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState, NpcLoan } from "../model/gameState";
import { calculatePlayerLoanSchedule } from "./amortization";
import { cents } from "./money";
import {
  draftFundNpcLoan,
  materializeNpcFundingTerms,
  type NpcFundingTerms,
  quoteNpcFunding,
} from "./npcLending";

const [lender, rival, third, fourth] = ["one", "two", "three", "four"].map(
  asPlayerId,
) as [PlayerId, PlayerId, PlayerId, PlayerId];
const players = [lender, rival, third, fourth];
const terms: NpcFundingTerms = {
  borrowerId: "regional-supplier",
  borrowerName: "Regional supplier",
  principalCents: 400_000,
  annualRateBps: 1000,
  termQuarters: 4,
  quarterlyRepaymentCapacityCents: 200_000,
};

function send(state: GameState, actor: PlayerId, command: WirePlayerCommand) {
  const result = applyPlayerCommand(state, actor, command);
  if (!result.ok) throw new Error(result.code);
  return result;
}

function start() {
  let state = createGame({
    gameId: "npc-lending",
    seed: "business-expansion",
    playerIds: players,
  });
  for (const id of players) {
    const player = state.players[id];
    if (!player) throw new Error("Missing player");
    state = send(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: player.offeredObjectiveIds[0],
    }).state;
  }
  return send(state, lender, { type: "BEGIN_ROUND" }).state;
}

function finishQuarter(state: GameState) {
  const quarter = state.currentQuarter;
  while (state.currentQuarter === quarter) {
    const actor = getActiveSpotlightPlayerId(state);
    if (!actor) throw new Error("Expected spotlight");
    state = send(state, actor, { type: "PASS_SPOTLIGHT" }).state;
  }
  return state;
}

function funded(state: GameState, details = terms) {
  const result = draftFundNpcLoan(state, lender, details);
  if (!result.ok) throw new Error(result.code);
  assertGameState(result.state);
  return result;
}

function findLoan(state: GameState): NpcLoan {
  const loan = Object.values(state.finance.loansById).find(
    (row) => row.kind === "npc-loan",
  );
  if (!loan) throw new Error("Expected market loan");
  return loan;
}

describe("non-player lending accounting", () => {
  it("keeps the card's authored rate when the economy moves before funding", () => {
    const current = start();
    const quote = materializeNpcFundingTerms(
      "working-capital-loan",
      1_000_000,
      400,
    );
    if (!quote) throw new Error("Expected authored supplier quote");
    expect(quote).toMatchObject({
      borrowerId: "local-supplier",
      annualRateBps: 725,
      termQuarters: 4,
    });
    expect(
      materializeNpcFundingTerms(
        "working-capital-loan",
        1_000_000,
        current.economy.baseRateBps,
      )?.annualRateBps,
    ).toBe(775);
    const outstanding = findLoan(funded(current, quote).state);
    expect(outstanding.annualRateBps).toBe(725);
    expect(
      materializeNpcFundingTerms("not-an-authored-deal", 1_000_000, 450),
    ).toBeNull();
  });
  it("moves actual cash out and persists only real interest, with no origination-quarter receipt", () => {
    const state = start();
    const actual = funded(state);
    const loan = findLoan(actual.state);
    expect(actual.journalEntries).toMatchObject([
      {
        reason: "npc-loan-advance",
        amountCents: 400_000,
        relatedLoanId: loan.id,
        relatedTransactionId: loan.fundedTransactionId,
        source: { kind: "player", playerId: lender },
        destination: { kind: "external", account: "npc-borrower" },
      },
    ]);
    expect(actual.state.finance.cashByPlayer[lender]).toBe(
      (state.finance.cashByPlayer[lender] ?? 0) - 400_000,
    );
    expect(projectPlayerGameState(actual.state, rival)).toEqual(
      projectPlayerGameState(state, rival),
    );
    expect(
      projectPlayerGameState(actual.state, lender).self.loans.find(
        (item) => item.id === loan.id,
      ),
    ).toMatchObject({
      kind: "npc-loan",
      role: "lender",
      npcBorrowerName: terms.borrowerName,
    });
    const advanced = advanceSpotlight(actual.state, lender);
    if (!advanced.ok) throw new Error(advanced.code);
    let next = finishQuarter(advanced.state);
    expect(findLoan(next).interestReceipts).toHaveLength(0);
    const expected = calculatePlayerLoanSchedule(terms);
    for (const schedule of expected) {
      const q = next.currentQuarter;
      next = finishQuarter(send(next, lender, { type: "BEGIN_ROUND" }).state);
      expect(
        next.finance.lastSettlement?.loanPayments.find(
          (payment) => payment.loanId === loan.id,
        ),
      ).toMatchObject({
        borrowerPlayerId: null,
        lenderPlayerId: lender,
        paidCents: schedule.paymentCents,
        principalPaidCents: schedule.principalCents,
        interestPaidCents: schedule.interestCents,
      });
      expect(findLoan(next).interestReceipts.at(-1)).toEqual({
        quarter: q,
        receivedCents: schedule.interestCents,
        currentEarnedCents: schedule.interestCents,
      });
      expect(
        next.progress.byPlayer[lender]?.quarters.at(-1)?.sourcesById[
          `borrower:npc:${terms.borrowerId}`
        ]?.recurringReceivedCents,
      ).toBe(schedule.interestCents);
    }
    expect(findLoan(next)).toMatchObject({
      outstandingPrincipalCents: 0,
      principalRepaidCents: 400_000,
    });
    const restored = JSON.parse(JSON.stringify(next)) as GameState;
    assertGameState(restored);
    expect(findLoan(restored)).toEqual(findLoan(next));
  });

  it("clears only the funded cash budget, preserves unpaid claims and rejects repeat funding of an active borrower", () => {
    const state = start();
    const actual = funded(state, {
      ...terms,
      quarterlyRepaymentCapacityCents: 5_000,
    }).state;
    expect(
      quoteNpcFunding(state, lender, {
        ...terms,
        quarterlyRepaymentCapacityCents: 5_000,
      }),
    ).toMatchObject({
      firstDueQuarter: 2,
      repaymentRisk: "tight-budget",
      canFund: true,
      unavailableReason: null,
    });
    expect(quoteNpcFunding(state, lender, terms)).not.toHaveProperty(
      "quarterlyRepaymentCapacityCents",
    );
    expect(quoteNpcFunding(actual, rival, terms)).toMatchObject({
      canFund: false,
      unavailableReason: "borrower-funded",
    });
    expect(draftFundNpcLoan(actual, rival, terms)).toEqual({
      ok: false,
      code: "NPC_BORROWER_UNAVAILABLE",
      state: actual,
      journalEntries: [],
    });
    const q2 = finishQuarter(actual);
    const q3 = finishQuarter(send(q2, lender, { type: "BEGIN_ROUND" }).state);
    expect(findLoan(q3)).toMatchObject({
      outstandingPrincipalCents: 400_000,
      unpaidInterestCents: 5_000,
      interestReceipts: [
        { quarter: 2, receivedCents: 5_000, currentEarnedCents: 5_000 },
      ],
    });
    expect(findLoan(q3).pastDuePrincipalCents).toBeGreaterThan(0);
    const q4 = finishQuarter(send(q3, lender, { type: "BEGIN_ROUND" }).state);
    expect(findLoan(q4)).toMatchObject({
      unpaidInterestCents: 10_000,
      interestReceipts: [
        { quarter: 2, receivedCents: 5_000, currentEarnedCents: 5_000 },
        { quarter: 3, receivedCents: 5_000, currentEarnedCents: 0 },
      ],
    });
  });

  it("rejects unfunded, malformed or exhausted advances without changing the state", () => {
    const state = start();
    const balance = state.finance.cashByPlayer[lender] ?? 0;
    expect(
      draftFundNpcLoan(state, lender, {
        ...terms,
        principalCents: balance + 1,
      }),
    ).toEqual({
      ok: false,
      code: "INSUFFICIENT_AVAILABLE_CASH",
      state,
      journalEntries: [],
    });
    expect(
      draftFundNpcLoan(state, lender, {
        ...terms,
        quarterlyRepaymentCapacityCents: -1,
      }),
    ).toMatchObject({ ok: false, code: "UNSUPPORTED_TERMS", state });
    const exhausted = {
      ...state,
      counters: { ...state.counters, journal: Number.MAX_SAFE_INTEGER },
    };
    expect(draftFundNpcLoan(exhausted, lender, terms)).toEqual({
      ok: false,
      code: "JOURNAL_ID_EXHAUSTED",
      state: exhausted,
      journalEntries: [],
    });
    expect(state.finance.cashByPlayer[lender]).toBe(cents(balance));
  });
});
