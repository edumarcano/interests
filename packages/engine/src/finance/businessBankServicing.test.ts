import { asLoanId, asPlayerId, type PlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { stageOpeningFixture } from "../../test/openingFixture";
import { createGame } from "../game/createGame";
import { applyPlayerCommand } from "../game/playerCommand";
import { getActiveSpotlightPlayerId } from "../game/round";
import { assertGameState } from "../invariants/assertGameState";
import type {
  AssetBankLoan,
  BusinessAsset,
  GameState,
} from "../model/gameState";
import { calculateAmortizingSchedule } from "./amortization";
import { calculateBusinessEquity } from "./business";
import type { JournalEntry } from "./journal";
import { basisPoints, cents } from "./money";
import { createSoleOwnership } from "./ownership";
import { recordBusinessPurchaseBasis } from "./progress";

const players = ["A", "B", "C", "D"].map(asPlayerId);
const owner = players[0]!;
function fixture(
  options: { profit?: number; cash?: number; starting?: boolean } = {},
) {
  let state = createGame({
    gameId: "business-bank-servicing",
    seed: "business-bank-servicing",
    playerIds: players,
  });
  for (const player of players) {
    const result = applyPlayerCommand(state, player, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[player]!.offeredObjectiveIds[0],
    });
    if (!result.ok) throw new Error(result.code);
    state = result.state;
  }
  const original = Object.values(state.finance.assetsById).find(
    (asset): asset is BusinessAsset =>
      asset.kind === "business" &&
      asset.cashPolicyId ===
        (options.starting ? "starting-company-v1" : "retained-profit-v1"),
  );
  if (!original) throw new Error("Missing synthetic base company");
  const asset: BusinessAsset = {
    ...original,
    annualOperatingProfitCents: cents(options.profit ?? 4_000_000),
    cashCents: cents(options.cash ?? 187_959),
    ...(options.starting
      ? {}
      : {
          enterpriseValueCents: cents(6_000_000),
          ownershipByPlayerPpm: createSoleOwnership(owner),
        }),
  };
  const principal = cents(4_000_000),
    rate = basisPoints(800),
    payment = calculateAmortizingSchedule({
      principalCents: principal,
      annualRateBps: rate,
      termQuarters: 28,
    })[0]!.paymentCents;
  const loan: AssetBankLoan = {
    id: asLoanId("business-bank-fixture"),
    kind: "asset-bank-loan",
    borrowerAssetId: asset.id,
    leadPlayerId: options.starting
      ? (Object.keys(asset.ownershipByPlayerPpm)[0] as PlayerId)
      : owner,
    purpose: "business-acquisition",
    originalPrincipalCents: principal,
    outstandingPrincipalCents: principal,
    annualRateBps: rate,
    pricing: { kind: "fixed" },
    scheduledQuarterlyPaymentCents: payment,
    firstDueQuarter: 2,
    maturityQuarter: 29,
    termQuarters: 28,
    periodsProcessed: 0,
    interestPaidThroughQuarter: 1,
    paymentResetQuarter: 2,
    paymentBasisPrincipalCents: principal,
    principalRepaidCents: cents(0),
    pastDuePrincipalCents: cents(0),
    unpaidInterestCents: cents(0),
    lastProcessedQuarter: 0,
  };
  state = stageOpeningFixture({
    ...state,
    finance: {
      ...state.finance,
      assetsById: { ...state.finance.assetsById, [asset.id]: asset },
      loansById: { ...state.finance.loansById, [loan.id]: loan },
    },
  });
  assertGameState(state);
  return { state, asset, loan };
}
function settleUntil(initial: GameState, lastQuarter: number) {
  let state = initial;
  const journal: JournalEntry[] = [];
  while (state.lastSettledQuarter < lastQuarter) {
    const actor =
      state.round?.stage === "round-start"
        ? players[0]!
        : getActiveSpotlightPlayerId(state)!;
    const result = applyPlayerCommand(state, actor, {
      type:
        state.round?.stage === "round-start" ? "BEGIN_ROUND" : "PASS_SPOTLIGHT",
    });
    expect(result.ok, result.ok ? undefined : result.code).toBe(true);
    if (!result.ok) throw new Error(result.code);
    state = result.state;
    journal.push(...result.journalEntries);
  }
  return { state, journal };
}

