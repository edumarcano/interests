import {
  asAssetId,
  asLoanId,
  asPlayerId,
  type JointPropertyCommand,
  type JointPropertyTerms,
} from "@interests/shared";
import { describe, expect, it } from "vitest";
import { stageOpeningFixture } from "../../test/openingFixture";
import { calculateAmortizingSchedule } from "../finance/amortization";
import { bankPayoff } from "../finance/bank";
import { basisPoints, cents } from "../finance/money";
import { allocateProportionalCents, ownershipPpm } from "../finance/ownership";
import { calculatePropertyCashFlow } from "../finance/property";
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
import { getReservedCashCents } from "./reservations";

const ids = ["A", "B", "C", "D"].map(asPlayerId);
const a = ids[0]!,
  b = ids[1]!,
  c = ids[2]!;
const assetId = asAssetId("joint-property-fixture"),
  loanId = asLoanId("joint-property-bank");
function accepted(
  state: GameState,
  actor: typeof a,
  command: Parameters<typeof applyPlayerCommand>[2],
): GameState {
  const result = applyPlayerCommand(state, actor, command);
  expect(result.ok, result.ok ? undefined : result.code).toBe(true);
  if (!result.ok) throw new Error(result.code);
  assertGameState(result.state);
  return result.state;
}
function fixture(): GameState {
  let state = createGame({
    gameId: "joint-properties",
    seed: "joint-properties",
    playerIds: ids,
  });
  for (const actor of ids)
    state = accepted(state, actor, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[actor]!.offeredObjectiveIds[0],
    });
  const payment = calculateAmortizingSchedule({
    principalCents: 18_000_000,
    annualRateBps: 675,
    termQuarters: 120,
  })[0]!.paymentCents;
  const property: PropertyAsset = {
    id: assetId,
    kind: "property",
    marketValueCents: cents(33_000_000),
    scheduledQuarterlyRentCents: cents(945_000),
    occupancyBps: basisPoints(9500),
    operatingExpenseRatioBps: basisPoints(3500),
    cashCents: payment,
    debtServiceReserveCents: payment,
    ownershipByPlayerPpm: {
      [a]: ownershipPpm(600_000),
      [b]: ownershipPpm(400_000),
    },
  };
  const loan: AssetBankLoan = {
    id: loanId,
    kind: "asset-bank-loan",
    borrowerAssetId: assetId,
    leadPlayerId: a,
    purpose: "property-mortgage",
    originalPrincipalCents: cents(18_000_000),
    outstandingPrincipalCents: cents(18_000_000),
    annualRateBps: basisPoints(675),
    pricing: { kind: "fixed" },
    scheduledQuarterlyPaymentCents: payment,
    firstDueQuarter: 2,
    maturityQuarter: 121,
    termQuarters: 120,
    periodsProcessed: 0,
    interestPaidThroughQuarter: 1,
    paymentResetQuarter: 2,
    paymentBasisPrincipalCents: cents(18_000_000),
    principalRepaidCents: cents(0),
    pastDuePrincipalCents: cents(0),
    unpaidInterestCents: cents(0),
    lastProcessedQuarter: 0,
  };
  state = stageOpeningFixture({
    ...state,
    finance: {
      ...state.finance,
      cashByPlayer: Object.fromEntries(
        ids.map((id) => [id, cents(100_000_000)]),
      ),
      assetsById: { ...state.finance.assetsById, [assetId]: property },
      loansById: { ...state.finance.loansById, [loanId]: loan },
    },
  });
  return accepted(state, a, { type: "BEGIN_ROUND" });
}
function tx(state: GameState) {
  const active = state.activeTransaction;
  if (active?.kind !== "joint-property") throw new Error("Missing joint deal");
  return active;
}
function open(state: GameState, terms: JointPropertyTerms) {
  return accepted(state, a, { type: "OPEN_JOINT_PROPERTY", assetId, terms });
}
function bound(
  state: GameState,
  type: Exclude<
    JointPropertyCommand["type"],
    "OPEN_JOINT_PROPERTY" | "REVISE_JOINT_PROPERTY"
  >,
): JointPropertyCommand {
  return {
    type,
    transactionId: tx(state).id,
    expectedTermsRevision: tx(state).termsRevision,
  };
}
function allConfirm(state: GameState) {
  state = accepted(state, a, bound(state, "CONFIRM_JOINT_PROPERTY"));
  return accepted(state, b, bound(state, "CONFIRM_JOINT_PROPERTY"));
}
function toNextATurn(state: GameState) {
  state = accepted(state, a, { type: "PASS_SPOTLIGHT" });
  for (let n = 0; n < 9; n++) {
    if (state.round!.stage === "round-start")
      state = accepted(state, a, { type: "BEGIN_ROUND" });
    const actor = getActiveSpotlightPlayerId(state)!;
    if (actor === a) return state;
    state = accepted(state, actor, { type: "PASS_SPOTLIGHT" });
  }
  throw new Error("No turn");
}

