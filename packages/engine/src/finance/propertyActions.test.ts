import type { PropertyCommand } from "@interests/shared";
import { asAssetId, asPlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type {
  AssetBankLoan,
  GameState,
  PropertyAsset,
} from "../model/gameState";
import { calculateAmortizingSchedule } from "./amortization";
import {
  bankBorrowerStrength,
  bankPayoff,
  propertyLoanQuote,
  quoteAssetBankLoan,
  resetVariableAssetLoan,
} from "./bank";
import { originateConfirmedPlayerLoan } from "./loans";
import { basisPoints, cents } from "./money";
import { calculateLoanObligation } from "./obligations";
import { ownershipPpm } from "./ownership";
import { createProgress } from "./progress";
import { calculatePropertyCashFlow } from "./property";
import { propertyManagement, propertyOffers } from "./propertyActions";

const ids = ["A", "B", "C", "D"].map(asPlayerId);
const actor = ids[0]!;
function accepted(
  state: GameState,
  player = actor,
  command: Parameters<typeof applyPlayerCommand>[2],
): GameState {
  const result = applyPlayerCommand(state, player, command);
  expect(result.ok, result.ok ? undefined : result.code).toBe(true);
  if (!result.ok) throw new Error(result.code);
  assertGameState(result.state);
  return result.state;
}
function ready(rich = true, seed = "property-acceptance"): GameState {
  let state = createGame({
    gameId: "property-acceptance",
    seed,
    playerIds: ids,
  });
  for (const id of ids)
    state = accepted(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[id]!.offeredObjectiveIds[0],
    });
  if (rich)
    state = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [actor]: cents(100_000_000),
        },
      },
    };
  return accepted(state, actor, { type: "BEGIN_ROUND" });
}
function nextActorTurn(state: GameState): GameState {
  for (let n = 0; n < 10; n++) {
    if (state.round?.stage === "round-start")
      state = accepted(state, actor, { type: "BEGIN_ROUND" });
    const active = getActiveSpotlightPlayerId(state)!;
    if (active === actor) return state;
    state = accepted(state, active, { type: "PASS_SPOTLIGHT" });
  }
  throw new Error("No actor turn");
}
function settleCurrent(state: GameState): GameState {
  const quarter = state.currentQuarter;
  while (state.currentQuarter === quarter)
    state = accepted(state, getActiveSpotlightPlayerId(state)!, {
      type: "PASS_SPOTLIGHT",
    });
  return state;
}
function buy(
  state = ready(),
  rateKind: "fixed" | "variable" = "fixed",
  principal?: number,
) {
  const quote = propertyOffers(state, actor)[0]!.quotes.find(
    (item) => item.principalCents > 0 && item.rateKind === rateKind,
  )!;
  state = accepted(state, actor, {
    type: "BUY_PROPERTY",
    catalogueId: "residential-duplex",
    principalCents: principal ?? quote.principalCents,
    rateKind,
  });
  const asset = Object.values(state.finance.assetsById).find(
    (asset): asset is PropertyAsset =>
      asset.kind === "property" && asset.catalogueId === "residential-duplex",
  )!;
  const loan = Object.values(state.finance.loansById).find(
    (loan): loan is AssetBankLoan =>
      loan.kind === "asset-bank-loan" && loan.borrowerAssetId === asset.id,
  )!;
  return { state, asset, loan, quote };
}

