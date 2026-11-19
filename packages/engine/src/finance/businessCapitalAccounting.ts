import { TRANSACTION_FEES_BPS } from "@interests/rules";
import type { AssetId, PlayerId, TransactionId } from "@interests/shared";
import type { AssetAcquisitionBasis } from "../model/completionState";
import type { BusinessAsset, GameState } from "../model/gameState";
import {
  businessCashAccount,
  externalCashAccount,
  playerCashAccount,
} from "./account";
import { calculateBusinessEquity } from "./business";
import {
  diluteBusinessOwnership,
  transferBusinessStake,
} from "./businessStakes";
import { FinanceDecimal } from "./decimal";
import type { JournalEntry } from "./journal";
import { addCents, type Cents, cents, isNonNegativeCents } from "./money";
import { ownershipPpm, TOTAL_OWNERSHIP_PPM } from "./ownership";
import { type CashPostingRequest, postCash } from "./posting";
import {
  addStakeAcquisitionSlice,
  allocateStakeSliceCents,
  diluteStakeBasis,
  disposeStakeBasis,
  type StakeBasisSlice,
} from "./stakeBasis";

export interface PrimaryContribution {
  readonly playerId: PlayerId;
  readonly amountCents: number;
  readonly postMoneyOwnershipPpm: number;
}

export type BusinessCapitalConsideration =
  | {
      readonly kind: "secondary-stake-sale";
      readonly sellerPlayerId: PlayerId;
      readonly buyerPlayerId: PlayerId;
      readonly ownershipPpm: number;
      readonly priceCents: number;
    }
  | {
      readonly kind: "primary-issuance";
      readonly contributions: readonly PrimaryContribution[];
    };

type CapitalPosting = Pick<
  CashPostingRequest,
  "source" | "destination" | "amountCents" | "reason"
>;

export type BusinessCapitalAccountingResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly journalEntries: readonly JournalEntry[];
    }
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly journalEntries: readonly [];
      readonly code:
        | "UNKNOWN_ASSET"
        | "INVALID_CAPITAL_CONSIDERATION"
        | "INSUFFICIENT_FUNDS"
        | "DESTINATION_OVERFLOW"
        | "COUNTER_EXHAUSTED";
    };

function lots(
  basis: AssetAcquisitionBasis | undefined,
): readonly StakeBasisSlice[] {
  if (!basis) return [];
  return (
    basis.slices ?? [
      {
        acquiredQuarter: basis.acquiredQuarter,
        costCents: basis.costCents,
        ownershipPpm: basis.ownershipPpm,
      },
    ]
  );
}

function summarize(slices: readonly StakeBasisSlice[]): AssetAcquisitionBasis {
  const latest = slices.at(-1);
  if (!latest) throw new RangeError("Expected retained acquisition basis");
  return {
    slices,
    // A caller that only understands the scalar must never age a new purchase.
    acquiredQuarter: latest.acquiredQuarter,
    costCents: slices.reduce(
      (cost, slice) => addCents(cost, slice.costCents),
      cents(0),
    ),
    ownershipPpm: ownershipPpm(
      slices.reduce((units, slice) => units + slice.ownershipPpm, 0),
    ),
  };
}

function fee(priceCents: number, bps: number): Cents {
  return cents(
    new FinanceDecimal(priceCents).times(bps).div(10_000).round().toNumber(),
  );
}

export function businessStakePurchaseTotalCents(priceCents: number): Cents {
  return addCents(
    cents(priceCents),
    fee(priceCents, TRANSACTION_FEES_BPS.business.purchase),
  );
}