describe("unanimous joint-property transactions", () => {
  it("requires every current owner, binds terms revisions, reserves only explicit payer cash and releases on withdrawal/cancel", () => {
    let state = open(fixture(), { kind: "renovation" });
    const initial = state;
    const quote = tx(state).quote;
    if (quote.kind !== "renovation") throw new Error();
    expect(quote.payerPlayerId).toBe(a);
    expect(quote.cashRequiredCents).toBe(1_650_000);
    const offOwner = applyPlayerCommand(
      state,
      c,
      bound(state, "CONFIRM_JOINT_PROPERTY"),
    );
    expect(offOwner.ok).toBe(false);
    expect(offOwner.state).toBe(state);
    state = accepted(state, a, bound(state, "CONFIRM_JOINT_PROPERTY"));
    expect(getReservedCashCents(state, a)).toBe(1_650_000);
    expect(getReservedCashCents(state, b)).toBe(0);
    const close = applyPlayerCommand(
      state,
      a,
      bound(state, "CLOSE_JOINT_PROPERTY"),
    );
    expect(close.ok).toBe(false);
    expect(close.state).toBe(state);
    const oldRevision = tx(state).termsRevision;
    state = accepted(state, a, {
      type: "REVISE_JOINT_PROPERTY",
      transactionId: tx(state).id,
      expectedTermsRevision: oldRevision,
      terms: { kind: "sale" },
    });
    expect(tx(state).confirmedPlayerIds).toEqual([]);
    expect(getReservedCashCents(state, a)).toBe(0);
    const stale = applyPlayerCommand(state, b, {
      type: "CONFIRM_JOINT_PROPERTY",
      transactionId: tx(state).id,
      expectedTermsRevision: oldRevision,
    });
    expect(stale.ok).toBe(false);
    expect(stale.state).toBe(state);
    state = accepted(state, b, bound(state, "CONFIRM_JOINT_PROPERTY"));
    state = accepted(state, b, bound(state, "WITHDRAW_JOINT_PROPERTY"));
    expect(tx(state).confirmedPlayerIds).toEqual([]);
    const before = state;
    state = accepted(state, a, bound(state, "CANCEL_JOINT_PROPERTY"));
    expect(state.activeTransaction).toBeNull();
    expect(state.round!.spotlightsCompleted).toBe(1);
    expect(state.revision).toBe(before.revision + 1);
    expect(state.finance).toBe(initial.finance);
    expect(state.random).toBe(initial.random);
  });
  it("sells atomically, pays bank interest once and distributes every net cent pro rata while preserving earned Q2 rights", () => {
    let state = toNextATurn(fixture());
    const before = state;
    const property = state.finance.assetsById[assetId] as PropertyAsset;
    state = allConfirm(open(state, { kind: "sale" }));
    const deal = tx(state);
    if (deal.quote.kind !== "sale") throw new Error();
    const quote = deal.quote;
    const result = applyPlayerCommand(
      state,
      a,
      bound(state, "CLOSE_JOINT_PROPERTY"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    state = result.state;
    expect(state.currentQuarter).toBe(3);
    expect(state.revision).toBe(result.state.revision);
    expect(state.activeTransaction).toBeNull();
    expect(
      (state.finance.assetsById[assetId] as PropertyAsset).disposition,
    ).toBe("sold");
    expect(state.finance.loansById[loanId]!.outstandingPrincipalCents).toBe(0);
    const payouts = result.journalEntries.filter(
      (entry) =>
        entry.reason === "property-sale-proceeds" &&
        entry.relatedAssetId === assetId,
    );
    expect(payouts.reduce((sum, row) => sum + row.amountCents, 0)).toBe(
      quote.netProceedsCents,
    );
    for (const row of payouts) {
      if (row.destination.kind !== "player") throw new Error();
      expect(row.amountCents).toBe(
        quote.proceedsByPlayer[row.destination.playerId],
      );
      expect(row.relatedTransactionId).toBe(deal.id);
    }
    const payoff = result.journalEntries.find(
      (entry) =>
        entry.reason === "asset-bank-loan-payoff" &&
        entry.relatedAssetId === assetId,
    )!;
    expect(payoff.loanPayment!.interestCents).toBe(
      bankPayoff(before, before.finance.loansById[loanId]!).interestCents,
    );
    const earned = allocateProportionalCents(
      calculatePropertyCashFlow(property).netOperatingIncomeCents,
      property.ownershipByPlayerPpm,
    );
    for (const owner of [a, b])
      expect(
        state.progress.byPlayer[owner]!.quarters.at(-1)!.sourcesById[
          `asset:${assetId}`
        ]!.recurringReceivedCents,
      ).toBe(earned[owner]);
    for (const owner of [a, b]) {
      expect(
        state.progress.byPlayer[owner]!.assetsById[assetId],
      ).toBeUndefined();
      expect(state.progress.byPlayer[owner]!.disposals.at(-1)!.assetId).toBe(
        assetId,
      );
    }
    expect(
      applyPlayerCommand(state, a, {
        type: "CLOSE_JOINT_PROPERTY",
        transactionId: deal.id,
        expectedTermsRevision: deal.termsRevision,
      }).ok,
    ).toBe(false);
  });
  it("renovates only after both confirmations, charging only the named owner and preserving this quarter's inputs", () => {
    let state = fixture();
    const original = state;
    state = allConfirm(open(state, { kind: "renovation" }));
    const result = applyPlayerCommand(
      state,
      a,
      bound(state, "CLOSE_JOINT_PROPERTY"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    state = result.state;
    expect(state.finance.cashByPlayer[a]).toBe(
      original.finance.cashByPlayer[a]! - 1_650_000,
    );
    expect(state.finance.cashByPlayer[b]).toBe(
      original.finance.cashByPlayer[b],
    );
    const property = state.finance.assetsById[assetId] as PropertyAsset;
    expect(property.renovationPending).toEqual({
      costCents: 1_650_000,
      effectiveQuarter: 2,
    });
    expect(property.marketValueCents).toBe(33_000_000);
    expect(state.finance.quarterStartBasis.propertiesById[assetId]).toEqual(
      original.finance.quarterStartBasis.propertiesById[assetId],
    );
    expect(state.progress.byPlayer[a]!.assetsById[assetId]!.costCents).toBe(
      original.progress.byPlayer[a]!.assetsById[assetId]!.costCents + 1_650_000,
    );
    expect(state.progress.byPlayer[b]).toEqual(original.progress.byPlayer[b]);
  });
  it("refinances a shared performing loan with one payer, no cash out and the agreed fixed/variable terms", () => {
    const original = fixture();
    let state = allConfirm(
      open(original, { kind: "refinance", rateKind: "variable" }),
    );
    const deal = tx(state);
    if (deal.quote.kind !== "refinance") throw new Error();
    const quoted = deal.quote;
    state = accepted(state, a, bound(state, "CLOSE_JOINT_PROPERTY"));
    expect(state.finance.cashByPlayer[a]).toBe(
      original.finance.cashByPlayer[a]! - quoted.cashRequiredCents,
    );
    expect(state.finance.cashByPlayer[b]).toBe(
      original.finance.cashByPlayer[b],
    );
    expect(state.finance.loansById[loanId]!.outstandingPrincipalCents).toBe(0);
    const replacement = Object.values(state.finance.loansById).find(
      (loan) =>
        loan.kind === "asset-bank-loan" &&
        loan.id !== loanId &&
        loan.borrowerAssetId === assetId,
    )!;
    expect(replacement).toMatchObject({
      originalPrincipalCents: quoted.principalCents,
      annualRateBps: quoted.annualRateBps,
      pricing: { kind: "variable" },
      firstDueQuarter: 2,
    });
    expect(replacement).not.toHaveProperty("borrowerPlayerId");
    expect(
      (state.finance.assetsById[assetId] as PropertyAsset).ownershipByPlayerPpm,
    ).toEqual(
      (original.finance.assetsById[assetId] as PropertyAsset)
        .ownershipByPlayerPpm,
    );
  });
  it("keeps terms/holdings private from nonowners and never projects the payer's personal reserve or grade", () => {
    const state = allConfirm(
      open(fixture(), { kind: "refinance", rateKind: "fixed" }),
    );
    const unrelated = projectPlayerGameState(state, c);
    expect(unrelated.hasActiveTransaction).toBe(true);
    expect(unrelated.jointProperty).toBeNull();
    const owner = projectPlayerGameState(state, b);
    expect(owner.jointProperty!.quote.kind).toBe("refinance");
    expect(JSON.stringify(owner.jointProperty)).not.toContain(
      "personalReserve",
    );
    expect(JSON.stringify(owner.jointProperty)).not.toContain("creditGrade");
    const paired = {
      ...state,
      finance: {
        ...state.finance,
        cashByPlayer: {
          ...state.finance.cashByPlayer,
          [b]: cents(state.finance.cashByPlayer[b]! + 1234),
        },
      },
    };
    expect(projectPlayerGameState(paired, c)).toEqual(unrelated);
    expect(
      applyPlayerCommand(paired, c, bound(paired, "CONFIRM_JOINT_PROPERTY")),
    ).toMatchObject({ ok: false, code: "PROPERTY_OWNER_REQUIRED" });
  });
  it("rejects changed ownership, stale frozen quotes and closing/settlement overflow without partial effects", () => {
    let state = allConfirm(open(toNextATurn(fixture()), { kind: "sale" }));
    const property = state.finance.assetsById[assetId] as PropertyAsset;
    const changed = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: {
          ...state.finance.assetsById,
          [assetId]: {
            ...property,
            ownershipByPlayerPpm: {
              [a]: ownershipPpm(500_000),
              [b]: ownershipPpm(500_000),
            },
          },
        },
      },
    };
    const rights = applyPlayerCommand(
      changed,
      a,
      bound(state, "CLOSE_JOINT_PROPERTY"),
    );
    expect(rights.ok).toBe(false);
    expect(rights.state).toBe(changed);
    const repriced = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: {
          ...state.finance.assetsById,
          [assetId]: {
            ...property,
            marketValueCents: cents(property.marketValueCents + 1),
          },
        },
      },
    };
    const stale = applyPlayerCommand(
      repriced,
      a,
      bound(state, "CLOSE_JOINT_PROPERTY"),
    );
    expect(stale.ok).toBe(false);
    expect(stale.state).toBe(repriced);
    state = {
      ...state,
      counters: { ...state.counters, journal: Number.MAX_SAFE_INTEGER - 10 },
    };
    const before = JSON.stringify(state);
    const failed = applyPlayerCommand(
      state,
      a,
      bound(state, "CLOSE_JOINT_PROPERTY"),
    );
    expect(failed.ok).toBe(false);
    expect(failed.state).toBe(state);
    expect(failed.journalEntries).toEqual([]);
    expect(JSON.stringify(state)).toBe(before);
    const corrupt = JSON.parse(before) as GameState;
    if (corrupt.activeTransaction?.kind !== "joint-property") throw new Error();
    Object.assign(corrupt.activeTransaction.quote, { payoffCents: 1 });
    expect(() => assertGameState(corrupt)).toThrow();
  });
  it("keeps a frozen proposal loadable after payer capacity changes, while rejecting the changed closing quote", () => {
    const original = allConfirm(
      open(fixture(), { kind: "refinance", rateKind: "fixed" }),
    );
    const changed = {
      ...original,
      finance: {
        ...original.finance,
        cashByPlayer: {
          ...original.finance.cashByPlayer,
          [a]: cents(1_000_000),
        },
      },
    };
    expect(() => assertGameState(changed)).not.toThrow();
    const result = applyPlayerCommand(
      changed,
      a,
      bound(changed, "CLOSE_JOINT_PROPERTY"),
    );
    expect(result.ok).toBe(false);
    expect(result.state).toBe(changed);
    expect(result.journalEntries).toEqual([]);
    expect(getReservedCashCents(changed, a)).toBeGreaterThan(0);
    const withdrawn = accepted(
      changed,
      a,
      bound(changed, "WITHDRAW_JOINT_PROPERTY"),
    );
    expect(getReservedCashCents(withdrawn, a)).toBe(0);
    expect(tx(withdrawn).confirmedPlayerIds).toEqual([b]);
    expect(
      accepted(changed, a, bound(changed, "CANCEL_JOINT_PROPERTY"))
        .activeTransaction,
    ).toBeNull();
  });
});
