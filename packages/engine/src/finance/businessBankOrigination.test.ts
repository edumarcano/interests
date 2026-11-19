import {
  asLoanId,
  asPlayerId,
  asTransactionId,
  type PlayerId,
} from "@interests/shared";
import { describe, expect, it } from "vitest";
import { stageOpeningFixture } from "../../test/openingFixture";
import { createQ1BusinessDiagnosticGame } from "../game/createGame";
import type { WirePlayerCommand } from "../game/playerCommand";
import { applyPlayerCommand } from "../game/playerCommand";
import { assertGameState } from "../invariants/assertGameState";
import type {
  AssetBankLoan,
  BusinessAsset,
  GameState,
} from "../model/gameState";
import {
  businessCashAccount,
  externalCashAccount,
  playerCashAccount,
} from "./account";
import { calculateAmortizingSchedule } from "./amortization";
import { quoteAssetBankLoan } from "./bank";
import { calculateBusinessEquity } from "./business";
import {
  type BusinessAcquisitionBankTerms,
  draftBusinessAcquisitionBankLoan,
  quoteBusinessAcquisitionBankLoan,
} from "./businessBankOrigination";
import { basisPoints, cents } from "./money";
import { calculateLoanObligation } from "./obligations";
import { postCash } from "./posting";

const players = ["A", "B", "C", "D"].map(asPlayerId);
function fixture() {
  let state = createQ1BusinessDiagnosticGame({
    gameId: "bank-draft",
    seed: "business-bank-servicing",
    playerIds: players,
  });
  for (const actor of players) {
    const chosen = applyPlayerCommand(state, actor, {
      type: "CHOOSE_OBJECTIVE",
      objectiveId: state.players[actor]!.offeredObjectiveIds[0],
    });
    if (!chosen.ok) throw new Error(chosen.code);
    state = chosen.state;
  }
  const original = Object.values(state.finance.assetsById).find(
    (asset): asset is BusinessAsset =>
      asset.kind === "business" && asset.cashPolicyId === "retained-profit-v1",
  )!;
  const seller = Object.keys(original.ownershipByPlayerPpm)[0] as PlayerId;
  const lead = players.find((player) => player !== seller)!;
  const asset: BusinessAsset = {
    ...original,
    cashCents: cents(0),
    enterpriseValueCents: cents(8_000_000),
    annualOperatingProfitCents: cents(4_000_000),
  };
  state = stageOpeningFixture({
    ...state,
    finance: {
      ...state.finance,
      assetsById: { ...state.finance.assetsById, [asset.id]: asset },
      cashByPlayer: {
        ...state.finance.cashByPlayer,
        [lead]: cents(100_000_000),
      },
    },
  });
  const terms: BusinessAcquisitionBankTerms = {
    transactionId: asTransactionId("confirmed-close"),
    borrowerAssetId: asset.id,
    leadPlayerId: lead,
    principalCents: 4_000_000,
    acquisitionConsiderationCents: 8_000_000,
    remainingCompanyClosingOutflowCents: 8_160_000,
  };
  const bank = quoteAssetBankLoan(state, lead, {
    purpose: "business-acquisition",
    qualifyingValueCents: 8_000_000,
    quarterlyOperatingIncomeCents: 1_000_000,
    principalCents: 4_000_000,
    rateKind: "fixed",
  });
  const contribution = cents(
    terms.remainingCompanyClosingOutflowCents +
      bank.scheduledQuarterlyPaymentCents -
      terms.principalCents,
  );
  const funded = postCash(state.finance, state.counters, {
    source: playerCashAccount(lead),
    destination: businessCashAccount(asset.id),
    amountCents: contribution,
    quarter: 1,
    reason: "confirmed-acquisition-contribution",
    relatedTransactionId: terms.transactionId,
    relatedAssetId: asset.id,
  });
  if (!funded.ok) throw new Error(funded.code);
  const fundedDraft: GameState = {
    ...state,
    finance: funded.finance,
    counters: funded.counters,
  };
  assertGameState(fundedDraft);
  return { state, fundedDraft, asset, lead, seller, terms, contribution };
}
function rejected(
  state: GameState,
  terms: BusinessAcquisitionBankTerms,
  code: string,
) {
  const before = JSON.stringify(state);
  const quoted = quoteBusinessAcquisitionBankLoan(state, terms);
  expect(quoted).toMatchObject({ ok: false, code });
  const result = draftBusinessAcquisitionBankLoan(state, terms);
  expect(result).toMatchObject({ ok: false, code, journalEntries: [] });
  expect(result.state).toBe(state);
  expect(JSON.stringify(state)).toBe(before);
}

