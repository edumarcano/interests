import { asPlayerId, type PlayerId } from "@interests/shared";
import { expect, it } from "vitest";
import { bankPayoff } from "../finance/bank";
import { cents } from "../finance/money";
import { propertyManagement, propertyOffers } from "../finance/propertyActions";
import { createGame } from "../game/createGame";
import {
  applyPlayerCommand,
  type WirePlayerCommand,
} from "../game/playerCommand";
import { projectPlayerGameState } from "../game/playerView";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type {
  AssetBankLoan,
  GameState,
  PlayerLoan,
  PropertyAsset,
} from "../model/gameState";
import { evaluateObjective } from "./evaluate";
import { collectPlayerObjectiveEvidence } from "./evidence";
import { measurePlayerObjectives } from "./measurements";

const ids = ["a", "b", "c", "d"].map(asPlayerId);
const actor = ids[0]!;
function command(
  state: GameState,
  player: PlayerId,
  command: WirePlayerCommand,
) {
  const result = applyPlayerCommand(state, player, command);
  if (!result.ok) throw new Error(result.code);
  assertGameState(result.state);
  return result.state;
}
function setup(seed: string) {
  let state = createGame({
    gameId: "objective-evidence",
    seed,
    playerIds: ids,
  });
  for (const id of ids)
    state = command(state, id, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[id]!.offeredObjectiveIds[0],
    });
  return state;
}
function profileState(profile: string) {
  for (let seed = 0; seed < 100; seed++) {
    const state = setup(`objective-property-${seed}`);
    if (state.players[actor]!.profileId === profile) return state;
  }
  throw new Error("Profile seed absent");
}
function actorTurn(state: GameState, player = actor) {
  for (let attempts = 0; attempts < 10; attempts++) {
    if (state.round?.stage === "round-start")
      state = command(state, actor, { type: "BEGIN_ROUND" });
    const active = getActiveSpotlightPlayerId(state)!;
    if (active === player) return state;
    state = command(state, active, { type: "PASS_SPOTLIGHT" });
  }
  throw new Error("No actor spotlight");
}
function finishQuarter(state: GameState) {
  const quarter = state.currentQuarter;
  while (state.currentQuarter === quarter)
    state = command(state, getActiveSpotlightPlayerId(state)!, {
      type: "PASS_SPOTLIGHT",
    });
  return state;
}
function ordinaryProperty() {
  let state = actorTurn(profileState("disciplined-saver"));
  const offer = propertyOffers(state, actor)[0]!;
  const maximum = offer.quotes.find(
    (quote) => quote.canClose && quote.principalCents > 0,
  )!;
  expect(maximum).toBeDefined();
  state = command(state, actor, {
    type: "BUY_PROPERTY",
    catalogueId: offer.catalogueId,
    principalCents: Math.floor(maximum.principalCents * 0.9),
    rateKind: maximum.rateKind,
  });
  const property = Object.values(state.finance.assetsById).find(
    (asset): asset is PropertyAsset =>
      asset.kind === "property" && asset.catalogueId === offer.catalogueId,
  )!;
  const loan = Object.values(state.finance.loansById).find(
    (loan): loan is AssetBankLoan =>
      loan.kind === "asset-bank-loan" && loan.borrowerAssetId === property.id,
  )!;
  return { state, property, loan };
}
function ordinaryLending() {
  for (let seed = 0; seed < 100; seed++) {
    let state = setup(`objective-lending-${seed}`);
    const opportunity = Object.values(state.opportunitiesById)[0]!;
    const borrower = opportunity.targetPlayerId;
    const lender = ids.find(
      (id) =>
        id !== borrower &&
        id !== opportunity.sellerPlayerId &&
        state.finance.cashByPlayer[id]! >= opportunity.askingPriceCents,
    );
    if (!lender) continue;
    state = actorTurn(state, borrower);
    state = command(state, borrower, {
      type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
      opportunityId: opportunity.id,
      buyerCashContributionCents: 0,
      requestedPrincipalCents: opportunity.askingPriceCents,
    });
    const transactionId = state.activeTransaction!.id;
    state = command(state, lender, {
      type: "SUBMIT_PLAYER_LOAN_OFFER",
      transactionId,
      annualRateBps: 800,
      termQuarters: 8,
    });
    const transaction = state.activeTransaction!;
    if (transaction.kind !== "cash-business-purchase")
      throw new Error("Wrong transaction");
    state = command(state, borrower, {
      type: "ACCEPT_PLAYER_LOAN_OFFER",
      transactionId,
      expectedTermsRevision:
        transaction.playerLoanFinancing!.offer!.termsRevision,
    });
    state = command(state, borrower, {
      type: "CLOSE_BUSINESS_PURCHASE",
      transactionId,
    });
    const loan = Object.values(state.finance.loansById).find(
      (loan): loan is PlayerLoan =>
        loan.kind === "player-loan" &&
        loan.fundedTransactionId === transactionId,
    )!;
    expect(loan.originalPrincipalCents).toBe(5_000_000);
    return { state, lender, borrower, loan };
  }
  throw new Error("No ordinarily affordable lender");
}