function salePosting(
  state: GameState,
  asset: BusinessAsset,
  transactionId: TransactionId,
  terms: Extract<
    BusinessCapitalConsideration,
    { kind: "secondary-stake-sale" }
  >,
) {
  const {
    sellerPlayerId,
    buyerPlayerId,
    ownershipPpm: soldPpm,
    priceCents,
  } = terms;
  const seller = state.progress.byPlayer[sellerPlayerId];
  const buyer = state.progress.byPlayer[buyerPlayerId];
  if (
    !seller ||
    !buyer ||
    !Object.hasOwn(state.players, sellerPlayerId) ||
    !Object.hasOwn(state.players, buyerPlayerId) ||
    !isNonNegativeCents(priceCents) ||
    priceCents === 0 ||
    (asset.workCompensation?.playerId === sellerPlayerId &&
      asset.workCompensation.annualCompensationCents > 0 &&
      asset.ownershipByPlayerPpm[sellerPlayerId] === soldPpm)
  ) {
    throw new RangeError("Unsupported secondary stake sale");
  }
  const owners = transferBusinessStake(
    asset.ownershipByPlayerPpm,
    sellerPlayerId,
    buyerPlayerId,
    soldPpm,
  );
  const buyerFee = fee(priceCents, TRANSACTION_FEES_BPS.business.purchase);
  const sellerFee = fee(priceCents, TRANSACTION_FEES_BPS.business.sale);
  const purchaseCost = addCents(cents(priceCents), buyerFee);
  const disposal = disposeStakeBasis(
    lots(seller.assetsById[asset.id]),
    soldPpm,
    priceCents - sellerFee,
  );
  const fullEquity = calculateBusinessEquity(
    asset,
    state.finance.loansById,
  ).equityValueCents;
  const reference = cents(
    new FinanceDecimal(Math.max(0, fullEquity))
      .times(soldPpm)
      .div(TOTAL_OWNERSHIP_PPM)
      .round()
      .toNumber(),
  );
  const referenceSlices = allocateStakeSliceCents(
    reference,
    disposal.disposedSlices,
  );
  const feeSlices = allocateStakeSliceCents(sellerFee, disposal.disposedSlices);
  const soldAssets = { ...seller.assetsById };
  if (disposal.retainedSlices.length > 0)
    soldAssets[asset.id] = summarize(disposal.retainedSlices);
  else delete soldAssets[asset.id];
  const boughtBasis = summarize(
    addStakeAcquisitionSlice(lots(buyer.assetsById[asset.id]), {
      costCents: purchaseCost,
      acquiredQuarter: state.currentQuarter,
      ownershipPpm: ownershipPpm(soldPpm),
    }),
  );
  const progress = {
    byPlayer: {
      ...state.progress.byPlayer,
      [sellerPlayerId]: {
        ...seller,
        assetsById: soldAssets,
        disposals: [
          ...seller.disposals,
          ...disposal.disposedSlices.map((slice, index) => ({
            assetId: asset.id,
            category: "business" as const,
            counterpartyPlayerId: buyerPlayerId,
            transactionId,
            acquiredQuarter: slice.acquiredQuarter,
            soldQuarter: state.currentQuarter,
            proceedsCents: slice.netProceedsCents,
            grossProceedsCents: addCents(
              slice.netProceedsCents,
              feeSlices[index]!,
            ),
            costCents: slice.costCents,
            referenceEquityCents: referenceSlices[index]!,
          })),
        ],
      },
      [buyerPlayerId]: {
        ...buyer,
        assetsById: { ...buyer.assetsById, [asset.id]: boughtBasis },
      },
    },
  };
  const postings: readonly CapitalPosting[] = [
    {
      source: playerCashAccount(buyerPlayerId),
      destination: playerCashAccount(sellerPlayerId),
      amountCents: priceCents,
      reason: "business-stake-consideration",
    },
    {
      source: playerCashAccount(buyerPlayerId),
      destination: externalCashAccount("market"),
      amountCents: buyerFee,
      reason: "business-stake-purchase-fee",
    },
    {
      source: playerCashAccount(sellerPlayerId),
      destination: externalCashAccount("market"),
      amountCents: sellerFee,
      reason: "business-stake-sale-fee",
    },
  ];
  return { owners, progress, postings };
}