describe("internal funded business-bank closing primitive", () => {
  it("shares the authoritative quote, posts bank funds once and creates only canonical asset debt", () => {
    const { fundedDraft, asset, terms, lead } = fixture();
    const before = JSON.stringify(fundedDraft);
    const quoted = quoteBusinessAcquisitionBankLoan(fundedDraft, terms);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) throw new Error(quoted.code);
    const result = draftBusinessAcquisitionBankLoan(fundedDraft, terms);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.quote).toEqual(quoted.quote);
    expect(result.loan).toMatchObject({
      kind: "asset-bank-loan",
      borrowerAssetId: asset.id,
      leadPlayerId: lead,
      purpose: "business-acquisition",
      originalPrincipalCents: 4_000_000,
      outstandingPrincipalCents: 4_000_000,
      pricing: { kind: "fixed" },
      annualRateBps: 775,
      termQuarters: 28,
      firstDueQuarter: 2,
      maturityQuarter: 29,
    });
    expect(result.loan).not.toHaveProperty("borrowerPlayerId");
    expect(result.loan.scheduledQuarterlyPaymentCents).toBe(
      calculateAmortizingSchedule({
        principalCents: 4_000_000,
        annualRateBps: 775,
        termQuarters: 28,
      })[0]!.paymentCents,
    );
    expect(calculateLoanObligation(result.loan, 1)).toBeNull();
    expect(result.state.finance.cashByPlayer).toEqual(
      fundedDraft.finance.cashByPlayer,
    );
    expect(
      (result.state.finance.assetsById[asset.id] as BusinessAsset).cashCents,
    ).toBe(
      (fundedDraft.finance.assetsById[asset.id] as BusinessAsset).cashCents +
        4_000_000,
    );
    expect(result.state.counters.loan).toBe(fundedDraft.counters.loan + 1);
    expect(result.state.counters.journal).toBe(
      fundedDraft.counters.journal + 1,
    );
    expect(result.state.revision).toBe(fundedDraft.revision);
    expect(result.state.random).toEqual(fundedDraft.random);
    expect(result.state.progress).toBe(fundedDraft.progress);
    expect(result.state.finance.quarterStartBasis).toBe(
      fundedDraft.finance.quarterStartBasis,
    );
    expect(result.journalEntries).toHaveLength(1);
    expect(result.journalEntries[0]).toMatchObject({
      source: { kind: "external", account: "bank" },
      destination: { kind: "business", assetId: asset.id },
      amountCents: 4_000_000,
      relatedAssetId: asset.id,
      relatedLoanId: result.loan.id,
      relatedTransactionId: terms.transactionId,
    });
    expect(
      calculateBusinessEquity(
        result.state.finance.assetsById[asset.id] as BusinessAsset,
        result.state.finance.loansById,
      ).equityValueCents,
    ).toBe(
      calculateBusinessEquity(
        fundedDraft.finance.assetsById[asset.id] as BusinessAsset,
        fundedDraft.finance.loansById,
      ).equityValueCents,
    );
    expect(JSON.stringify(fundedDraft)).toBe(before);
    assertGameState(result.state);
  });
  it("keeps bank funding, secondary seller cash, purchase fees and retained reserve distinct", () => {
    const { state, fundedDraft, asset, terms, contribution, lead, seller } =
      fixture();
    const loan = draftBusinessAcquisitionBankLoan(fundedDraft, terms);
    if (!loan.ok) throw new Error(loan.code);
    const sellerPayment = postCash(loan.state.finance, loan.state.counters, {
      source: businessCashAccount(asset.id),
      destination: playerCashAccount(seller),
      amountCents: 8_000_000,
      quarter: 1,
      reason: "secondary-consideration",
      relatedTransactionId: terms.transactionId,
    });
    if (!sellerPayment.ok) throw new Error(sellerPayment.code);
    const fee = postCash(sellerPayment.finance, sellerPayment.counters, {
      source: businessCashAccount(asset.id),
      destination: externalCashAccount("market"),
      amountCents: 160_000,
      quarter: 1,
      reason: "business-purchase-fee",
      relatedTransactionId: terms.transactionId,
    });
    if (!fee.ok) throw new Error(fee.code);
    expect(fee.finance.cashByPlayer[lead]).toBe(
      state.finance.cashByPlayer[lead]! - contribution,
    );
    expect(fee.finance.cashByPlayer[seller]).toBe(
      state.finance.cashByPlayer[seller]! + 8_000_000,
    );
    expect((fee.finance.assetsById[asset.id] as BusinessAsset).cashCents).toBe(
      loan.quote.assetReserveCents,
    );
    expect(fee.finance.loansById[loan.loan.id]!.outstandingPrincipalCents).toBe(
      4_000_000,
    );
    expect([
      loan.journalEntries[0].amountCents,
      sellerPayment.entry.amountCents,
      fee.entry.amountCents,
    ]).toEqual([4_000_000, 8_000_000, 160_000]);
    expect(fee.finance.assetsById[asset.id]!.ownershipByPlayerPpm).toEqual(
      asset.ownershipByPlayerPpm,
    );
  });
  it("rejects unfunded, overfunded, repeated, personal-reserve and overdue drafts atomically", () => {
    const f = fixture();
    rejected(f.state, f.terms, "ASSET_RESERVE_SHORTFALL");
    const cash = (f.fundedDraft.finance.assetsById[f.asset.id] as BusinessAsset)
      .cashCents;
    for (const [change, code] of [
      [-1, "ASSET_RESERVE_SHORTFALL"],
      [1, "EXCESS_BANK_FUNDING"],
    ] as const)
      rejected(
        {
          ...f.fundedDraft,
          finance: {
            ...f.fundedDraft.finance,
            assetsById: {
              ...f.fundedDraft.finance.assetsById,
              [f.asset.id]: { ...f.asset, cashCents: cents(cash + change) },
            },
          },
        },
        f.terms,
        code,
      );
    const first = draftBusinessAcquisitionBankLoan(f.fundedDraft, f.terms);
    if (!first.ok) throw new Error(first.code);
    rejected(first.state, f.terms, "EXCESS_BANK_FUNDING");
    const poor = {
      ...f.fundedDraft,
      finance: {
        ...f.fundedDraft.finance,
        cashByPlayer: {
          ...f.fundedDraft.finance.cashByPlayer,
          [f.lead]: cents(0),
        },
      },
    };
    rejected(poor, f.terms, "PERSONAL_RESERVE_SHORTFALL");
    rejected(
      {
        ...f.fundedDraft,
        finance: {
          ...f.fundedDraft.finance,
          assetsById: {
            ...f.fundedDraft.finance.assetsById,
            [f.asset.id]: {
              ...f.asset,
              cashCents: cash,
              operatingArrearsCents: cents(1),
            },
          },
        },
      },
      f.terms,
      "BORROWER_OVERDUE",
    );
    rejected(
      {
        ...f.fundedDraft,
        finance: {
          ...f.fundedDraft.finance,
          livingArrearsByPlayer: {
            ...f.fundedDraft.finance.livingArrearsByPlayer,
            [f.lead]: cents(1),
          },
        },
      },
      f.terms,
      "BORROWER_OVERDUE",
    );
  });
  it("deducts required existing company service before applying positive DSCR", () => {
    const f = fixture();
    const payment = calculateAmortizingSchedule({
      principalCents: 2_000_000,
      annualRateBps: 800,
      termQuarters: 28,
    })[0]!.paymentCents;
    const existing: AssetBankLoan = {
      id: asLoanId("existing-bank"),
      kind: "asset-bank-loan",
      borrowerAssetId: f.asset.id,
      leadPlayerId: f.seller,
      purpose: "business-acquisition",
      originalPrincipalCents: cents(2_000_000),
      outstandingPrincipalCents: cents(2_000_000),
      annualRateBps: basisPoints(800),
      pricing: { kind: "fixed" },
      scheduledQuarterlyPaymentCents: payment,
      firstDueQuarter: 2,
      maturityQuarter: 29,
      termQuarters: 28,
      periodsProcessed: 0,
      interestPaidThroughQuarter: 1,
      paymentResetQuarter: 2,
      paymentBasisPrincipalCents: cents(2_000_000),
      principalRepaidCents: cents(0),
      pastDuePrincipalCents: cents(0),
      unpaidInterestCents: cents(0),
      lastProcessedQuarter: 0,
    };
    const withDebt = {
      ...f.fundedDraft,
      finance: {
        ...f.fundedDraft.finance,
        loansById: {
          ...f.fundedDraft.finance.loansById,
          [existing.id]: existing,
        },
      },
    };
    const quote = quoteBusinessAcquisitionBankLoan(withDebt, f.terms);
    expect(quote.ok).toBe(true);
    if (!quote.ok) throw new Error(quote.code);
    expect(quote.quote.existingQuarterlyDebtServiceCents).toBe(payment);
    expect(quote.quote.qualifyingQuarterlyOperatingCashCents).toBe(
      1_000_000 - payment,
    );
    const narrowProfit = cents(
      4 * (payment + quote.quote.scheduledQuarterlyPaymentCents - 1),
    );
    const narrow = {
      ...withDebt,
      finance: {
        ...withDebt.finance,
        assetsById: {
          ...withDebt.finance.assetsById,
          [f.asset.id]: {
            ...f.asset,
            cashCents: (
              withDebt.finance.assetsById[f.asset.id] as BusinessAsset
            ).cashCents,
            annualOperatingProfitCents: narrowProfit,
          },
        },
      },
    };
    expect(
      quoteAssetBankLoan(narrow, f.lead, {
        purpose: "business-acquisition",
        qualifyingValueCents: 8_000_000,
        quarterlyOperatingIncomeCents: narrowProfit / 4,
        principalCents: 4_000_000,
        rateKind: "fixed",
      }).approved,
    ).toBe(true);
    rejected(narrow, f.terms, "BANK_UNDERWRITING_FAILED");
    rejected(
      {
        ...withDebt,
        finance: {
          ...withDebt.finance,
          loansById: {
            ...withDebt.finance.loansById,
            [existing.id]: { ...existing, unpaidInterestCents: cents(1) },
          },
        },
      },
      f.terms,
      "BORROWER_OVERDUE",
    );
  });
  it("rejects malformed terms, exhausted IDs, overflow and public free-credit commands", () => {
    const f = fixture();
    for (const principalCents of [0, -1, 0.5, NaN, Infinity])
      rejected(f.fundedDraft, { ...f.terms, principalCents }, "INVALID_TERMS");
    rejected(
      f.fundedDraft,
      { ...f.terms, remainingCompanyClosingOutflowCents: 7_999_999 },
      "INVALID_TERMS",
    );
    for (const kind of ["loan", "journal"] as const)
      rejected(
        {
          ...f.fundedDraft,
          counters: {
            ...f.fundedDraft.counters,
            [kind]: Number.MAX_SAFE_INTEGER,
          },
        },
        f.terms,
        "COUNTER_EXHAUSTED",
      );
    rejected(
      {
        ...f.fundedDraft,
        finance: {
          ...f.fundedDraft.finance,
          assetsById: {
            ...f.fundedDraft.finance.assetsById,
            [f.asset.id]: {
              ...f.asset,
              cashCents: cents(Number.MAX_SAFE_INTEGER),
            },
          },
        },
      },
      f.terms,
      "DESTINATION_OVERFLOW",
    );
    const command = applyPlayerCommand(f.fundedDraft, f.lead, {
      type: "ORIGINATE_BUSINESS_BANK_LOAN",
    } as unknown as WirePlayerCommand);
    expect(command.ok).toBe(false);
    expect(command.state).toBe(f.fundedDraft);
  });
  it("uses after-labor profit without subtracting required owner work a second time", () => {
    const f = fixture();
    const original = Object.values(f.state.finance.assetsById).find(
      (asset): asset is BusinessAsset =>
        asset.kind === "business" &&
        asset.cashPolicyId === "starting-company-v1",
    )!;
    if (!original.workCompensation) throw new Error("Missing work fixture");
    const lead = players.find(
      (player) => player !== original.workCompensation!.playerId,
    )!;
    const asset = {
      ...original,
      cashCents: cents(0),
      annualOperatingProfitCents: cents(4_000_000),
      workCompensation: {
        ...original.workCompensation,
        annualCompensationCents: cents(8_000_000),
      },
    };
    let state = stageOpeningFixture({
      ...f.state,
      finance: {
        ...f.state.finance,
        assetsById: { ...f.state.finance.assetsById, [asset.id]: asset },
        cashByPlayer: {
          ...f.state.finance.cashByPlayer,
          [lead]: cents(100_000_000),
        },
      },
    });
    const terms = { ...f.terms, leadPlayerId: lead, borrowerAssetId: asset.id };
    const bank = quoteAssetBankLoan(state, lead, {
      purpose: "business-acquisition",
      qualifyingValueCents: 8_000_000,
      quarterlyOperatingIncomeCents: 1_000_000,
      principalCents: 4_000_000,
      rateKind: "fixed",
    });
    const contribution =
      terms.remainingCompanyClosingOutflowCents +
      bank.scheduledQuarterlyPaymentCents -
      terms.principalCents;
    const funded = postCash(state.finance, state.counters, {
      source: playerCashAccount(lead),
      destination: businessCashAccount(asset.id),
      amountCents: contribution,
      quarter: 1,
      reason: "confirmed-acquisition-contribution",
    });
    if (!funded.ok) throw new Error(funded.code);
    state = { ...state, finance: funded.finance, counters: funded.counters };
    assertGameState(state);
    const quote = quoteBusinessAcquisitionBankLoan(state, terms);
    expect(quote.ok).toBe(true);
    if (!quote.ok) throw new Error(quote.code);
    const existing = Object.values(state.finance.loansById).find(
      (record) =>
        record.kind === "company-loan" && record.borrowerAssetId === asset.id,
    )!;
    expect(quote.quote.qualifyingQuarterlyOperatingCashCents).toBe(
      1_000_000 - calculateLoanObligation(existing, 1)!.amountDueCents,
    );
    expect(draftBusinessAcquisitionBankLoan(state, terms).ok).toBe(true);
  });
});