it("derives a real new mortgage and property reserves without a duplicate personal guarantee", () => {
  const { state, property, loan } = ordinaryProperty();
  const evidence = collectPlayerObjectiveEvidence(state, actor);
  const claim = evidence.propertyClaims!.find(
    (claim) => claim.assetId === property.id,
  )!;
  expect(claim).toMatchObject({
    principalCents: loan.outstandingPrincipalCents,
    unpaidInterestCents: 0,
    cashReserveCents: property.cashCents,
    pastDuePrincipalCents: 0,
  });
  const measured = measurePlayerObjectives(state, actor);
  expect(measured.propertyValueCents).toBe(property.marketValueCents);
  expect(measured.propertyEquityCents).toBe(
    property.marketValueCents +
      property.cashCents! -
      loan.outstandingPrincipalCents,
  );
  const personalLiabilities = Object.values(state.finance.loansById)
    .filter(
      (loan) =>
        loan.kind === "legacy-bank-loan" && loan.borrowerPlayerId === actor,
    )
    .reduce(
      (sum, loan) =>
        sum + loan.outstandingPrincipalCents + loan.unpaidInterestCents,
      0,
    );
  expect(measured.totalLiabilitiesCents).toBe(
    personalLiabilities + loan.outstandingPrincipalCents,
  );
  expect(
    projectPlayerGameState(state, actor).self.financialDetails
      .objectiveEvaluation,
  ).toEqual(
    evaluateObjective(measured, state.players[actor]!.selectedObjectiveId!),
  );
});
it("keeps the opening legacy mortgage personal and subtracts it from property equity exactly once", () => {
  const state = profileState("property-starter");
  const property = Object.values(state.finance.assetsById).find(
    (asset): asset is PropertyAsset =>
      asset.kind === "property" && (asset.ownershipByPlayerPpm[actor] ?? 0) > 0,
  )!;
  const legacy = Object.values(state.finance.loansById).find(
    (loan) =>
      loan.kind === "legacy-bank-loan" && loan.relatedAssetId === property.id,
  )!;
  const claim = collectPlayerObjectiveEvidence(
    state,
    actor,
  ).propertyClaims!.find((claim) => claim.assetId === property.id)!;
  expect(claim.principalCents).toBe(0);
  const measured = measurePlayerObjectives(state, actor);
  expect(measured.propertyPrincipalCents).toBe(
    legacy.outstandingPrincipalCents,
  );
  expect(measured.propertyEquityCents).toBe(
    property.marketValueCents -
      legacy.outstandingPrincipalCents -
      legacy.unpaidInterestCents,
  );
});
it("does not treat an asset payoff's paid interest as relief from another required personal obligation", () => {
  const bought = ordinaryProperty();
  const before = actorTurn(finishQuarter(bought.state));
  const oldLoan = before.finance.loansById[bought.loan.id]!;
  const prepaid = bankPayoff(before, oldLoan).interestCents;
  const quote = propertyManagement(before, actor)
    .find((property) => property.assetId === bought.property.id)!
    .refinancingQuotes.find((quote) => quote.canClose)!;
  expect(quote).toBeDefined();
  const refinanced = command(before, actor, {
    type: "REFINANCE_PROPERTY",
    assetId: bought.property.id,
    rateKind: quote.rateKind,
  });
  const settled =
    refinanced.currentQuarter === before.currentQuarter
      ? finishQuarter(refinanced)
      : refinanced;
  const source = settled.progress.byPlayer[actor]!.quarters.find(
    (quarter) => quarter.quarter === before.currentQuarter,
  )!.sourcesById[`asset:${bought.property.id}`]!;
  expect(source.debtServiceOwedCents).toBe(prepaid);
  expect(source.personalDebtServiceOwedCents ?? 0).toBe(0);
  const measured = measurePlayerObjectives(settled, actor);
  expect(measured.annualRequiredPersonalDebtServiceCents).toBeGreaterThan(0);
  expect(
    measured.annualInvestmentIncomeCents -
      measured.annualInvestmentAfterPersonalDebtServiceCents,
  ).toBe(measured.annualRequiredPersonalDebtServiceCents);
  expect(
    collectPlayerObjectiveEvidence(settled, actor).propertyClaims![0]!
      .principalCents,
  ).toBe(
    Object.values(settled.finance.loansById)
      .filter(
        (loan) =>
          loan.kind === "asset-bank-loan" &&
          loan.borrowerAssetId === bought.property.id,
      )
      .reduce((sum, loan) => sum + loan.outstandingPrincipalCents, 0),
  );
});
it("records real loan interest by loan ID, groups its funded deal and retains lifetime receipts after repayment", () => {
  const started = ordinaryLending();
  let state = started.state;
  expect(state.finance.loansById[started.loan.id]).toMatchObject({
    settledInterestReceipts: [],
    fundedTransactionId: started.loan.fundedTransactionId,
  });
  while (state.lastSettledQuarter < 2) {
    state = actorTurn(state, getActiveSpotlightPlayerId(state) ?? actor);
    state = finishQuarter(state);
  }
  const loan = state.finance.loansById[started.loan.id] as PlayerLoan;
  const payment = state.finance.lastSettlement!.loanPayments.find(
    (payment) => payment.loanId === loan.id,
  )!;
  expect(loan.settledInterestReceipts).toEqual([
    {
      quarter: 2,
      receivedCents: payment.interestPaidCents,
      currentEarnedCents: payment.interestPaidCents,
    },
  ]);
  expect(payment.principalPaidCents).toBeGreaterThan(0);
  const measured = measurePlayerObjectives(state, started.lender);
  expect(measured.earnedFinancingProfitCents).toBe(payment.interestPaidCents);
  expect(measured.performingFinancingBookCents).toBe(
    loan.outstandingPrincipalCents,
  );
  expect(measured.distinctFundedTransactions).toBe(1);
  expect(
    measured.incomeSources.find(
      (source) => source.id === `borrower:${started.borrower}`,
    )!.annualReceivedCents,
  ).toBe(payment.interestPaidCents);
  while (state.lastSettledQuarter < 9) {
    state = actorTurn(state, getActiveSpotlightPlayerId(state) ?? actor);
    state = finishQuarter(state);
  }
  const repaid = state.finance.loansById[started.loan.id] as PlayerLoan;
  expect(repaid.outstandingPrincipalCents).toBe(0);
  expect(repaid.settledInterestReceipts).toHaveLength(8);
  const lifetime = repaid.settledInterestReceipts!.reduce(
    (sum, receipt) => sum + receipt.receivedCents,
    0,
  );
  const after = measurePlayerObjectives(state, started.lender);
  expect(after.earnedFinancingProfitCents).toBe(lifetime);
  expect(after.performingFinancingBookCents).toBe(0);
  const reloaded = JSON.parse(JSON.stringify(state)) as GameState;
  assertGameState(reloaded);
  expect(measurePlayerObjectives(reloaded, started.lender)).toEqual(after);
  expect(
    (reloaded.finance.loansById[started.loan.id] as PlayerLoan)
      .settledInterestReceipts,
  ).toEqual(repaid.settledInterestReceipts);
  expect(
    after.incomeSources.some((source) => source.category === "financing"),
  ).toBe(false);
});
it("never replaces canonical records with caller supplied player-loan or property evidence", () => {
  const property = ordinaryProperty();
  const claims = collectPlayerObjectiveEvidence(property.state, actor)
    .propertyClaims!;
  expect(() =>
    measurePlayerObjectives(property.state, actor, { propertyClaims: claims }),
  ).toThrow("cannot be overridden");
  const lending = ordinaryLending();
  expect(() =>
    measurePlayerObjectives(lending.state, lending.lender, {
      financing: collectPlayerObjectiveEvidence(lending.state, lending.lender)
        .financing,
    }),
  ).toThrow("cannot be overridden");
  const missing = {
    ...lending.state,
    finance: {
      ...lending.state.finance,
      loansById: {
        ...lending.state.finance.loansById,
        [lending.loan.id]: {
          ...lending.loan,
          settledInterestReceipts: undefined,
        },
      },
    },
  };
  expect(() => assertGameState(missing)).toThrow(
    "Missing funded player loan interest receipts",
  );
  expect(() => collectPlayerObjectiveEvidence(missing, lending.lender)).toThrow(
    "Missing canonical",
  );
});
it("rejects invalid receipt money, dates and current-interest duplication at the snapshot invariant", () => {
  const { state, loan } = ordinaryLending();
  for (const receipt of [
    { quarter: 1, receivedCents: 1, currentEarnedCents: 1 },
    { quarter: 2, receivedCents: 1, currentEarnedCents: 2 },
    { quarter: 2, receivedCents: -1, currentEarnedCents: 0 },
  ]) {
    const changed = {
      ...state,
      finance: {
        ...state.finance,
        loansById: {
          ...state.finance.loansById,
          [loan.id]: {
            ...loan,
            lastProcessedQuarter: 2,
            settledInterestReceipts: [receipt],
          },
        },
      },
    } as GameState;
    expect(() => assertGameState(changed)).toThrow(/interest receipt/);
  }
});
it("keeps another lender's private receipt history and evaluation out of a recipient's view", () => {
  const started = ordinaryLending();
  let state = started.state;
  while (state.lastSettledQuarter < 2) {
    state = actorTurn(state, getActiveSpotlightPlayerId(state) ?? actor);
    state = finishQuarter(state);
  }
  const { lender } = started;
  const observer = ids.find((id) => id !== lender && id !== started.borrower)!;
  const loan = state.finance.loansById[started.loan.id] as PlayerLoan;
  const before = projectPlayerGameState(state, observer);
  const changed = {
    ...state,
    finance: {
      ...state.finance,
      loansById: {
        ...state.finance.loansById,
        [loan.id]: {
          ...loan,
          settledInterestReceipts: loan.settledInterestReceipts!.map(
            (receipt) => ({
              ...receipt,
              receivedCents: cents(receipt.receivedCents + 123),
              currentEarnedCents: cents(receipt.currentEarnedCents + 123),
            }),
          ),
        },
      },
    },
  };
  assertGameState(changed);
  expect(
    measurePlayerObjectives(changed, lender).earnedFinancingProfitCents,
  ).toBe(
    measurePlayerObjectives(state, lender).earnedFinancingProfitCents + 123,
  );
  expect(projectPlayerGameState(changed, observer)).toEqual(before);
  const ownerView = projectPlayerGameState(state, lender);
  expect(ownerView.self.financialDetails.objectiveEvaluation!.objectiveId).toBe(
    state.players[lender]!.selectedObjectiveId,
  );
  expect(
    ownerView.players.every((player) => !("objectiveEvaluation" in player)),
  ).toBe(true);
});
