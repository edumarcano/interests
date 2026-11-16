import { asLoanId, asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { assertGameState } from "../invariants/assertGameState";
import type { GameState, LegacyBankLoan, PlayerLoan } from "../model/gameState";
import { allocateWeightedCents } from "./allocation";
import { createZeroPublicMarketPortfolio } from "./markets";
import { basisPoints, cents } from "./money";
import { calculateLoanObligation } from "./obligations";
import { settleQuarter } from "./settlement";

const [a, b, c, d] = ["a", "b", "c", "d"].map(asPlayerId) as [
  PlayerId,
  PlayerId,
  PlayerId,
  PlayerId,
];
const ids = [a, b, c, d];

function fixture(): GameState {
  let state = createGame({
    gameId: "arrears-fixture",
    seed: "arrears-fixture",
    playerIds: ids,
  });
  for (const id of ids) {
    const player = state.players[id];
    if (!player) throw new Error("Missing player");
    const result = applyPlayerCommand(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: player.offeredObjectiveIds[0],
    });
    if (!result.ok) throw new Error(result.code);
    state = result.state;
  }
  const cash = Object.fromEntries(ids.map((id) => [id, cents(0)]));
  const portfolios = Object.fromEntries(
    ids.map((id) => [id, createZeroPublicMarketPortfolio()]),
  );
  state = {
    ...state,
    opportunitiesById: {},
    finance: {
      ...state.finance,
      cashByPlayer: cash,
      assetsById: {},
      loansById: {},
      recurringByPlayer: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(0),
          },
        ]),
      ),
      publicMarketsByPlayer: portfolios,
      quarterStartBasis: {
        quarter: 1,
        cashByPlayer: cash,
        publicMarketsByPlayer: portfolios,
      },
    },
  };
  return advance(state);
}
function advance(state: GameState): GameState {
  const result = settleQuarter(state, { quarter: state.currentQuarter });
  if (!result.ok) throw new Error(result.code);
  return result.state;
}
function playerLoan(
  id: string,
  borrower = a,
  lender = b,
  principal = 60_000,
  rate = 0,
): PlayerLoan {
  return {
    id: asLoanId(id),
    kind: "player-loan",
    borrowerPlayerId: borrower,
    lenderPlayerId: lender,
    originalPrincipalCents: cents(principal),
    outstandingPrincipalCents: cents(principal),
    annualRateBps: basisPoints(rate),
    termQuarters: 2,
    installmentsProcessed: 0,
    originatedQuarter: 1,
    principalRepaidCents: cents(0),
    pastDuePrincipalCents: cents(0),
    unpaidInterestCents: cents(0),
    lastProcessedQuarter: 0,
  };
}
function withCash(
  state: GameState,
  playerId: PlayerId,
  amount: number,
): GameState {
  return {
    ...state,
    finance: {
      ...state.finance,
      cashByPlayer: {
        ...state.finance.cashByPlayer,
        [playerId]: cents(amount),
      },
    },
  };
}