function issuancePosting(
  state: GameState,
  asset: BusinessAsset,
  contributions: readonly PrimaryContribution[],
) {
  if (
    !Array.isArray(contributions) ||
    contributions.length === 0 ||
    contributions.length > state.playerOrder.length
  )
    throw new RangeError("Invalid contribution count");
  const grants: Record<PlayerId, number> = {};
  const amounts: Record<PlayerId, Cents> = {};
  for (const {
    playerId,
    amountCents,
    postMoneyOwnershipPpm,
  } of contributions) {
    if (
      !Object.hasOwn(state.players, playerId) ||
      Object.hasOwn(grants, playerId) ||
      !isNonNegativeCents(amountCents) ||
      amountCents === 0
    )
      throw new RangeError("Invalid capital contribution");
    grants[playerId] = postMoneyOwnershipPpm;
    amounts[playerId] = amountCents;
  }
  const owners = diluteBusinessOwnership(asset.ownershipByPlayerPpm, grants);
  const byPlayer = { ...state.progress.byPlayer };
  const postings: CapitalPosting[] = [];
  for (const playerId of state.playerOrder) {
    const granted = Object.hasOwn(grants, playerId) ? grants[playerId]! : 0;
    const oldOwnership = asset.ownershipByPlayerPpm[playerId] ?? 0;
    if (!oldOwnership && !granted) continue;
    const player = byPlayer[playerId]!;
    let slices = lots(player.assetsById[asset.id]);
    if (oldOwnership)
      slices = diluteStakeBasis(slices, owners[playerId]! - granted);
    if (granted) {
      const amountCents = amounts[playerId]!;
      slices = addStakeAcquisitionSlice(slices, {
        acquiredQuarter: state.currentQuarter,
        costCents: amountCents,
        ownershipPpm: ownershipPpm(granted),
      });
      postings.push({
        source: playerCashAccount(playerId),
        destination: businessCashAccount(asset.id),
        amountCents,
        reason: "business-primary-equity-contribution",
      });
    }
    byPlayer[playerId] = {
      ...player,
      assetsById: { ...player.assetsById, [asset.id]: summarize(slices) },
    };
  }
  return { owners, progress: { byPlayer }, postings };
}

/**
 * Draft only. The transaction lifecycle owns revisions, confirmed parties,
 * reservations, debt closing and spotlight advancement.
 */
export function postBusinessCapitalConsideration(
  state: GameState,
  assetId: AssetId,
  transactionId: TransactionId,
  consideration: BusinessCapitalConsideration,
): BusinessCapitalAccountingResult {
  const reject = (
    code: Extract<BusinessCapitalAccountingResult, { ok: false }>["code"],
  ): BusinessCapitalAccountingResult => ({
    ok: false,
    state,
    journalEntries: [],
    code,
  });
  const asset = state.finance.assetsById[assetId];
  if (asset?.kind !== "business") return reject("UNKNOWN_ASSET");
  let draft: ReturnType<typeof salePosting>;
  try {
    draft =
      consideration.kind === "primary-issuance"
        ? issuancePosting(state, asset, consideration.contributions)
        : salePosting(state, asset, transactionId, consideration);
  } catch (error) {
    if (error instanceof RangeError)
      return reject("INVALID_CAPITAL_CONSIDERATION");
    throw error;
  }
  let { finance, counters } = state;
  const journalEntries: JournalEntry[] = [];
  try {
    for (const posting of draft.postings) {
      if (posting.amountCents === 0) continue;
      const result = postCash(finance, counters, {
        ...posting,
        quarter: state.currentQuarter,
        relatedAssetId: assetId,
        relatedTransactionId: transactionId,
      });
      if (!result.ok) {
        if (
          result.code === "INSUFFICIENT_FUNDS" ||
          result.code === "DESTINATION_OVERFLOW"
        )
          return reject(result.code);
        return reject("INVALID_CAPITAL_CONSIDERATION");
      }
      finance = result.finance;
      counters = result.counters;
      journalEntries.push(result.entry);
    }
  } catch (error) {
    if (error instanceof RangeError) return reject("COUNTER_EXHAUSTED");
    throw error;
  }
  const postedAsset = finance.assetsById[assetId] as BusinessAsset;
  return {
    ok: true,
    state: {
      ...state,
      counters,
      progress: draft.progress,
      finance: {
        ...finance,
        assetsById: {
          ...finance.assetsById,
          [assetId]: { ...postedAsset, ownershipByPlayerPpm: draft.owners },
        },
      },
    },
    journalEntries,
  };
}
