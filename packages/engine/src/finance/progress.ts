import {
  OBJECTIVE_MEASUREMENT_RULES,
  PUBLIC_MARKET_INSTRUMENT_IDS,
} from "@interests/rules";
import type { AssetId, PlayerId, TransactionId } from "@interests/shared";
import type {
  PlayerProgress,
  ProgressState,
  QuarterObservation,
  SourceObservation,
} from "../model/completionState";
import type {
  Asset,
  FinanceState,
  GameState,
  PropertyAsset,
  RecurringPersonalFinance,
} from "../model/gameState";
import { calculateBusinessEquity } from "./business";
import { FinanceDecimal } from "./decimal";
import {
  allocateDisposalCents,
  fundExposure,
  recordOwnershipTransfer,
} from "./disposalEvidence";
import type { JournalEntry } from "./journal";
import { beneficialBorrowerId, isLenderLoan } from "./loanParties";
import { type Cents, cents } from "./money";
import type { SettlementOutcome } from "./obligations";
import { allocateProportionalCents } from "./ownership";

export function capturePropertyBasis(
  assets: FinanceState["assetsById"],
): Record<AssetId, PropertyAsset> {
  const result: Record<AssetId, PropertyAsset> = {};
  for (const asset of Object.values(assets))
    if (asset.kind === "property" && asset.disposition !== "sold")
      result[asset.id] = {
        ...asset,
        ownershipByPlayerPpm: { ...asset.ownershipByPlayerPpm },
      };
  return result;
}
export function captureRecurringBasis(
  recurring: FinanceState["recurringByPlayer"],
): Record<PlayerId, RecurringPersonalFinance> {
  return Object.fromEntries(
    Object.entries(recurring).map(([id, value]) => [id, { ...value }]),
  ) as Record<PlayerId, RecurringPersonalFinance>;
}
export function createProgress(
  finance: FinanceState,
  playerOrder: readonly PlayerId[],
): ProgressState {
  return {
    byPlayer: Object.fromEntries(
      playerOrder.map((playerId) => {
        const owned = Object.values(finance.assetsById).filter(
          (asset) => (asset.ownershipByPlayerPpm[playerId] ?? 0) > 0,
        );
        const working = owned.find(
          (asset) =>
            asset.kind === "business" &&
            asset.workCompensation?.playerId === playerId &&
            asset.workCompensation.annualCompensationCents > 0,
        );
        return [
          playerId,
          {
            labor: working
              ? { kind: "owner-work", assetId: working.id }
              : finance.recurringByPlayer[playerId]!.quarterlyIncomeCents > 0
                ? { kind: "employment", role: "professional" }
                : { kind: "not-working" },
            focus: "general",
            publicMarketBasis: { ...finance.publicMarketsByPlayer[playerId]! },
            disposalEvidence: [],
            publicMarketExposure: Object.fromEntries(
              PUBLIC_MARKET_INSTRUMENT_IDS.map((instrumentId) => [
                instrumentId,
                finance.publicMarketsByPlayer[playerId]![instrumentId]
                  ? [
                      {
                        acquiredQuarter: 0,
                        settledExposureThroughQuarter: 0,
                        valueCents:
                          finance.publicMarketsByPlayer[playerId]![
                            instrumentId
                          ],
                        costCents:
                          finance.publicMarketsByPlayer[playerId]![
                            instrumentId
                          ],
                      },
                    ]
                  : [],
              ]),
            ) as unknown as NonNullable<PlayerProgress["publicMarketExposure"]>,
            assetsById: Object.fromEntries(
              owned.map((asset) => {
                const equity =
                  asset.kind === "business"
                    ? calculateBusinessEquity(asset, finance.loansById)
                        .equityValueCents
                    : asset.marketValueCents;
                return [
                  asset.id,
                  {
                    costCents: allocateProportionalCents(
                      cents(Math.max(0, equity)),
                      asset.ownershipByPlayerPpm,
                    )[playerId]!,
                    acquiredQuarter: 0,
                    settledExposureThroughQuarter: 0,
                    ownershipPpm: asset.ownershipByPlayerPpm[playerId]!,
                  },
                ];
              }),
            ),
            quarters: [],
            realizedGainsCents: cents(0),
            financingInterestReceivedCents: cents(0),
            disposals: [],
            publicMarketDisposals: [],
            profitableDisposalAssetIds: [],
          },
        ];
      }),
    ) as ProgressState["byPlayer"],
  };
}

