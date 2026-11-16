import { BUSINESS_CASH_POLICIES } from "@interests/rules";
import type { AssetId, PlayerId } from "@interests/shared";
import { cents, isNonNegativeCents } from "../finance/money";
import { allocateProportionalCents } from "../finance/ownership";
import type { GameState } from "../model/gameState";

function requireMoney(value: unknown): asserts value is number {
  if (!isNonNegativeCents(value))
    throw new Error("Game invariant failed: invalid business money");
}

export function assertBusinessCashState(state: GameState): void {
  for (const asset of Object.values(state.finance.assetsById)) {
    if (asset.kind !== "business") continue;
    if (!Object.hasOwn(BUSINESS_CASH_POLICIES, asset.cashPolicyId))
      throw new Error("Game invariant failed: invalid business cash policy");
    requireMoney(asset.cashCents);
    requireMoney(asset.operatingArrearsCents);
    if (
      asset.cashPolicyId === "retained-profit-v1" &&
      asset.debtPrincipalCents !== 0
    )
      throw new Error(
        "Game invariant failed: productive business debt has no approved schedule",
      );
    if (
      asset.cashPolicyId === "legacy-owner-income-v1" &&
      (asset.cashCents !== 0 || asset.operatingArrearsCents !== 0)
    )
      throw new Error(
        "Game invariant failed: legacy owner income cannot accumulate company cash/payables",
      );
  }
  const basis = state.finance.quarterStartBasis.businessesById;
  if (
    !basis ||
    Array.isArray(basis) ||
    Object.getPrototypeOf(basis) !== Object.prototype
  )
    throw new Error(
      "Game invariant failed: invalid business entitlement basis",
    );
  for (const asset of Object.values(state.finance.assetsById)) {
    if (asset.kind === "business" && !Object.hasOwn(basis, asset.id))
      throw new Error("Game invariant failed: missing business entitlement");
  }
  for (const id of Object.keys(basis) as AssetId[]) {
    const opening = basis[id];
    const asset = state.finance.assetsById[id];
    if (
      !opening ||
      !asset ||
      asset.kind !== "business" ||
      opening.cashPolicyId !== asset.cashPolicyId ||
      !Number.isSafeInteger(opening.annualOperatingProfitCents)
    )
      throw new Error(
        "Game invariant failed: invalid business entitlement asset",
      );
    allocateProportionalCents(cents(0), opening.ownershipByPlayerPpm);
    for (const owner of Object.keys(opening.ownershipByPlayerPpm) as PlayerId[])
      if (!state.playerOrder.includes(owner))
        throw new Error(
          "Game invariant failed: unknown entitled business owner",
        );
  }
  const outcome = state.finance.lastSettlement;
  if (!outcome) return;
  if (!Array.isArray(outcome.businesses))
    throw new Error("Game invariant failed: missing business outcomes");
  const seen = new Set<AssetId>();
  for (const business of outcome.businesses) {
    const asset = state.finance.assetsById[business.assetId];
    if (!asset || asset.kind !== "business" || seen.has(asset.id))
      throw new Error("Game invariant failed: invalid business outcome asset");
    seen.add(asset.id);
    for (const key of [
      "openingCashCents",
      "openingOperatingArrearsCents",
      "operatingDueCents",
      "operatingPaidCents",
      "closingOperatingArrearsCents",
      "retainedFromSurplusCents",
      "closingCashCents",
    ] as const)
      requireMoney(business[key]);
    if (
      !Number.isSafeInteger(business.operatingCashCents) ||
      !business.distributionsByPlayer
    )
      throw new Error(
        "Game invariant failed: invalid business operating outcome",
      );
    let distributed = cents(0);
    for (const [owner, amount] of Object.entries(
      business.distributionsByPlayer,
    )) {
      if (!state.playerOrder.includes(owner as PlayerId))
        throw new Error("Game invariant failed: unknown payout owner");
      requireMoney(amount);
      distributed = cents(distributed + amount);
    }
    if (
      business.operatingDueCents !==
        business.openingOperatingArrearsCents +
          Math.max(0, -business.operatingCashCents) ||
      business.operatingPaidCents > business.operatingDueCents ||
      business.closingOperatingArrearsCents !==
        business.operatingDueCents - business.operatingPaidCents ||
      business.closingCashCents !==
        business.openingCashCents +
          Math.max(0, business.operatingCashCents) -
          business.operatingPaidCents -
          distributed ||
      business.retainedFromSurplusCents + distributed !==
        Math.max(
          0,
          business.operatingCashCents - business.operatingPaidCents,
        ) ||
      business.closingCashCents !== asset.cashCents ||
      business.closingOperatingArrearsCents !== asset.operatingArrearsCents
    ) {
      throw new Error(
        "Game invariant failed: business outcome does not reconcile",
      );
    }
  }
}