describe("synthetic fixed business asset-bank loans through production quarter settlement", () => {
  it("deducts canonical bank principal and unpaid interest once from company equity", () => {
    const { asset, loan } = fixture();
    expect(
      calculateBusinessEquity(asset, {
        [loan.id]: {
          ...loan,
          unpaidInterestCents: cents(80_000),
          pastDuePrincipalCents: cents(100_000),
        },
      }),
    ).toEqual({
      enterpriseValueCents: 6_000_000,
      debtPrincipalCents: 4_000_000,
      equityValueCents: 2_107_959,
    });
  });
  it("first pays next quarter from company cash before retention and owner distributions", () => {
    const { state: opening, asset, loan } = fixture();
    const first = settleUntil(opening, 1);
    expect(first.state.finance.loansById[loan.id]).toEqual(loan);
    const { state, journal } = settleUntil(first.state, 2);
    const payment = state.finance.lastSettlement!.loanPayments.find(
      (row) => row.loanId === loan.id,
    )!;
    expect(payment).toMatchObject({
      borrowerPlayerId: null,
      borrowerAssetId: asset.id,
      lenderPlayerId: null,
      dueCents: 187_959,
      paidCents: 187_959,
      interestPaidCents: 80_000,
      principalPaidCents: 107_959,
    });
    expect(state.finance.loansById[loan.id]!.outstandingPrincipalCents).toBe(
      3_892_041,
    );
    const company = state.finance.lastSettlement!.businesses.find(
      (row) => row.assetId === asset.id,
    )!;
    expect(company.companyDebtPaidCents).toBe(187_959);
    expect(company.retainedFromSurplusCents).toBe(162_408);
    expect(company.distributionsByPlayer[owner]).toBe(649_633);
    expect(company.closingCashCents).toBe(350_367);
    const bankPosting = journal.find((row) => row.relatedLoanId === loan.id)!;
    expect(bankPosting.source).toEqual({ kind: "business", assetId: asset.id });
    expect(bankPosting.loanPayment).toEqual({
      interestCents: 80_000,
      principalCents: 107_959,
    });
    expect(journal.filter((row) => row.relatedLoanId === loan.id)).toHaveLength(
      1,
    );
    expect(
      calculateBusinessEquity(
        state.finance.assetsById[asset.id] as BusinessAsset,
        state.finance.loansById,
      ).equityValueCents,
    ).toBe(2_458_326);
  });
  it("records asset arrears without a personal guarantee and cures them from funded company cash", () => {
    const { state: opening, asset, loan } = fixture({ profit: 0, cash: 0 });
    let { state, journal } = settleUntil(opening, 2);
    const missed = state.finance.loansById[loan.id]!;
    expect(missed.outstandingPrincipalCents).toBe(4_000_000);
    expect(missed.unpaidInterestCents).toBe(80_000);
    expect(missed.pastDuePrincipalCents).toBe(107_959);
    expect(
      state.finance.lastSettlement!.businesses.find(
        (row) => row.assetId === asset.id,
      )!.distributionsByPlayer[owner],
    ).toBe(0);
    expect(journal.filter((row) => row.relatedLoanId === loan.id)).toEqual([]);
    expect(
      calculateBusinessEquity(
        state.finance.assetsById[asset.id] as BusinessAsset,
        state.finance.loansById,
      ).equityValueCents,
    ).toBe(1_920_000);
    const company = state.finance.assetsById[asset.id] as BusinessAsset;
    state = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: {
          ...state.finance.assetsById,
          [asset.id]: { ...company, cashCents: cents(400_000) },
        },
      },
    };
    // A contribution changes current cash without rewriting the prior settlement.
    expect(
      state.finance.lastSettlement!.businesses.find(
        (row) => row.assetId === asset.id,
      )!.closingCashCents,
    ).toBe(0);
    assertGameState(state);
    ({ state, journal } = settleUntil(state, 3));
    expect(state.finance.loansById[loan.id]).toMatchObject({
      outstandingPrincipalCents: 3_784_082,
      unpaidInterestCents: 0,
      pastDuePrincipalCents: 0,
      principalRepaidCents: 215_918,
    });
    expect(
      (state.finance.assetsById[asset.id] as BusinessAsset).cashCents,
    ).toBe(24_082);
    expect(journal.filter((row) => row.relatedLoanId === loan.id)).toHaveLength(
      1,
    );
    expect(
      journal.find((row) => row.relatedLoanId === loan.id)!.loanPayment,
    ).toEqual({ interestCents: 160_000, principalCents: 215_918 });
    expect(
      state.finance.lastSettlement!.businesses.find(
        (row) => row.assetId === asset.id,
      )!.distributionsByPlayer[owner],
    ).toBe(0);
  });
  it("preserves original maturity and ordinary interest through missed payments", () => {
    const { state: opening, loan } = fixture({ profit: 0, cash: 0 });
    let { state } = settleUntil(opening, 29);
    expect(state.finance.loansById[loan.id]).toMatchObject({
      outstandingPrincipalCents: 4_000_000,
      pastDuePrincipalCents: 4_000_000,
      unpaidInterestCents: 2_240_000,
      periodsProcessed: 28,
      maturityQuarter: 29,
      firstDueQuarter: 2,
    });
    ({ state } = settleUntil(state, 30));
    expect(state.finance.loansById[loan.id]).toMatchObject({
      outstandingPrincipalCents: 4_000_000,
      pastDuePrincipalCents: 4_000_000,
      unpaidInterestCents: 2_320_000,
      periodsProcessed: 29,
      maturityQuarter: 29,
    });
  });
  it("services legacy company and new bank debt at equal priority after owner work", () => {
    const {
      state: opening,
      asset,
      loan,
    } = fixture({ profit: 0, cash: 0, starting: true });
    let { state } = settleUntil(opening, 1);
    const current = state.finance.assetsById[asset.id] as BusinessAsset;
    state = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: {
          ...state.finance.assetsById,
          [asset.id]: { ...current, cashCents: cents(100_000) },
        },
      },
    };
    const result = settleUntil(state, 2);
    const bankPayments =
      result.state.finance.lastSettlement!.loanPayments.filter(
        (payment) => payment.borrowerAssetId === asset.id,
      );
    expect(bankPayments).toHaveLength(2);
    expect(
      bankPayments.reduce((sum, payment) => sum + payment.paidCents, 0),
    ).toBe(100_000);
    const totalDue = bankPayments.reduce(
      (sum, payment) => sum + payment.dueCents,
      0,
    );
    for (const payment of bankPayments) {
      expect(payment.paidCents).toBeGreaterThan(0);
      expect(
        Math.abs(payment.paidCents - (100_000 * payment.dueCents) / totalDue),
      ).toBeLessThanOrEqual(1);
    }
    const company = result.state.finance.lastSettlement!.businesses.find(
      (row) => row.assetId === asset.id,
    )!;
    expect(company.workCompensation!.currentPaidCents).toBe(
      company.workCompensation!.currentDueCents,
    );
    expect(company.distributionsByPlayer).toEqual(
      Object.fromEntries(
        Object.keys(asset.ownershipByPlayerPpm).map((id) => [id, 0]),
      ),
    );
    const legacy = Object.values(opening.finance.loansById).find(
      (record) =>
        record.kind === "company-loan" && record.borrowerAssetId === asset.id,
    )!;
    expect(result.state.finance.loansById[legacy.id]).toMatchObject({
      annualRateBps: legacy.annualRateBps,
      termQuarters: 28,
      firstDueQuarter: 1,
      periodsProcessed: 2,
    });
    expect(
      result.journal.filter((entry) => entry.relatedLoanId === legacy.id),
    ).toHaveLength(1);
    expect(
      result.journal.filter((entry) => entry.relatedLoanId === loan.id),
    ).toHaveLength(1);
  });
  it("pays the earned owners after a current ownership transfer, with next-quarter rights following the new owner", () => {
    const { state: opening, asset } = fixture();
    let { state } = settleUntil(opening, 1);
    const buyer = players[1]!;
    const current = state.finance.assetsById[asset.id] as BusinessAsset;
    const transferred = {
      ...current,
      ownershipByPlayerPpm: createSoleOwnership(buyer),
    };
    state = {
      ...state,
      finance: {
        ...state.finance,
        assetsById: { ...state.finance.assetsById, [asset.id]: transferred },
      },
      progress: recordBusinessPurchaseBasis(
        state.progress,
        owner,
        buyer,
        transferred,
        cents(6_000_000),
        2,
      ),
    };
    ({ state } = settleUntil(state, 2));
    expect(
      state.finance.lastSettlement!.businesses.find(
        (row) => row.assetId === asset.id,
      )!.distributionsByPlayer,
    ).toEqual({ [owner]: 649_633 });
    ({ state } = settleUntil(state, 3));
    const distributions = state.finance.lastSettlement!.businesses.find(
      (row) => row.assetId === asset.id,
    )!.distributionsByPlayer;
    expect(distributions[buyer]).toBeGreaterThan(0);
    expect(distributions[owner]).toBeUndefined();
  });
  it("rolls back planned bank servicing when the final spotlight cannot allocate its journals", () => {
    const { state: opening, loan } = fixture();
    let { state } = settleUntil(opening, 1);
    for (let step = 0; step < 4; step++) {
      const command =
        state.round!.stage === "round-start"
          ? { type: "BEGIN_ROUND" as const }
          : { type: "PASS_SPOTLIGHT" as const };
      const actor =
        state.round!.stage === "round-start"
          ? players[0]!
          : getActiveSpotlightPlayerId(state)!;
      const result = applyPlayerCommand(state, actor, command);
      if (!result.ok) throw new Error(result.code);
      state = result.state;
    }
    state = {
      ...state,
      counters: { ...state.counters, journal: Number.MAX_SAFE_INTEGER - 1 },
    };
    const result = applyPlayerCommand(
      state,
      getActiveSpotlightPlayerId(state)!,
      { type: "PASS_SPOTLIGHT" },
    );
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(result.journalEntries).toEqual([]);
    expect(state.finance.loansById[loan.id]!.lastProcessedQuarter).toBe(0);
  });
  it("rejects corrupted historical cash and aggregate debt payment outcomes", () => {
    const { state: opening, asset } = fixture();
    const { state } = settleUntil(opening, 2);
    for (const field of ["closingCashCents", "companyDebtPaidCents"] as const) {
      const corrupted = JSON.parse(JSON.stringify(state)) as GameState;
      const outcome = corrupted.finance.lastSettlement!.businesses.find(
        (row) => row.assetId === asset.id,
      )!;
      Object.assign(outcome, { [field]: outcome[field]! + 1 });
      expect(() => assertGameState(corrupted)).toThrow();
    }
  });
  it("finishes the 28-payment schedule with exact principal and final-cent cleanup", () => {
    const { state: opening, loan } = fixture();
    const { state, journal } = settleUntil(opening, 29);
    const payments = journal.filter((entry) => entry.relatedLoanId === loan.id);
    expect(payments).toHaveLength(28);
    expect(payments.at(-1)!.amountCents).toBe(187_950);
    expect(
      payments.reduce(
        (sum, entry) => sum + entry.loanPayment!.principalCents,
        0,
      ),
    ).toBe(4_000_000);
    expect(
      payments.reduce(
        (sum, entry) => sum + entry.loanPayment!.interestCents,
        0,
      ),
    ).toBe(1_262_843);
    expect(state.finance.loansById[loan.id]).toMatchObject({
      outstandingPrincipalCents: 0,
      principalRepaidCents: 4_000_000,
      pastDuePrincipalCents: 0,
      unpaidInterestCents: 0,
      periodsProcessed: 28,
      maturityQuarter: 29,
    });
    const after = settleUntil(state, 30);
    expect(after.journal.some((entry) => entry.relatedLoanId === loan.id)).toBe(
      false,
    );
  });
});