/** Paid principal and arrears catch-up never become recurring investment income. */
export function recordQuarterObservations(
  state: GameState,
  outcome: SettlementOutcome,
  journals: readonly JournalEntry[],
  revaluedMarkets: FinanceState["publicMarketsByPlayer"] = state.finance
    .publicMarketsByPlayer,
): ProgressState {
  const byPlayer = { ...state.progress.byPlayer };
  for (const playerId of state.playerOrder) {
    const previous = byPlayer[playerId]!;
    if (previous.quarters.at(-1)?.quarter === outcome.quarter)
      throw new Error("Quarter observation already recorded");
    const sources: Record<string, SourceObservation> = {};
    let employment = 0,
      work = 0,
      recurringWork = 0;
    const add = (
      key: string,
      category: SourceObservation["category"],
      amount: number,
      debt = 0,
      personalDebt = 0,
    ) => {
      const old = sources[key];
      sources[key] = {
        category,
        recurringReceivedCents: cents(
          (old?.recurringReceivedCents ?? 0) + amount,
        ),
        debtServiceOwedCents: cents((old?.debtServiceOwedCents ?? 0) + debt),
        ...(personalDebt > 0 || old?.personalDebtServiceOwedCents !== undefined
          ? {
              personalDebtServiceOwedCents: cents(
                (old?.personalDebtServiceOwedCents ?? 0) + personalDebt,
              ),
            }
          : {}),
      };
    };
    for (const entry of journals) {
      if (
        entry.destination.kind !== "player" ||
        entry.destination.playerId !== playerId
      )
        continue;
      if (entry.reason === "recurring-personal-income")
        employment = cents(employment + entry.amountCents);
      else if (entry.reason === "cash-yield")
        add("cash", "cash", entry.amountCents);
      else if (entry.reason === "public-market-dividend")
        add(
          `fund:${entry.relatedMarketInstrumentId}`,
          "public-markets",
          entry.amountCents,
        );
      else if (entry.reason === "property-operating-distribution")
        add(`asset:${entry.relatedAssetId}`, "property", entry.amountCents);
      else if (entry.reason === "business-distribution")
        add(`asset:${entry.relatedAssetId}`, "business", entry.amountCents);
    }
    const companyOperatingProfitById: Record<AssetId, Cents> = {};
    for (const company of outcome.businesses) {
      const opening =
        state.finance.quarterStartBasis.businessesById[company.assetId]!;
      if ((opening.ownershipByPlayerPpm[playerId] ?? 0) > 0)
        companyOperatingProfitById[company.assetId] = cents(
          new FinanceDecimal(opening.annualOperatingProfitCents)
            .div(4)
            .round()
            .toNumber(),
        );
      if (
        opening.workCompensation?.playerId === playerId &&
        company.workCompensation
      ) {
        work = cents(
          work +
            company.workCompensation.currentPaidCents +
            company.workCompensation.arrearsPaidCents,
        );
        recurringWork = cents(
          recurringWork + company.workCompensation.currentPaidCents,
        );
      }
    }
    let financingInterest = previous.financingInterestReceivedCents;
    let owed = 0,
      paid = 0;
    for (const payment of outcome.loanPayments) {
      const loan = state.finance.loansById[payment.loanId]!;
      if (payment.borrowerPlayerId === playerId) {
        owed = cents(owed + payment.dueCents);
        paid = cents(paid + payment.paidCents);
        if (loan.kind === "legacy-bank-loan" && loan.relatedAssetId)
          add(
            `asset:${loan.relatedAssetId}`,
            "property",
            0,
            payment.dueCents,
            payment.dueCents,
          );
      }
      if (payment.lenderPlayerId === playerId && isLenderLoan(loan)) {
        financingInterest = cents(
          financingInterest + payment.interestPaidCents,
        );
        const currentInterestPaid = Math.max(
          0,
          payment.interestPaidCents - loan.unpaidInterestCents,
        );
        add(
          `borrower:${beneficialBorrowerId(loan)}`,
          "financing",
          currentInterestPaid,
        );
      }
    }
    if (state.finance.prepaidAssetInterest?.quarter === outcome.quarter) {
      for (const [id, evidence] of Object.entries(
        state.finance.prepaidAssetInterest.byAssetId,
      )) {
        const share =
          allocateProportionalCents(
            evidence.interestCents,
            evidence.ownershipByPlayerPpm,
          )[playerId] ?? 0;
        add(`asset:${id}`, "property", 0, share);
      }
    }
    for (const asset of Object.values(state.finance.assetsById)) {
      if (
        asset.kind !== "business" ||
        asset.npcSale?.quarter !== outcome.quarter
      )
        continue;
      const sale = asset.npcSale;
      const interest =
        allocateProportionalCents(
          sale.bankInterestPaidCents,
          sale.sellerOwnershipByPlayerPpm,
        )[playerId] ?? 0;
      if ((sale.sellerOwnershipByPlayerPpm[playerId] ?? 0) > 0)
        add(`asset:${asset.id}`, "business", 0, interest);
      if (asset.workCompensation?.playerId === playerId)
        work = cents(work + sale.workArrearsPaidCents);
    }
    const observation: QuarterObservation = {
      quarter: outcome.quarter,
      employmentIncomeCents: cents(employment),
      workIncomeCents: cents(work),
      recurringWorkIncomeCents: cents(recurringWork),
      livingCostOwedCents: outcome.livingByPlayer[playerId]!.currentDueCents,
      debtServiceOwedCents: cents(owed),
      debtServicePaidCents: cents(paid),
      sourcesById: sources,
      companyOperatingProfitById,
    };
    byPlayer[playerId] = {
      ...previous,
      assetsById: Object.fromEntries(
        Object.entries(previous.assetsById).map(([id, basis]) => [
          id,
          {
            ...basis,
            settledExposureThroughQuarter:
              basis.acquiredQuarter < outcome.quarter
                ? outcome.quarter
                : (basis.settledExposureThroughQuarter ?? 0),
            ...(basis.slices
              ? {
                  slices: basis.slices.map((slice) => ({
                    ...slice,
                    settledExposureThroughQuarter:
                      slice.acquiredQuarter < outcome.quarter
                        ? outcome.quarter
                        : (slice.settledExposureThroughQuarter ?? 0),
                  })),
                }
              : {}),
          },
        ]),
      ),
      publicMarketExposure: Object.fromEntries(
        PUBLIC_MARKET_INSTRUMENT_IDS.map((instrumentId) => {
          const slices = fundExposure(
            previous,
            instrumentId,
            state.finance.publicMarketsByPlayer[playerId]![instrumentId],
            outcome.quarter,
          );
          const values = allocateDisposalCents(
            revaluedMarkets[playerId]![instrumentId],
            slices.map((slice) => slice.valueCents),
          );
          return [
            instrumentId,
            slices.map((slice, index) => ({
              ...slice,
              valueCents: values[index]!,
              settledExposureThroughQuarter:
                slice.acquiredQuarter < outcome.quarter
                  ? outcome.quarter
                  : slice.settledExposureThroughQuarter,
            })),
          ];
        }),
      ) as unknown as NonNullable<PlayerProgress["publicMarketExposure"]>,
      financingInterestReceivedCents: financingInterest,
      quarters: [...previous.quarters, observation].slice(
        -OBJECTIVE_MEASUREMENT_RULES.lookbackQuarters,
      ),
    };
  }
  return { byPlayer };
}