describe("M7 bank and property production commands", () => {
  it("funds a mortgage from ordinary setup cash, using a stable authoritative quote", () => {
    let state = ready(false);
    let selected = false;
    for (let i = 0; i < 4; i++) {
      const player = getActiveSpotlightPlayerId(state)!;
      const offer = propertyOffers(state, player)[0]!;
      const quote = offer.quotes.find(
        (item) => item.principalCents > 0 && item.canClose,
      );
      if (quote) {
        const before = state;
        const result = applyPlayerCommand(state, player, {
          type: "BUY_PROPERTY",
          catalogueId: offer.catalogueId,
          principalCents: quote.principalCents,
          rateKind: quote.rateKind,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.code);
        state = result.state;
        expect(state.revision).toBe(before.revision + 1);
        expect(
          result.journalEntries.find(
            (entry) => entry.reason === "property-equity-funding",
          )!.amountCents,
        ).toBe(quote.cashRequiredCents);
        expect(
          result.journalEntries.filter(
            (entry) => entry.reason === "asset-bank-loan-origination",
          ),
        ).toHaveLength(1);
        selected = true;
        break;
      }
      state = accepted(state, player, { type: "PASS_SPOTLIGHT" });
    }
    expect(selected).toBe(true);
  });
  it("records one canonical asset debt and reserve, first pays next quarter before distributions", () => {
    const { state: closed, asset, loan, quote } = buy();
    expect(asset.cashCents).toBe(quote.assetReserveCents);
    expect(loan).not.toHaveProperty("borrowerPlayerId");
    expect(calculateLoanObligation(loan, 1)).toBeNull();
    expect(
      closed.finance.quarterStartBasis.propertiesById[asset.id],
    ).toBeUndefined();
    let state = settleCurrent(closed);
    expect(
      state.finance.lastSettlement!.loanPayments.filter(
        (p) => p.loanId === loan.id,
      ),
    ).toHaveLength(0);
    state = accepted(state, actor, { type: "BEGIN_ROUND" });
    state = settleCurrent(state);
    const payment = state.finance.lastSettlement!.loanPayments.find(
      (p) => p.loanId === loan.id,
    )!;
    expect(payment.borrowerPlayerId).toBeNull();
    expect(payment.borrowerAssetId).toBe(asset.id);
    expect(payment.paidCents).toBe(quote.quarterlyPaymentCents);
    expect(state.finance.loansById[loan.id]!.outstandingPrincipalCents).toBe(
      loan.originalPrincipalCents - payment.principalPaidCents,
    );
    expect(
      (state.finance.assetsById[asset.id] as PropertyAsset).cashCents,
    ).toBe(quote.assetReserveCents);
    expect(
      state.progress.byPlayer[actor]!.quarters.at(-1)!.sourcesById[
        `asset:${asset.id}`
      ]!.recurringReceivedCents,
    ).toBe(
      calculatePropertyCashFlow(asset).netOperatingIncomeCents -
        payment.paidCents,
    );
  });
  it("prices grades from unreserved cash and 80% funds, applies LTV and DSCR independently and supports business terms", () => {
    const state = ready();
    const strength = bankBorrowerStrength(state, actor);
    expect(strength.grade).toBe("excellent");
    const { asset } = buy(state);
    const fixed = propertyLoanQuote(state, actor, asset, 5_000_000, "fixed"),
      variable = propertyLoanQuote(state, actor, asset, 5_000_000, "variable");
    expect(fixed.annualRateBps - variable.annualRateBps).toBe(50);
    expect(variable.annualRateBps).toBe(state.economy.baseRateBps + 175);
    expect(
      propertyLoanQuote(state, actor, asset, 8_000_000, "fixed").ltvPass,
    ).toBe(false);
    expect(
      propertyLoanQuote(
        state,
        actor,
        { ...asset, scheduledQuarterlyRentCents: cents(1) },
        5_000_000,
        "fixed",
      ).dscrPass,
    ).toBe(false);
    const business = quoteAssetBankLoan(state, actor, {
      purpose: "business-acquisition",
      qualifyingValueCents: 10_000_000,
      quarterlyOperatingIncomeCents: 1_000_000,
      principalCents: 4_000_000,
      rateKind: "fixed",
    });
    expect(business.termQuarters).toBe(28);
    expect(business.annualRateBps).toBe(state.economy.baseRateBps + 175 + 150);
    expect(business.maxShareBps).toBe(5000);
  });
  it("retains the first installment for a personal loan originated this quarter", () => {
    const state = ready();
    const oldReserve = bankBorrowerStrength(
      state,
      actor,
    ).personalQuarterlyObligationsCents;
    const lender = ids.find(
      (id) => id !== actor && state.finance.cashByPlayer[id]! >= 2_000_000,
    )!;
    const originated = originateConfirmedPlayerLoan(
      state.finance,
      state.counters,
      {
        lenderPlayerId: lender,
        borrowerPlayerId: actor,
        principalCents: 2_000_000,
        annualRateBps: 800,
        termQuarters: 4,
        quarter: state.currentQuarter,
      },
    );
    expect(originated.ok).toBe(true);
    if (!originated.ok) throw new Error(originated.code);
    expect(
      calculateLoanObligation(originated.loan, state.currentQuarter),
    ).toBeNull();
    const financed = {
      ...state,
      finance: originated.finance,
      counters: originated.counters,
    };
    const quote = propertyOffers(financed, actor)[0]!.quotes.find(
      (row) => row.rateKind === "fixed" && row.principalCents > 0,
    )!;
    expect(quote.personalReserveCents).toBe(oldReserve + 525_248);
    const underfunded = {
      ...financed,
      finance: {
        ...financed.finance,
        cashByPlayer: {
          ...financed.finance.cashByPlayer,
          [actor]: cents(quote.cashRequiredCents + oldReserve + 100_000),
        },
      },
    };
    expect(
      applyPlayerCommand(underfunded, actor, {
        type: "BUY_PROPERTY",
        catalogueId: "residential-duplex",
        principalCents: quote.principalCents,
        rateKind: quote.rateKind,
      }),
    ).toMatchObject({ ok: false, state: underfunded });
  });
  it("rejects forged numbers, unavailable listings, wrong spotlight and insufficient reserves without changing any state", () => {
    const state = ready();
    const invalid: PropertyCommand[] = [
      {
        type: "BUY_PROPERTY",
        catalogueId: "forged",
        principalCents: 0,
        rateKind: "fixed",
      },
      {
        type: "BUY_PROPERTY",
        catalogueId: "residential-duplex",
        principalCents: NaN,
        rateKind: "fixed",
      },
      {
        type: "BUY_PROPERTY",
        catalogueId: "residential-duplex",
        principalCents: Number.MAX_SAFE_INTEGER,
        rateKind: "fixed",
      },
      {
        type: "BUY_PROPERTY",
        catalogueId: "residential-duplex",
        principalCents: 1,
        rateKind: "fixed",
      },
    ];
    for (const command of invalid) {
      const result = applyPlayerCommand(state, actor, command);
      expect(result.ok).toBe(false);
      expect(result.state).toBe(state);
      expect(result.journalEntries).toEqual([]);
    }
    const wrong = applyPlayerCommand(state, ids[1]!, {
      type: "BUY_PROPERTY",
      catalogueId: "residential-duplex",
      principalCents: 0,
      rateKind: "fixed",
    });
    expect(wrong.ok).toBe(false);
    expect(wrong.state).toBe(state);
    const poor = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: { ...state.finance.cashByPlayer, [actor]: cents(0) },
      },
    };
    const result = applyPlayerCommand(poor, actor, {
      type: "BUY_PROPERTY",
      catalogueId: "residential-duplex",
      principalCents: 7_500_000,
      rateKind: "fixed",
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe(poor);
  });
  it("sells with fees, earned interest and preserved quarter entitlement; a repeat close cannot pay twice", () => {
    const bought = buy();
    let state = nextActorTurn(bought.state);
    const before = state;
    const quote = propertyManagement(state, actor).find(
      (item) => item.assetId === bought.asset.id,
    )!;
    const result = applyPlayerCommand(state, actor, {
      type: "SELL_PROPERTY",
      assetId: bought.asset.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    state = result.state;
    expect(
      result.journalEntries.find(
        (entry) => entry.reason === "property-sale-proceeds",
      )!.amountCents,
    ).toBe(quote.netSaleProceedsCents);
    expect(
      result.journalEntries.filter(
        (j) => j.reason === "asset-bank-loan-payoff",
      )[0]!.loanPayment!.interestCents,
    ).toBe(
      bankPayoff(before, before.finance.loansById[bought.loan.id]!)
        .interestCents,
    );
    expect(
      (state.finance.assetsById[bought.asset.id] as PropertyAsset).disposition,
    ).toBe("sold");
    expect(
      result.journalEntries.find(
        (entry) =>
          entry.relatedAssetId === bought.asset.id &&
          entry.reason === "property-operating-distribution",
      )!.amountCents,
    ).toBe(calculatePropertyCashFlow(bought.asset).netOperatingIncomeCents);
    expect(
      applyPlayerCommand(state, actor, {
        type: "SELL_PROPERTY",
        assetId: bought.asset.id,
      }).ok,
    ).toBe(false);
    // Actor is Q2's fourth spotlight: the sale settles Q2 immediately.
    expect(state.currentQuarter).toBe(3);
    expect(
      state.progress.byPlayer[actor]!.realizedGainsCents -
        before.progress.byPlayer[actor]!.realizedGainsCents,
    ).toBe(
      -bought.quote.feeCents -
        quote.saleFeeCents -
        bankPayoff(before, before.finance.loansById[bought.loan.id]!)
          .interestCents,
    );
    expect(
      state.progress.byPlayer[actor]!.profitableDisposalAssetIds,
    ).not.toContain(bought.asset.id);
    expect(
      state.progress.byPlayer[actor]!.quarters.at(-1)!.sourcesById[
        `asset:${bought.asset.id}`
      ]!.debtServiceOwedCents,
    ).toBe(
      bankPayoff(before, before.finance.loansById[bought.loan.id]!)
        .interestCents,
    );
  });
  it("refinances performing debt without cash-out and records fees, interest and next-quarter terms", () => {
    const bought = buy(ready(), "fixed", 6_000_000);
    const state = nextActorTurn(bought.state);
    const quote = propertyManagement(state, actor).find(
      (item) => item.assetId === bought.asset.id,
    )!.refinancingQuotes[1]!;
    const result = applyPlayerCommand(state, actor, {
      type: "REFINANCE_PROPERTY",
      assetId: bought.asset.id,
      rateKind: "variable",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    const next = result.state;
    const replacement = Object.values(next.finance.loansById).find(
      (loan): loan is AssetBankLoan =>
        loan.kind === "asset-bank-loan" && loan.id !== bought.loan.id,
    )!;
    expect(replacement.originalPrincipalCents).toBe(quote.principalCents);
    expect(replacement.firstDueQuarter).toBe(state.currentQuarter + 1);
    expect(
      next.finance.loansById[bought.loan.id]!.outstandingPrincipalCents,
    ).toBe(0);
    expect(
      result.journalEntries.find(
        (j) => j.reason === "property-refinancing-fee",
      )!.amountCents,
    ).toBe(Math.round(quote.principalCents / 100));
    expect(
      result.journalEntries.filter(
        (j) =>
          j.destination.kind === "player" &&
          j.destination.playerId === actor &&
          j.reason.includes("refinanc"),
      ),
    ).toEqual([]);
    expect(
      bankPayoff({ ...next, currentQuarter: state.currentQuarter }, replacement)
        .interestCents,
    ).toBe(0);
  });
  it("renovates once, charging 5% with a $10k floor and preserving earned operating inputs", () => {
    const bought = buy();
    let state = nextActorTurn(bought.state);
    const basis =
      state.finance.quarterStartBasis.propertiesById[bought.asset.id]!;
    const beforeCash = state.finance.cashByPlayer[actor]!;
    const result = applyPlayerCommand(state, actor, {
      type: "RENOVATE_PROPERTY",
      assetId: bought.asset.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    state = result.state;
    const asset = state.finance.assetsById[bought.asset.id] as PropertyAsset;
    expect(asset.marketValueCents).toBe(10_800_000);
    expect(asset.scheduledQuarterlyRentCents).toBe(288_750);
    expect(asset.occupancyBps).toBe(10_000);
    const spent = result.journalEntries.find(
      (j) => j.reason === "property-renovation",
    )!.amountCents;
    expect(spent).toBe(1_000_000);
    expect(
      state.progress.byPlayer[actor]!.quarters.at(-1)!.sourcesById[
        `asset:${asset.id}`
      ]!.recurringReceivedCents,
    ).toBe(
      calculatePropertyCashFlow(basis).netOperatingIncomeCents -
        bought.quote.quarterlyPaymentCents,
    );
    expect(beforeCash).toBeGreaterThan(spent);
    state = nextActorTurn(state);
    const repeat = applyPlayerCommand(state, actor, {
      type: "RENOVATE_PROPERTY",
      assetId: asset.id,
    });
    expect(repeat.ok).toBe(false);
    expect(repeat.state).toBe(state);
  });
  it("resets variable rates over the original remaining maturity while preserving arrears and principal", () => {
    const { loan } = buy(ready(), "variable");
    const original = {
      ...loan,
      outstandingPrincipalCents: cents(7_000_000),
      pastDuePrincipalCents: cents(100_000),
      unpaidInterestCents: cents(50_000),
      periodsProcessed: 4,
      lastProcessedQuarter: 5,
    };
    const reset = resetVariableAssetLoan(original, 600, 6);
    expect(reset.annualRateBps).toBe(775);
    expect(reset.maturityQuarter).toBe(loan.maturityQuarter);
    expect(reset.firstDueQuarter).toBe(loan.firstDueQuarter);
    expect(reset.pastDuePrincipalCents).toBe(100_000);
    expect(reset.unpaidInterestCents).toBe(50_000);
    expect(reset.scheduledQuarterlyPaymentCents).toBe(
      calculateAmortizingSchedule({
        principalCents: 7_000_000,
        annualRateBps: 775,
        termQuarters: loan.maturityQuarter - 6 + 1,
      })[0]!.paymentCents,
    );
    expect(
      calculateLoanObligation(reset, loan.maturityQuarter)!.principalDueCents,
    ).toBe(reset.outstandingPrincipalCents);
    expect(
      resetVariableAssetLoan({ ...loan, pricing: { kind: "fixed" } }, 600, 6),
    ).toEqual({ ...loan, pricing: { kind: "fixed" } });
  });
  it.each([
    { principal: 400, payment: 8, interest: 7 },
    { principal: 217, payment: 5, interest: 4 },
  ])(
    "services a $principal-cent mortgage after a rounded-cent rate reset",
    ({ principal, payment, interest }) => {
      const { state, loan } = buy(ready(), "variable", principal);
      expect(loan.annualRateBps).toBe(625);
      // Supply the next rate directly at the reset boundary. Automatic economy rate
      // changes arrive in a later packet.
      const reset = resetVariableAssetLoan(loan, 500, 2);
      const rateMoved: GameState = {
        ...state,
        finance: {
          ...state.finance,
          loansById: { ...state.finance.loansById, [loan.id]: reset },
        },
      };
      expect(reset).toMatchObject({
        annualRateBps: 675,
        maturityQuarter: loan.maturityQuarter,
        outstandingPrincipalCents: principal,
        scheduledQuarterlyPaymentCents: payment,
      });
      expect(calculateLoanObligation(reset, 2)).toMatchObject({
        interestDueCents: interest,
        principalDueCents: 1,
      });
      expect(() =>
        assertGameState(JSON.parse(JSON.stringify(rateMoved))),
      ).not.toThrow();
      const next = settleCurrent(rateMoved);
      expect(next.currentQuarter).toBe(2);
      const paid = settleCurrent(
        accepted(next, actor, { type: "BEGIN_ROUND" }),
      );
      expect(paid.finance.loansById[loan.id]).toMatchObject({
        outstandingPrincipalCents: principal - 1,
        principalRepaidCents: 1,
        unpaidInterestCents: 0,
      });
    },
  );
  it("keeps property cash, loan terms and management private under paired unrelated states", () => {
    const { state, asset, loan } = buy();
    const other = ids[2]!;
    const changed = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: {
          ...state.finance.assetsById,
          [asset.id]: {
            ...asset,
            cashCents: cents(900_000),
            scheduledQuarterlyRentCents: cents(1_000_000),
          },
        },
        loansById: {
          ...state.finance.loansById,
          [loan.id]: { ...loan, annualRateBps: basisPoints(800) },
        },
      },
    };
    expect(projectPlayerGameState(changed, other)).toEqual(
      projectPlayerGameState(state, other),
    );
    expect(
      projectPlayerGameState(state, actor).self.loans.find(
        (item) => item.id === loan.id,
      )?.role,
    ).toBe("asset-borrower");
  });
  it("keeps mortgage defaults at the asset, accepts voluntary owner reserves and cures arrears once", () => {
    const bought = buy();
    let state = nextActorTurn(bought.state);
    const id = bought.asset.id;
    const asset = state.finance.assetsById[id] as PropertyAsset;
    const empty = {
      ...asset,
      cashCents: cents(0),
      scheduledQuarterlyRentCents: cents(0),
    };
    state = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: { ...state.finance.assetsById, [id]: empty },
        quarterStartBasis: {
          ...state.finance.quarterStartBasis,
          propertiesById: {
            ...state.finance.quarterStartBasis.propertiesById,
            [id]: empty,
          },
        },
      },
    };
    const personalCash = state.finance.cashByPlayer[actor]!;
    state = settleCurrent(state);
    const missed = state.finance.lastSettlement!.loanPayments.find(
      (row) => row.loanId === bought.loan.id,
    )!;
    expect(missed.paidCents).toBe(0);
    expect(missed.closingUnpaidInterestCents).toBeGreaterThan(0);
    expect(missed.closingPastDuePrincipalCents).toBeGreaterThan(0);
    expect(
      state.finance.lastSettlement!.livingByPlayer[actor]!.closingArrearsCents,
    ).toBe(0);
    expect(state.finance.cashByPlayer[actor]).toBeGreaterThan(personalCash);
    state = nextActorTurn(state);
    const rejected = applyPlayerCommand(state, actor, {
      type: "REFINANCE_PROPERTY",
      assetId: id,
      rateKind: "fixed",
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.state).toBe(state);
    state = accepted(state, actor, {
      type: "FUND_PROPERTY_RESERVE",
      assetId: id,
      amountCents: 1_000_000,
    });
    state = settleCurrent(state);
    const cured = state.finance.loansById[bought.loan.id]!;
    expect(cured.unpaidInterestCents).toBe(0);
    expect(cured.pastDuePrincipalCents).toBe(0);
    expect(
      state.finance.lastSettlement!.loanPayments.filter(
        (row) => row.loanId === bought.loan.id,
      ),
    ).toHaveLength(1);
  });
  it("distributes after debt proportionally and blocks unilateral shared sale or refinance", () => {
    const bought = buy();
    let state = nextActorTurn(bought.state);
    const second = ids[1]!;
    const property = {
      ...(state.finance.assetsById[bought.asset.id] as PropertyAsset),
      ownershipByPlayerPpm: {
        [actor]: ownershipPpm(600_000),
        [second]: ownershipPpm(400_000),
      },
    };
    const finance = {
      ...state.finance,
      assetsById: { ...state.finance.assetsById, [property.id]: property },
      quarterStartBasis: {
        ...state.finance.quarterStartBasis,
        propertiesById: {
          ...state.finance.quarterStartBasis.propertiesById,
          [property.id]: property,
        },
      },
    };
    const previousProgress = state.progress;
    state = {
      ...state,
      finance,
      progress: createProgress(finance, state.playerOrder),
    };
    // Preserve already-settled bounded observations when establishing a synthetic ownership fixture.
    state = {
      ...state,
      progress: {
        byPlayer: Object.fromEntries(
          state.playerOrder.map((id) => [
            id,
            {
              ...state.progress.byPlayer[id]!,
              quarters: previousProgress.byPlayer[id]!.quarters,
            },
          ]),
        ),
      },
    };
    assertGameState(state);
    for (const command of [
      { type: "SELL_PROPERTY", assetId: property.id },
      { type: "REFINANCE_PROPERTY", assetId: property.id, rateKind: "fixed" },
    ] as const) {
      const result = applyPlayerCommand(state, actor, command);
      expect(result.ok).toBe(false);
      expect(result.state).toBe(state);
    }
    state = settleCurrent(state);
    const net =
      calculatePropertyCashFlow(property).netOperatingIncomeCents -
      bought.quote.quarterlyPaymentCents;
    expect(
      state.progress.byPlayer[actor]!.quarters.at(-1)!.sourcesById[
        `asset:${property.id}`
      ]!.recurringReceivedCents,
    ).toBe(Math.round(net * 0.6));
    expect(
      state.progress.byPlayer[second]!.quarters.at(-1)!.sourcesById[
        `asset:${property.id}`
      ]!.recurringReceivedCents,
    ).toBe(net - Math.round(net * 0.6));
  });
  it("leaves the legacy mortgage personal until a fully funded sale clears it", () => {
    let state = ready(true, "legacy-property-0");
    for (
      let n = 1;
      n < 20 &&
      !Object.values(state.finance.loansById).some(
        (loan) =>
          loan.kind === "legacy-bank-loan" &&
          loan.purpose === "property-mortgage",
      );
      n++
    )
      state = ready(true, `legacy-property-${n}`);
    const mortgage = Object.values(state.finance.loansById).find(
      (loan) =>
        loan.kind === "legacy-bank-loan" &&
        loan.purpose === "property-mortgage",
    )!;
    if (mortgage.kind !== "legacy-bank-loan" || !mortgage.relatedAssetId)
      throw new Error("Missing legacy fixture");
    const owner = mortgage.borrowerPlayerId;
    while (getActiveSpotlightPlayerId(state) !== owner)
      state = accepted(state, getActiveSpotlightPlayerId(state)!, {
        type: "PASS_SPOTLIGHT",
      });
    const result = applyPlayerCommand(state, owner, {
      type: "SELL_PROPERTY",
      assetId: mortgage.relatedAssetId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(
      result.state.finance.loansById[mortgage.id]!.outstandingPrincipalCents,
    ).toBe(0);
    expect(
      result.journalEntries.find(
        (entry) =>
          entry.relatedLoanId === mortgage.id &&
          entry.reason === "asset-bank-loan-payoff",
      )!.loanPayment!.interestCents,
    ).toBe(350625);
    expect(
      result.journalEntries.some(
        (entry) =>
          entry.relatedLoanId === mortgage.id &&
          entry.reason === "legacy-mortgage-payment",
      ),
    ).toBe(false);
  });
  it("rolls back the funded property close when its fourth-spotlight settlement cannot post", () => {
    let state = ready();
    const buyer = ids[3]!;
    state = {
      ...state,
      round: { stage: "spotlight", spotlightsCompleted: 3 },
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [actor]: cents(Number.MAX_SAFE_INTEGER),
          [buyer]: cents(100_000_000),
        },
      },
    };
    const result = applyPlayerCommand(state, buyer, {
      type: "BUY_PROPERTY",
      catalogueId: "residential-duplex",
      principalCents: 0,
      rateKind: "fixed",
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(result.journalEntries).toEqual([]);
    expect(
      Object.values(state.finance.assetsById).some(
        (asset) =>
          asset.kind === "property" &&
          asset.catalogueId === "residential-duplex",
      ),
    ).toBe(false);
  });
  it("weights positive recurring sources separately from full negative flows and applies cash reserve grade boundaries", () => {
    const bought = buy();
    const zeroFunds = {
      "broad-market-fund": cents(0),
      "growth-fund": cents(0),
      "income-defensive-fund": cents(0),
    };
    const base: GameState = {
      ...bought.state,
      finance: {
        ...bought.state.finance,
        assetsById: {},
        loansById: {},
        cashByPlayer: {
          ...bought.state.finance.cashByPlayer,
          [actor]: cents(0),
        },
        publicMarketsByPlayer: {
          ...bought.state.finance.publicMarketsByPlayer,
          [actor]: zeroFunds,
        },
        recurringByPlayer: {
          ...bought.state.finance.recurringByPlayer,
          [actor]: {
            quarterlyIncomeCents: cents(100_000),
            quarterlyLivingExpenseCents: cents(1_000_000),
          },
        },
      },
    };
    const positive: PropertyAsset = {
      ...bought.asset,
      id: asAssetId("positive"),
      scheduledQuarterlyRentCents: cents(200_000),
      occupancyBps: basisPoints(10_000),
      operatingExpenseRatioBps: basisPoints(0),
    };
    const negative: PropertyAsset = {
      ...bought.asset,
      id: asAssetId("negative"),
      scheduledQuarterlyRentCents: cents(0),
    };
    const paired: GameState = {
      ...base,
      finance: {
        ...base.finance,
        assetsById: { [positive.id]: positive, [negative.id]: negative },
        loansById: {
          [bought.loan.id]: { ...bought.loan, borrowerAssetId: negative.id },
        },
      },
    };
    expect(
      bankBorrowerStrength(paired, actor).qualifyingQuarterlyIncomeCents,
    ).toBe(200_000 - bought.loan.scheduledQuarterlyPaymentCents);
    for (const [cash, grade] of [
      [4_000_000, "excellent"],
      [2_000_000, "good"],
      [1_000_000, "moderate"],
      [999_999, "limited"],
    ] as const)
      expect(
        bankBorrowerStrength(
          {
            ...base,
            finance: {
              ...base.finance,
              cashByPlayer: {
                ...base.finance.cashByPlayer,
                [actor]: cents(cash),
              },
            },
          },
          actor,
        ).grade,
      ).toBe(grade);
    const liquid = {
      ...base,
      finance: {
        ...base.finance,
        cashByPlayer: { ...base.finance.cashByPlayer, [actor]: cents(100_000) },
        publicMarketsByPlayer: {
          ...base.finance.publicMarketsByPlayer,
          [actor]: { ...zeroFunds, "broad-market-fund": cents(1_000_000) },
        },
      },
    };
    expect(bankBorrowerStrength(liquid, actor).qualifyingLiquidityCents).toBe(
      900_000,
    );
  });

  it("rejects corrupted asset debt, cash and prepaid-interest snapshot contracts", () => {
    const { state, asset, loan } = buy();
    const missingPaymentBasis = JSON.parse(JSON.stringify(state));
    delete missingPaymentBasis.finance.loansById[loan.id]
      .paymentBasisPrincipalCents;
    expect(() => assertGameState(missingPaymentBasis)).toThrow();
    const missingAssetCash = JSON.parse(JSON.stringify(state));
    delete missingAssetCash.finance.assetsById[asset.id].cashCents;
    expect(() => assertGameState(missingAssetCash)).toThrow();
    const invalidPurpose = JSON.parse(JSON.stringify(state));
    invalidPurpose.finance.loansById[loan.id].purpose = "unknown";
    expect(() => assertGameState(invalidPurpose)).toThrow();
    const invalidPrepayment = JSON.parse(JSON.stringify(state));
    invalidPrepayment.finance.prepaidAssetInterest = {
      quarter: 1,
      byAssetId: {
        [asset.id]: {
          interestCents: 100,
          ownershipByPlayerPpm: { unknown: 1_000_000 },
        },
      },
    };
    expect(() => assertGameState(invalidPrepayment)).toThrow();
    const invalidCatalogue = JSON.parse(JSON.stringify(state));
    invalidCatalogue.finance.assetsById[asset.id].catalogueId = "unknown";
    expect(() => assertGameState(invalidCatalogue)).toThrow();
  });
  it("defers renovation valuation and operating improvements until the next quarter", () => {
    const bought = buy();
    let state = nextActorTurn(bought.state);
    state = accepted(state, actor, { type: "PASS_SPOTLIGHT" });
    state = nextActorTurn(state);
    const before = state.finance.assetsById[bought.asset.id] as PropertyAsset;
    state = accepted(state, actor, {
      type: "RENOVATE_PROPERTY",
      assetId: bought.asset.id,
    });
    expect(state.currentQuarter).toBe(3);
    const pending = state.finance.assetsById[bought.asset.id] as PropertyAsset;
    expect(pending.marketValueCents).toBe(before.marketValueCents);
    expect(pending.scheduledQuarterlyRentCents).toBe(
      before.scheduledQuarterlyRentCents,
    );
    expect(pending.occupancyBps).toBe(before.occupancyBps);
    expect(pending.renovationPending).toEqual({
      costCents: 1_000_000,
      effectiveQuarter: 4,
    });
    state = settleCurrent(state);
    const improved = state.finance.assetsById[bought.asset.id] as PropertyAsset;
    expect(improved.marketValueCents).toBe(before.marketValueCents + 800_000);
    expect(improved.scheduledQuarterlyRentCents).toBe(288_750);
    expect(improved.occupancyBps).toBe(10_000);
    expect(improved.renovationPending).toBeUndefined();
  });
});
