import { BUSINESS_CASH_POLICIES } from "@interests/rules";
import type { AssetId, PlayerId } from "@interests/shared";
import type {
  BusinessAsset,
  BusinessQuarterBasis,
  FinanceState,
} from "../model/gameState";
import {
  businessCashAccount,
  externalCashAccount,
  playerCashAccount,
} from "./account";
import { calculateBusinessEquity } from "./business";
import { FinanceDecimal } from "./decimal";
import { type Cents, cents } from "./money";
import { allocateProportionalCents } from "./ownership";
import type { CashPostingRequest } from "./posting";

export interface BusinessSettlementOutcome {
  readonly assetId: AssetId;
  readonly openingCashCents: Cents;
  readonly openingOperatingArrearsCents: Cents;
  readonly operatingCashCents: Cents;
  readonly operatingDueCents: Cents;
  readonly operatingPaidCents: Cents;
  readonly closingOperatingArrearsCents: Cents;
  readonly retainedFromSurplusCents: Cents;
  readonly closingCashCents: Cents;
  readonly distributionsByPlayer: Readonly<Record<PlayerId, Cents>>;
}

export class BusinessCashOverflowError extends RangeError {}

export function captureBusinessBasis(
  assets: FinanceState["assetsById"],
): Record<AssetId, BusinessQuarterBasis> {
  const result: Record<AssetId, BusinessQuarterBasis> = {};
  for (const id of (Object.keys(assets) as AssetId[]).sort()) {
    const asset = assets[id];
    if (asset?.kind === "business")
      result[id] = {
        cashPolicyId: asset.cashPolicyId,
        annualOperatingProfitCents: asset.annualOperatingProfitCents,
        ownershipByPlayerPpm: { ...asset.ownershipByPlayerPpm },
      };
  }
  return result;
}

export function planBusinessSettlement(
  asset: BusinessAsset,
  basis: BusinessQuarterBasis,
  quarter: number,
): {
  readonly postings: readonly CashPostingRequest[];
  readonly outcome: BusinessSettlementOutcome;
} | null {
  const policy = BUSINESS_CASH_POLICIES[basis.cashPolicyId];
  if (
    policy.kind === "legacy-owner-income" ||
    quarter < policy.firstOperatingQuarter
  )
    return null;
  if (asset.debtPrincipalCents !== 0)
    throw new Error("Productive company debt requires an approved schedule");
  const operatingCashCents = cents(
    new FinanceDecimal(basis.annualOperatingProfitCents)
      .div(4)
      .round()
      .toNumber(),
  );
  if (
    Math.max(0, operatingCashCents) >
    Number.MAX_SAFE_INTEGER - asset.cashCents
  ) {
    throw new BusinessCashOverflowError(
      "Company operating receipt exceeds cash capacity",
    );
  }
  const available = cents(asset.cashCents + Math.max(0, operatingCashCents));
  const operatingDueCents = cents(
    asset.operatingArrearsCents + Math.max(0, -operatingCashCents),
  );
  const operatingPaidCents = cents(Math.min(available, operatingDueCents));
  const closingOperatingArrearsCents = cents(
    operatingDueCents - operatingPaidCents,
  );
  const surplus =
    closingOperatingArrearsCents > 0
      ? 0
      : Math.min(
          available - operatingPaidCents,
          Math.max(0, operatingCashCents - operatingPaidCents),
        );
  const retainedFromSurplusCents = cents(
    new FinanceDecimal(surplus)
      .times(policy.retentionBps)
      .div(10_000)
      .round()
      .toNumber(),
  );
  const payout = cents(surplus - retainedFromSurplusCents);
  const closingCashCents = cents(available - operatingPaidCents - payout);
  try {
    calculateBusinessEquity({
      ...asset,
      cashCents: closingCashCents,
      operatingArrearsCents: closingOperatingArrearsCents,
    });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new BusinessCashOverflowError(
      "Closing company equity exceeds capacity",
    );
  }
  const distributionsByPlayer = allocateProportionalCents(
    payout,
    basis.ownershipByPlayerPpm,
  );
  const postings: CashPostingRequest[] = [];
  if (operatingCashCents > 0)
    postings.push({
      source: externalCashAccount("business-operating-cashflow"),
      destination: businessCashAccount(asset.id),
      amountCents: operatingCashCents,
      quarter,
      reason: "business-operating-cashflow",
      relatedAssetId: asset.id,
    });
  if (operatingPaidCents > 0)
    postings.push({
      source: businessCashAccount(asset.id),
      destination: externalCashAccount("business-operating-costs"),
      amountCents: operatingPaidCents,
      quarter,
      reason: "business-operating-cost-payment",
      relatedAssetId: asset.id,
    });
  for (const playerId of (
    Object.keys(distributionsByPlayer) as PlayerId[]
  ).sort()) {
    const amountCents = distributionsByPlayer[playerId];
    if (amountCents !== undefined && amountCents > 0)
      postings.push({
        source: businessCashAccount(asset.id),
        destination: playerCashAccount(playerId),
        amountCents,
        quarter,
        reason: "business-distribution",
        relatedAssetId: asset.id,
      });
  }
  return {
    postings,
    outcome: {
      assetId: asset.id,
      openingCashCents: asset.cashCents,
      openingOperatingArrearsCents: asset.operatingArrearsCents,
      operatingCashCents,
      operatingDueCents,
      operatingPaidCents,
      closingOperatingArrearsCents,
      retainedFromSurplusCents,
      closingCashCents,
      distributionsByPlayer,
    },
  };
}
