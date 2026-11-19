import {
  BANK_LENDING_RULES,
  OPERATING_RULES,
  PROPERTY_CATALOGUE,
  TRANSACTION_FEES_BPS,
} from "@interests/rules";
import type {
  AssetId,
  PlayerId,
  PropertyCommand,
  PropertyManagementView,
  PropertyOfferView,
} from "@interests/shared";
import type { ActionResult } from "../game/actions";
import { nextDeterministicId } from "../game/deterministicIds";
import { advanceSpotlight, getActiveSpotlightPlayerId } from "../game/round";
import type {
  AssetBankLoan,
  GameState,
  PropertyAsset,
} from "../model/gameState";
import { getAvailableCashCents } from "../transactions/reservations";
import {
  externalCashAccount,
  playerCashAccount,
  propertyCashAccount,
} from "./account";
import { calculateAmortizingSchedule } from "./amortization";
import {
  assetBankLiens,
  bankPayoff,
  propertyLoanQuote,
  roundedRatio,
} from "./bank";
import type { JournalEntry } from "./journal";
import { basisPoints, cents } from "./money";
import { allocateProportionalCents, ownershipPpm } from "./ownership";
import { type CashPostingRequest, postCash } from "./posting";

export function catalogueProperty(
  id: string,
  playerId: PlayerId,
): PropertyAsset | null {
  const listing = PROPERTY_CATALOGUE.find((item) => item.id === id);
  return listing
    ? {
        id: "quote" as AssetId,
        kind: "property",
        marketKind: listing.marketKind,
        marketValueCents: cents(listing.marketValueCents),
        scheduledQuarterlyRentCents: cents(listing.scheduledQuarterlyRentCents),
        occupancyBps: basisPoints(listing.occupancyBps),
        operatingExpenseRatioBps: basisPoints(listing.operatingExpenseRatioBps),
        ownershipByPlayerPpm: { [playerId]: ownershipPpm(1_000_000) },
      }
    : null;
}
export function purchaseQuote(
  state: GameState,
  playerId: PlayerId,
  property: PropertyAsset,
  principalCents: number,
  rateKind: "fixed" | "variable",
) {
  const bank = propertyLoanQuote(
    state,
    playerId,
    property,
    principalCents,
    rateKind,
  );
  const feeCents = roundedRatio(
    property.marketValueCents,
    TRANSACTION_FEES_BPS.property.purchase,
  );
  const reserveCents = bank.scheduledQuarterlyPaymentCents;
  const cashRequiredCents = cents(
    property.marketValueCents - principalCents + feeCents + reserveCents,
  );
  return {
    principalCents,
    rateKind,
    termQuarters: bank.termQuarters,
    creditGrade: bank.grade,
    creditEnvironment: bank.creditEnvironment,
    maximumLtvBps: bank.maxShareBps,
    minimumDscrBps: bank.minimumDscrBps,
    annualRateBps: bank.annualRateBps,
    quarterlyPaymentCents: bank.scheduledQuarterlyPaymentCents,
    feeCents,
    assetReserveCents: reserveCents,
    personalReserveCents: bank.personalQuarterlyObligationsCents,
    cashRequiredCents,
    canClose:
      (!principalCents || bank.approved) &&
      getAvailableCashCents(state, playerId) - cashRequiredCents >=
        bank.personalQuarterlyObligationsCents,
  };
}
export function propertyOffers(
  state: GameState,
  playerId: PlayerId,
): PropertyOfferView[] {
  return PROPERTY_CATALOGUE.filter(
    (listing) =>
      !Object.values(state.finance.assetsById).some(
        (asset) =>
          asset.kind === "property" && asset.catalogueId === listing.id,
      ),
  ).map((listing) => {
    const property = catalogueProperty(listing.id, playerId)!;
    const quotes = (["fixed", "variable"] as const).map((rateKind) => {
      let low = 0,
        high = Math.min(
          property.marketValueCents,
          roundedRatio(
            property.marketValueCents,
            propertyLoanQuote(state, playerId, property, 0, rateKind)
              .maxShareBps,
          ),
        );
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (
          propertyLoanQuote(state, playerId, property, mid, rateKind).dscrPass
        )
          low = mid;
        else high = mid - 1;
      }
      return purchaseQuote(state, playerId, property, low, rateKind);
    });
    return {
      catalogueId: listing.id,
      name: listing.name,
      askingPriceCents: listing.marketValueCents,
      scheduledQuarterlyRentCents: listing.scheduledQuarterlyRentCents,
      occupancyBps: listing.occupancyBps,
      operatingExpenseRatioBps: listing.operatingExpenseRatioBps,
      quotes: [purchaseQuote(state, playerId, property, 0, "fixed"), ...quotes],
    };
  });
}
function renovationCost(asset: PropertyAsset) {
  return cents(
    Math.max(
      OPERATING_RULES.renovationMinimumCents,
      roundedRatio(asset.marketValueCents, OPERATING_RULES.renovationCostBps),
    ),
  );
}
function refinancingQuote(
  state: GameState,
  playerId: PlayerId,
  asset: PropertyAsset,
  rateKind: "fixed" | "variable",
  authority: PropertyOwnerAuthority = "sole-owner",
) {
  const liens = assetBankLiens(state, asset.id);
  const principalCents = cents(
    liens.reduce((sum, loan) => sum + bankPayoff(state, loan).totalCents, 0),
  );
  const quote = propertyLoanQuote(
    state,
    playerId,
    asset,
    principalCents,
    rateKind,
  );
  const feeCents = roundedRatio(
    principalCents,
    BANK_LENDING_RULES.refinancingFeeBps,
  );
  const reserveCents = Math.max(
    0,
    quote.scheduledQuarterlyPaymentCents - (asset.cashCents ?? 0),
  );
  return {
    principalCents,
    rateKind,
    termQuarters: quote.termQuarters,
    creditGrade: quote.grade,
    creditEnvironment: quote.creditEnvironment,
    maximumLtvBps: quote.maxShareBps,
    minimumDscrBps: quote.minimumDscrBps,
    annualRateBps: quote.annualRateBps,
    quarterlyPaymentCents: quote.scheduledQuarterlyPaymentCents,
    feeCents,
    assetReserveCents: quote.scheduledQuarterlyPaymentCents,
    personalReserveCents: quote.personalQuarterlyObligationsCents,
    cashRequiredCents: cents(feeCents + reserveCents),
    canClose:
      liens.length > 0 &&
      liens.every(
        (loan) => !loan.pastDuePrincipalCents && !loan.unpaidInterestCents,
      ) &&
      (authority === "unanimous-owners" ||
        Object.keys(asset.ownershipByPlayerPpm).length === 1) &&
      quote.approved &&
      getAvailableCashCents(state, playerId) - feeCents - reserveCents >=
        quote.personalQuarterlyObligationsCents,
  };
}
export function propertyManagement(
  state: GameState,
  playerId: PlayerId,
  authority: PropertyOwnerAuthority = "sole-owner",
): PropertyManagementView[] {
  return Object.values(state.finance.assetsById)
    .filter(
      (asset): asset is PropertyAsset =>
        asset.kind === "property" &&
        (asset.ownershipByPlayerPpm[playerId] ?? 0) > 0,
    )
    .map((asset) => {
      const payoffCents = cents(
        assetBankLiens(state, asset.id).reduce(
          (sum, loan) => sum + bankPayoff(state, loan).totalCents,
          0,
        ),
      );
      const feeCents = roundedRatio(
        asset.marketValueCents,
        TRANSACTION_FEES_BPS.property.sale,
      );
      const netSaleProceedsCents = cents(
        asset.marketValueCents -
          feeCents -
          payoffCents +
          (asset.cashCents ?? 0),
      );
      const cost = renovationCost(asset);
      return {
        assetId: asset.id,
        cashCents: asset.cashCents ?? 0,
        reserveTargetCents: asset.debtServiceReserveCents ?? 0,
        payoffCents,
        saleFeeCents: feeCents,
        netSaleProceedsCents,
        canSell:
          (authority === "unanimous-owners" ||
            Object.keys(asset.ownershipByPlayerPpm).length === 1) &&
          netSaleProceedsCents >= 0,
        renovationCostCents: cost,
        canRenovate:
          asset.renovatedQuarter === undefined &&
          (authority === "unanimous-owners" ||
            Object.keys(asset.ownershipByPlayerPpm).length === 1) &&
          getAvailableCashCents(state, playerId) >= cost,
        renovated: asset.renovatedQuarter !== undefined,
        refinancingQuotes: (["fixed", "variable"] as const).map((kind) =>
          refinancingQuote(state, playerId, asset, kind, authority),
        ),
      };
    });
}