/** Transfer basis with the actual asset close, not a subsequent history reconstruction. */
export function recordBusinessPurchaseBasis(
  progress: ProgressState,
  seller: PlayerId,
  buyer: PlayerId,
  asset: Asset,
  price: Cents,
  quarter: number,
  close?: {
    readonly transactionId: TransactionId;
    readonly loansById: FinanceState["loansById"];
  },
): ProgressState {
  const sellerProgress = progress.byPlayer[seller]!;
  const acquisition = sellerProgress.assetsById[asset.id];
  if (!acquisition) throw new Error("Missing acquisition basis");
  const realizedGainsCents = cents(
    new FinanceDecimal(sellerProgress.realizedGainsCents)
      .plus(price)
      .minus(acquisition.costCents)
      .toNumber(),
  );
  const sellerBasis = { ...sellerProgress.assetsById };
  delete sellerBasis[asset.id];
  const buyerProgress = progress.byPlayer[buyer]!;
  const slices = acquisition.slices ?? [acquisition];
  const proceeds = allocateDisposalCents(
    price,
    slices.map((slice) => slice.ownershipPpm),
  );
  const equity =
    asset.kind === "business"
      ? calculateBusinessEquity(asset, close?.loansById ?? {}).equityValueCents
      : asset.marketValueCents;
  const reference = allocateDisposalCents(
    cents(Math.max(0, equity)),
    slices.map((slice) => slice.ownershipPpm),
  );
  const transfers = close
    ? slices.map((slice, index) =>
        recordOwnershipTransfer(
          {
            disposalId: `${close.transactionId}:${seller}:${asset.id}:${index}`,
            transactionId: close.transactionId,
            underlyingAssetId: asset.id,
            category: asset.kind,
            counterparty: { kind: "player", id: buyer },
            acquiredQuarter: slice.acquiredQuarter,
            settledExposureThroughQuarter:
              slice.settledExposureThroughQuarter ?? 0,
            soldQuarter: quarter,
            proceedsCents: proceeds[index]!,
            saleFeesCents: cents(0),
            acquisitionBasisCents: slice.costCents,
            ...(slice.objectiveCostFloorCents !== undefined
              ? {
                  objectiveAcquisitionBasisFloorCents:
                    slice.objectiveCostFloorCents,
                }
              : {}),
            referenceProceedsCents: reference[index]!,
            economicSubstance: "genuine",
            ownershipUnits: slice.ownershipPpm,
          },
          seller,
          buyer,
          slice.previousTransfers,
        ),
      )
    : [];

  return {
    byPlayer: {
      ...progress.byPlayer,
      [seller]: {
        ...sellerProgress,
        assetsById: sellerBasis,
        realizedGainsCents,
        ...(close
          ? {
              disposalEvidence: [
                ...(sellerProgress.disposalEvidence ?? []),
                ...transfers.map((transfer) => transfer.record),
              ],
            }
          : {}),
        disposals: [
          ...sellerProgress.disposals,
          {
            assetId: asset.id,
            category: asset.kind,
            counterpartyPlayerId: buyer,
            acquiredQuarter: acquisition.acquiredQuarter,
            soldQuarter: quarter,
            proceedsCents: price,
            costCents: acquisition.costCents,
            referenceEquityCents:
              asset.kind === "business"
                ? calculateBusinessEquity(asset, {}).equityValueCents
                : asset.marketValueCents,
          },
        ],
      },
      [buyer]: {
        ...buyerProgress,
        assetsById: {
          ...buyerProgress.assetsById,
          [asset.id]: {
            costCents: price,
            ...(close
              ? {
                  objectiveCostFloorCents: cents(
                    reference.reduce(
                      (total, amount, index) =>
                        total + Math.max(amount, proceeds[index]!),
                      0,
                    ),
                  ),
                  settledExposureThroughQuarter: 0,
                  slices: slices.map((slice, index) => ({
                    acquiredQuarter: quarter,
                    costCents: proceeds[index]!,
                    objectiveCostFloorCents: cents(
                      Math.max(proceeds[index]!, reference[index]!),
                    ),
                    ownershipPpm: slice.ownershipPpm,
                    settledExposureThroughQuarter: 0,
                    previousTransfers: transfers[index]!.previousTransfers,
                  })),
                }
              : {}),
            acquiredQuarter: quarter,
            ownershipPpm: asset.ownershipByPlayerPpm[buyer]!,
          },
        },
      },
    },
  };
}