describe("mandatory-arrears-v1", () => {
  it("pays current living first and shares the remaining budget equally by due bank/player claim weights", () => {
    const base = fixture();
    const player = playerLoan("player-claim");
    const bank: LegacyBankLoan = {
      id: asLoanId("bank-claim"),
      kind: "legacy-bank-loan",
      purpose: "personal-debt",
      borrowerPlayerId: a,
      originalPrincipalCents: cents(10_000),
      outstandingPrincipalCents: cents(10_000),
      annualRateBps: basisPoints(0),
      scheduledQuarterlyPaymentCents: cents(10_000),
      periodsProcessed: 0,
      principalRepaidCents: cents(0),
      pastDuePrincipalCents: cents(0),
      unpaidInterestCents: cents(0),
      lastProcessedQuarter: 0,
    };
    const funded = withCash(base, a, 60_000);
    const state: GameState = {
      ...funded,
      finance: {
        ...funded.finance,
        recurringByPlayer: {
          ...funded.finance.recurringByPlayer,
          [a]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(40_000),
          },
        },
        loansById: { [player.id]: player, [bank.id]: bank },
      },
    };
    const before = JSON.stringify(state);
    const next = advance(state);
    expect(
      next.finance.lastSettlement?.livingByPlayer[a]?.currentPaidCents,
    ).toBe(40_000);
    expect(
      next.finance.lastSettlement?.loanPayments.map((p) => [
        p.loanId,
        p.paidCents,
      ]),
    ).toEqual([
      [bank.id, 5_000],
      [player.id, 15_000],
    ]);
    expect(next.finance.cashByPlayer[a]).toBe(0);
    expect(next.finance.cashByPlayer[b]).toBe(15_000);
    expect(next.finance.loansById[bank.id]?.outstandingPrincipalCents).toBe(
      5_000,
    );
    expect(next.finance.loansById[player.id]?.pastDuePrincipalCents).toBe(
      15_000,
    );
    expect(JSON.stringify(state)).toBe(before);
    const reordered = {
      ...state,
      finance: {
        ...state.finance,
        loansById: { [bank.id]: bank, [player.id]: player },
      },
    };
    expect(advance(reordered)).toEqual(next);
  });

  it("pays current living before living arrears and later cures the unpaid amount", () => {
    const base = withCash(fixture(), a, 13_000);
    const state: GameState = {
      ...base,
      finance: {
        ...base.finance,
        livingArrearsByPlayer: {
          ...base.finance.livingArrearsByPlayer,
          [a]: cents(6_000),
        },
        recurringByPlayer: {
          ...base.finance.recurringByPlayer,
          [a]: {
            quarterlyIncomeCents: cents(0),
            quarterlyLivingExpenseCents: cents(10_000),
          },
        },
      },
    };
    const next = advance(state);
    expect(next.finance.lastSettlement?.livingByPlayer[a]).toMatchObject({
      currentPaidCents: 10_000,
      arrearsPaidCents: 3_000,
      closingArrearsCents: 3_000,
    });
    const recovered = advance(withCash(next, a, 20_000));
    expect(recovered.finance.livingArrearsByPlayer[a]).toBe(0);
    expect(
      recovered.finance.lastSettlement?.livingByPlayer[a]?.arrearsPaidCents,
    ).toBe(3_000);
  });

  it("does not use circular receipts to fund payments and still settles an unaffected player's income", () => {
    const base = fixture();
    const first = playerLoan("first", a, b, 20_000);
    const second = playerLoan("second", b, a, 20_000);
    const state: GameState = {
      ...base,
      finance: {
        ...base.finance,
        loansById: { [first.id]: first, [second.id]: second },
        recurringByPlayer: {
          ...base.finance.recurringByPlayer,
          [c]: {
            quarterlyIncomeCents: cents(100),
            quarterlyLivingExpenseCents: cents(0),
          },
        },
      },
    };
    const result = settleQuarter(state, { quarter: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(
      result.settlementOutcome.loanPayments.map((p) => [
        p.paidCents,
        p.closingPastDuePrincipalCents,
      ]),
    ).toEqual([
      [0, 10_000],
      [0, 10_000],
    ]);
    expect(result.journalEntries.filter((e) => e.relatedLoanId)).toHaveLength(
      0,
    );
    expect(result.state.finance.cashByPlayer[c]).toBe(100);
  });

  it("keeps principal intact on partial interest, accrues no interest on interest, and collects after maturity", () => {
    const base = withCash(fixture(), a, 1_000);
    const loan = playerLoan("interest", a, b, 100_000, 1_000);
    let state = advance({
      ...base,
      finance: { ...base.finance, loansById: { [loan.id]: loan } },
    });
    expect(state.finance.loansById[loan.id]).toMatchObject({
      outstandingPrincipalCents: 100_000,
      unpaidInterestCents: 1_500,
      installmentsProcessed: 1,
    });
    expect(
      calculateLoanObligation(state.finance.loansById[loan.id]!, 3),
    ).toMatchObject({ principalDueCents: 100_000, interestDueCents: 4_000 });
    state = advance(state);
    expect(state.finance.loansById[loan.id]).toMatchObject({
      outstandingPrincipalCents: 100_000,
      pastDuePrincipalCents: 100_000,
      unpaidInterestCents: 4_000,
      installmentsProcessed: 2,
    });
    state = advance(state);
    expect(state.finance.loansById[loan.id]?.unpaidInterestCents).toBe(6_500);
    state = advance(withCash(state, a, 200_000));
    expect(state.finance.loansById[loan.id]).toMatchObject({
      outstandingPrincipalCents: 0,
      unpaidInterestCents: 0,
      pastDuePrincipalCents: 0,
      principalRepaidCents: 100_000,
    });
    expect(projectPlayerGameState(state, b).self.loans[0]?.status).toBe(
      "repaid",
    );
  });

  it("collects remaining interest even when principal is already zero", () => {
    const base = withCash(fixture(), a, 40);
    const loan = {
      ...playerLoan("interest-only", a, b, 100),
      outstandingPrincipalCents: cents(0),
      principalRepaidCents: cents(100),
      unpaidInterestCents: cents(50),
    };
    const next = advance({
      ...base,
      finance: { ...base.finance, loansById: { [loan.id]: loan } },
    });
    expect(next.finance.loansById[loan.id]?.unpaidInterestCents).toBe(10);
    expect(projectPlayerGameState(next, a).self.loans[0]?.status).toBe(
      "in-arrears",
    );
    expect(next.finance.cashByPlayer[b]).toBe(40);
  });

  it("keeps unrelated views identical across paired valid private arrears states", () => {
    const base = fixture();
    const loan = playerLoan("private", a, b, 100_000, 1_000);
    const first = advance({
      ...base,
      finance: { ...base.finance, loansById: { [loan.id]: loan } },
    });
    const second = advance(
      withCash(
        {
          ...base,
          finance: { ...base.finance, loansById: { [loan.id]: loan } },
        },
        a,
        1_000,
      ),
    );
    assertGameState(first);
    assertGameState(second);
    expect(projectPlayerGameState(first, c)).toEqual(
      projectPlayerGameState(second, c),
    );
    expect(projectPlayerGameState(first, d)).toEqual(
      projectPlayerGameState(second, d),
    );
    expect(
      projectPlayerGameState(first, b).self.lastSettlement?.loanPayments[0]
        ?.paidCents,
    ).toBe(0);
    expect(
      projectPlayerGameState(second, b).self.lastSettlement?.loanPayments[0]
        ?.paidCents,
    ).toBe(1_000);
    expect(JSON.stringify(projectPlayerGameState(first, b))).not.toContain(
      "livingByPlayer",
    );
  });

  it("rejects capacity failures without committing cash, claims, IDs, or RNG", () => {
    const base = fixture();
    const loan = playerLoan("unpaid");
    const state: GameState = {
      ...base,
      counters: { ...base.counters, settlement: Number.MAX_SAFE_INTEGER },
      finance: { ...base.finance, loansById: { [loan.id]: loan } },
    };
    const before = JSON.stringify(state);
    const result = settleQuarter(state, { quarter: 2 });
    expect(result).toMatchObject({
      ok: false,
      code: "SETTLEMENT_ID_EXHAUSTED",
      journalEntries: [],
    });
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("rejects corrupt principal/arrears records and invalid outcome accounting", () => {
    const base = fixture();
    const loan = playerLoan("corrupt");
    expect(() =>
      assertGameState({
        ...base,
        finance: {
          ...base.finance,
          loansById: {
            [loan.id]: { ...loan, pastDuePrincipalCents: cents(60_001) },
          },
        },
      }),
    ).toThrow(/past-due principal/);
    const next = advance({
      ...base,
      finance: { ...base.finance, loansById: { [loan.id]: loan } },
    });
    const outcome = next.finance.lastSettlement;
    if (!outcome) throw new Error("Missing outcome");
    const payment = outcome.loanPayments[0];
    if (!payment) throw new Error("Missing payment");
    expect(() =>
      assertGameState({
        ...next,
        finance: {
          ...next.finance,
          lastSettlement: {
            ...outcome,
            loanPayments: [{ ...payment, paidCents: cents(1) }],
          },
        },
      }),
    ).toThrow(/does not reconcile/);
  });

  it("allocates cent ties by canonical ID without rounding claim weights into ownership units", () => {
    expect(allocateWeightedCents(cents(1), { b: 1, a: 1 })).toEqual({
      a: 1,
      b: 0,
    });
    expect(
      allocateWeightedCents(cents(3), {
        a: Number.MAX_SAFE_INTEGER,
        b: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({ a: 2, b: 1 });
  });
});