export type PropertyOwnerAuthority = "sole-owner" | "unanimous-owners";

/** Internal finance draft. The transaction controller proves unanimous consent before using joint authority. */
export function draftPropertyOwnerAction(
  state: GameState,
  playerId: PlayerId,
  command: PropertyCommand,
  authority: PropertyOwnerAuthority = "sole-owner",
  purchaseFunding?: {
    readonly cashByPlayer: Readonly<Partial<Record<PlayerId, number>>>;
    readonly ownershipByPlayerPpm: PropertyAsset["ownershipByPlayerPpm"];
  },
): ActionResult {
  const reject = (
    code:
      | "INVALID_ACTION"
      | "WRONG_PHASE"
      | "WRONG_ROUND_STAGE"
      | "ACTIVE_TRANSACTION"
      | "NOT_ACTIVE_SPOTLIGHT"
      | "INSUFFICIENT_FUNDS"
      | "PROPERTY_UNAVAILABLE"
      | "BANK_UNDERWRITING_FAILED"
      | "OWNER_CONSENT_REQUIRED"
      | "ALREADY_RENOVATED"
      | "DESTINATION_OVERFLOW",
  ): ActionResult => ({ ok: false, state, code, journalEntries: [] });
  if (state.phase !== "ready-for-first-round") return reject("WRONG_PHASE");
  if (state.round?.stage !== "spotlight") return reject("WRONG_ROUND_STAGE");
  if (getActiveSpotlightPlayerId(state) !== playerId)
    return reject("NOT_ACTIVE_SPOTLIGHT");
  if (state.activeTransaction) return reject("ACTIVE_TRANSACTION");
  let draft = state;
  const journals: JournalEntry[] = [];
  try {
    const posting = (input: Omit<CashPostingRequest, "quarter">) => {
      if (!input.amountCents) return;
      const result = postCash(draft.finance, draft.counters, {
        ...input,
        quarter: state.currentQuarter,
      });
      if (!result.ok) throw new RangeError(result.code);
      draft = { ...draft, finance: result.finance, counters: result.counters };
      journals.push(result.entry);
    };
    const originate = (
      asset: PropertyAsset,
      principal: number,
      rateKind: "fixed" | "variable",
      interestPaidThroughQuarter: number,
    ) => {
      if (!principal) return;
      const quote = propertyLoanQuote(
        state,
        playerId,
        asset,
        principal,
        rateKind,
      );
      calculateAmortizingSchedule({
        principalCents: principal,
        annualRateBps: quote.annualRateBps,
        termQuarters: quote.termQuarters,
      });
      const { id, counters } = nextDeterministicId("loan", draft.counters);
      const loan: AssetBankLoan = {
        id,
        kind: "asset-bank-loan",
        borrowerAssetId: asset.id,
        leadPlayerId: playerId,
        purpose: "property-mortgage",
        originalPrincipalCents: cents(principal),
        outstandingPrincipalCents: cents(principal),
        annualRateBps: basisPoints(quote.annualRateBps),
        pricing:
          rateKind === "fixed"
            ? { kind: "fixed" }
            : { kind: "variable", spreadBps: quote.spreadBps },
        scheduledQuarterlyPaymentCents: cents(
          quote.scheduledQuarterlyPaymentCents,
        ),
        firstDueQuarter: quote.firstDueQuarter,
        maturityQuarter: quote.firstDueQuarter + quote.termQuarters - 1,
        termQuarters: quote.termQuarters,
        periodsProcessed: 0,
        principalRepaidCents: cents(0),
        pastDuePrincipalCents: cents(0),
        unpaidInterestCents: cents(0),
        lastProcessedQuarter: 0,
        interestPaidThroughQuarter,
        paymentResetQuarter: quote.firstDueQuarter,
        paymentBasisPrincipalCents: cents(principal),
      };
      draft = {
        ...draft,
        counters,
        finance: {
          ...draft.finance,
          loansById: { ...draft.finance.loansById, [id]: loan },
        },
      };
      posting({
        source: externalCashAccount("bank"),
        destination: propertyCashAccount(asset.id),
        amountCents: principal,
        reason: "asset-bank-loan-origination",
        relatedAssetId: asset.id,
        relatedLoanId: id,
      });
    };
    const payoff = (asset: PropertyAsset) => {
      let interest = 0;
      for (const loan of assetBankLiens(state, asset.id)) {
        const claim = bankPayoff(state, loan);
        interest = cents(interest + claim.interestCents);
        posting({
          source: propertyCashAccount(asset.id),
          destination: externalCashAccount("bank"),
          amountCents: claim.totalCents,
          reason: "asset-bank-loan-payoff",
          relatedAssetId: asset.id,
          relatedLoanId: loan.id,
          loanPayment: {
            principalCents: claim.principalCents,
            interestCents: claim.interestCents,
          },
        });
        draft = {
          ...draft,
          finance: {
            ...draft.finance,
            loansById: {
              ...draft.finance.loansById,
              [loan.id]: {
                ...loan,
                outstandingPrincipalCents: cents(0),
                principalRepaidCents: loan.originalPrincipalCents,
                pastDuePrincipalCents: cents(0),
                unpaidInterestCents: cents(0),
                lastProcessedQuarter: state.currentQuarter,
              },
            },
          },
        };
      }
      const old =
        state.finance.prepaidAssetInterest?.quarter === state.currentQuarter
          ? state.finance.prepaidAssetInterest.byAssetId
          : {};
      const prior = old[asset.id];
      draft = {
        ...draft,
        finance: {
          ...draft.finance,
          prepaidAssetInterest: {
            quarter: state.currentQuarter,
            byAssetId: {
              ...old,
              [asset.id]: {
                interestCents: cents((prior?.interestCents ?? 0) + interest),
                ownershipByPlayerPpm: { ...asset.ownershipByPlayerPpm },
              },
            },
          },
        },
      };
    };
    if (command.type === "BUY_PROPERTY") {
      if (
        typeof command.catalogueId !== "string" ||
        !Number.isSafeInteger(command.principalCents) ||
        command.principalCents < 0 ||
        !["fixed", "variable"].includes(command.rateKind)
      )
        return reject("INVALID_ACTION");
      const template = catalogueProperty(command.catalogueId, playerId);
      if (
        !template ||
        Object.values(state.finance.assetsById).some(
          (asset) =>
            asset.kind === "property" &&
            asset.catalogueId === command.catalogueId,
        )
      )
        return reject("PROPERTY_UNAVAILABLE");
      const quote = purchaseQuote(
        state,
        playerId,
        template,
        command.principalCents,
        command.rateKind,
      );
      if (
        !propertyLoanQuote(
          state,
          playerId,
          template,
          command.principalCents,
          command.rateKind,
        ).approved &&
        command.principalCents > 0
      )
        return reject("BANK_UNDERWRITING_FAILED");
      const contributions = purchaseFunding?.cashByPlayer ?? {
        [playerId]: quote.cashRequiredCents,
      };
      const ownership =
        purchaseFunding?.ownershipByPlayerPpm ?? template.ownershipByPlayerPpm;
      if (
        !Object.hasOwn(ownership, playerId) ||
        Object.keys(ownership).length !== Object.keys(contributions).length ||
        Object.entries(ownership).some(
          ([owner, units]) =>
            !state.players[owner as PlayerId] ||
            !Number.isSafeInteger(units) ||
            units <= 0 ||
            !Object.hasOwn(contributions, owner),
        ) ||
        Object.values(ownership).reduce((sum, units) => sum + units, 0) !==
          1_000_000 ||
        Object.entries(contributions).some(
          ([owner, amount]) =>
            !Number.isSafeInteger(amount) ||
            amount! <= 0 ||
            getAvailableCashCents(state, owner as PlayerId) < amount!,
        ) ||
        Object.values(contributions).reduce<number>(
          (sum, amount) => cents(sum + amount!),
          0,
        ) !== quote.cashRequiredCents ||
        getAvailableCashCents(state, playerId) - contributions[playerId]! <
          quote.personalReserveCents
      )
        return reject("INSUFFICIENT_FUNDS");
      const { id, counters } = nextDeterministicId("asset", state.counters);
      const asset: PropertyAsset = {
        ...template,
        ownershipByPlayerPpm: ownership,
        id,
        catalogueId: command.catalogueId,
        cashCents: cents(0),
        debtServiceReserveCents: cents(quote.assetReserveCents),
      };
      draft = {
        ...state,
        counters,
        finance: {
          ...state.finance,
          assetsById: { ...state.finance.assetsById, [id]: asset },
        },
      };
      for (const owner of state.playerOrder) {
        const amount = contributions[owner];
        if (amount)
          posting({
            source: playerCashAccount(owner),
            destination: propertyCashAccount(id),
            amountCents: cents(amount),
            reason: "property-equity-funding",
            relatedAssetId: id,
          });
      }
      originate(
        asset,
        command.principalCents,
        command.rateKind,
        state.currentQuarter,
      );
      posting({
        source: propertyCashAccount(id),
        destination: externalCashAccount("market"),
        amountCents: asset.marketValueCents,
        reason: "property-purchase",
        relatedAssetId: id,
      });
      posting({
        source: propertyCashAccount(id),
        destination: externalCashAccount("market"),
        amountCents: quote.feeCents,
        reason: "property-purchase-fee",
        relatedAssetId: id,
      });
      const principalShares = allocateProportionalCents(
        cents(command.principalCents),
        ownership,
      );
      const byPlayer = { ...state.progress.byPlayer };
      for (const owner of state.playerOrder) {
        if (!ownership[owner]) continue;
        const progress = byPlayer[owner]!;
        byPlayer[owner] = {
          ...progress,
          assetsById: {
            ...progress.assetsById,
            [id]: {
              costCents: cents(contributions[owner]! + principalShares[owner]!),
              acquiredQuarter: state.currentQuarter,
              ownershipPpm: ownership[owner]!,
            },
          },
        };
      }
      draft = { ...draft, progress: { byPlayer } };
    } else {
      if (typeof command.assetId !== "string") return reject("INVALID_ACTION");
      const asset = state.finance.assetsById[command.assetId as AssetId];
      if (
        asset?.kind !== "property" ||
        !(asset.ownershipByPlayerPpm[playerId] ?? 0)
      )
        return reject("PROPERTY_UNAVAILABLE");
      if (command.type === "FUND_PROPERTY_RESERVE") {
        if (
          !Number.isSafeInteger(command.amountCents) ||
          command.amountCents <= 0
        )
          return reject("INVALID_ACTION");
        if (getAvailableCashCents(state, playerId) < command.amountCents)
          return reject("INSUFFICIENT_FUNDS");
        posting({
          source: playerCashAccount(playerId),
          destination: propertyCashAccount(asset.id),
          amountCents: command.amountCents,
          reason: "property-reserve-funding",
          relatedAssetId: asset.id,
        });
        const progress = draft.progress.byPlayer[playerId]!;
        draft = {
          ...draft,
          progress: {
            byPlayer: {
              ...draft.progress.byPlayer,
              [playerId]: {
                ...progress,
                assetsById: {
                  ...progress.assetsById,
                  [asset.id]: {
                    ...progress.assetsById[asset.id]!,
                    costCents: cents(
                      progress.assetsById[asset.id]!.costCents +
                        command.amountCents,
                    ),
                  },
                },
              },
            },
          },
        };
      } else if (command.type === "RENOVATE_PROPERTY") {
        if (asset.renovatedQuarter !== undefined)
          return reject("ALREADY_RENOVATED");
        if (
          authority === "sole-owner" &&
          Object.keys(asset.ownershipByPlayerPpm).length !== 1
        )
          return reject("OWNER_CONSENT_REQUIRED");
        const cost = renovationCost(asset);
        if (getAvailableCashCents(state, playerId) < cost)
          return reject("INSUFFICIENT_FUNDS");
        posting({
          source: playerCashAccount(playerId),
          destination: externalCashAccount("market"),
          amountCents: cost,
          reason: "property-renovation",
          relatedAssetId: asset.id,
        });
        draft = {
          ...draft,
          finance: {
            ...draft.finance,
            assetsById: {
              ...draft.finance.assetsById,
              [asset.id]: {
                ...asset,
                renovatedQuarter: state.currentQuarter,
                renovationPending: {
                  costCents: cost,
                  effectiveQuarter: state.currentQuarter + 1,
                },
              },
            },
          },
        };
        const progress = draft.progress.byPlayer[playerId]!;
        draft = {
          ...draft,
          progress: {
            byPlayer: {
              ...draft.progress.byPlayer,
              [playerId]: {
                ...progress,
                assetsById: {
                  ...progress.assetsById,
                  [asset.id]: {
                    ...progress.assetsById[asset.id]!,
                    costCents: cents(
                      progress.assetsById[asset.id]!.costCents + cost,
                    ),
                  },
                },
              },
            },
          },
        };
      } else {
        if (
          authority === "sole-owner" &&
          Object.keys(asset.ownershipByPlayerPpm).length !== 1
        )
          return reject("OWNER_CONSENT_REQUIRED");
        if (command.type === "REFINANCE_PROPERTY") {
          if (!["fixed", "variable"].includes(command.rateKind))
            return reject("INVALID_ACTION");
          const quote = refinancingQuote(
            state,
            playerId,
            asset,
            command.rateKind,
            authority,
          );
          if (!quote.canClose) return reject("BANK_UNDERWRITING_FAILED");
          posting({
            source: playerCashAccount(playerId),
            destination: propertyCashAccount(asset.id),
            amountCents: quote.cashRequiredCents,
            reason: "property-refinancing-funding",
            relatedAssetId: asset.id,
          });
          originate(
            asset,
            quote.principalCents,
            command.rateKind,
            state.currentQuarter,
          );
          payoff(asset);
          posting({
            source: propertyCashAccount(asset.id),
            destination: externalCashAccount("bank"),
            amountCents: quote.feeCents,
            reason: "property-refinancing-fee",
            relatedAssetId: asset.id,
          });
          const current = draft.finance.assetsById[asset.id] as PropertyAsset;
          draft = {
            ...draft,
            finance: {
              ...draft.finance,
              assetsById: {
                ...draft.finance.assetsById,
                [asset.id]: {
                  ...current,
                  debtServiceReserveCents: cents(quote.assetReserveCents),
                },
              },
            },
          };
          const progress = draft.progress.byPlayer[playerId]!;
          draft = {
            ...draft,
            progress: {
              byPlayer: {
                ...draft.progress.byPlayer,
                [playerId]: {
                  ...progress,
                  realizedGainsCents: cents(
                    progress.realizedGainsCents - quote.feeCents,
                  ),
                  assetsById: {
                    ...progress.assetsById,
                    [asset.id]: {
                      ...progress.assetsById[asset.id]!,
                      costCents: cents(
                        progress.assetsById[asset.id]!.costCents +
                          Math.max(
                            0,
                            quote.assetReserveCents - (asset.cashCents ?? 0),
                          ),
                      ),
                    },
                  },
                },
              },
            },
          };
        } else if (command.type === "SELL_PROPERTY") {
          const quote = propertyManagement(state, playerId, authority).find(
            (item) => item.assetId === asset.id,
          )!;
          if (!quote.canSell) return reject("INSUFFICIENT_FUNDS");
          posting({
            source: externalCashAccount("market"),
            destination: propertyCashAccount(asset.id),
            amountCents: asset.marketValueCents,
            reason: "property-sale",
            relatedAssetId: asset.id,
          });
          payoff(asset);
          posting({
            source: propertyCashAccount(asset.id),
            destination: externalCashAccount("market"),
            amountCents: quote.saleFeeCents,
            reason: "property-sale-fee",
            relatedAssetId: asset.id,
          });
          const saleProceeds = allocateProportionalCents(
            cents(quote.netSaleProceedsCents),
            asset.ownershipByPlayerPpm,
          );
          for (const owner of (Object.keys(saleProceeds) as PlayerId[]).sort())
            posting({
              source: propertyCashAccount(asset.id),
              destination: playerCashAccount(owner),
              amountCents: saleProceeds[owner]!,
              reason: "property-sale-proceeds",
              relatedAssetId: asset.id,
            });
          draft = {
            ...draft,
            finance: {
              ...draft.finance,
              assetsById: {
                ...draft.finance.assetsById,
                [asset.id]: {
                  ...asset,
                  cashCents: cents(0),
                  debtServiceReserveCents: cents(0),
                  disposition: "sold",
                  ownershipByPlayerPpm: {},
                },
              },
            },
          };
          // Original acquisition debt is a funding source, never a gain or an extra cost.
          const netEconomicProceeds = cents(
            asset.marketValueCents +
              (asset.cashCents ?? 0) -
              quote.saleFeeCents -
              (quote.payoffCents -
                assetBankLiens(state, asset.id).reduce(
                  (sum, loan) => sum + loan.outstandingPrincipalCents,
                  0,
                )),
          );
          const economicShares = allocateProportionalCents(
            netEconomicProceeds,
            asset.ownershipByPlayerPpm,
          );
          const reference = cents(asset.marketValueCents - quote.payoffCents);
          const referenceShares = allocateProportionalCents(
            cents(Math.abs(reference)),
            asset.ownershipByPlayerPpm,
          );
          const byPlayer = { ...draft.progress.byPlayer };
          for (const owner of (
            Object.keys(asset.ownershipByPlayerPpm) as PlayerId[]
          ).sort()) {
            const progress = byPlayer[owner]!;
            const basis = progress.assetsById[asset.id]!;
            const bases = { ...progress.assetsById };
            delete bases[asset.id];
            const proceeds = economicShares[owner]!;
            const profitable =
              state.lastSettledQuarter >= basis.acquiredQuarter &&
              proceeds > basis.costCents;
            byPlayer[owner] = {
              ...progress,
              assetsById: bases,
              realizedGainsCents: cents(
                progress.realizedGainsCents + proceeds - basis.costCents,
              ),
              disposals: [
                ...progress.disposals,
                {
                  assetId: asset.id,
                  category: "property",
                  counterpartyPlayerId: null,
                  acquiredQuarter: basis.acquiredQuarter,
                  soldQuarter: state.currentQuarter,
                  proceedsCents: proceeds,
                  costCents: basis.costCents,
                  referenceEquityCents: cents(
                    reference < 0
                      ? -referenceShares[owner]!
                      : referenceShares[owner]!,
                  ),
                },
              ],
              profitableDisposalAssetIds: profitable
                ? [
                    ...new Set([
                      ...progress.profitableDisposalAssetIds,
                      asset.id,
                    ]),
                  ]
                : progress.profitableDisposalAssetIds,
            };
          }
          draft = { ...draft, progress: { byPlayer } };
        } else return reject("INVALID_ACTION");
      }
    }
    return { ok: true, state: draft, journalEntries: journals };
  } catch (error) {
    if (error instanceof RangeError)
      return reject(
        error.message === "INSUFFICIENT_FUNDS"
          ? "INSUFFICIENT_FUNDS"
          : "DESTINATION_OVERFLOW",
      );
    throw error;
  }
}

/** Sole-owner direct actions retain the existing atomic spotlight/settlement boundary. */
export function applyPropertyCommand(
  state: GameState,
  playerId: PlayerId,
  command: PropertyCommand,
): ActionResult {
  const draft = draftPropertyOwnerAction(state, playerId, command);
  if (!draft.ok) return draft;
  const advanced = advanceSpotlight(draft.state, playerId);
  if (!advanced.ok) return { ...advanced, state, journalEntries: [] };
  return {
    ...advanced,
    journalEntries: [...draft.journalEntries, ...advanced.journalEntries],
  };
}
