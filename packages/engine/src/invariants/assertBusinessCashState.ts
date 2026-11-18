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
    if (asset.annualManagementCostCents !== undefined) {
      requireMoney(asset.annualManagementCostCents);
      if (
        asset.cashPolicyId !== "starting-company-v1" ||
        asset.workCompensation?.annualCompensationCents !== 0
      )
        throw new Error("Invalid managed labor replacement");
    }
    if (
      asset.cashPolicyId === "retained-profit-v1" &&
      asset.debtPrincipalCents !== 0
    )
      throw new Error(
        "Game invariant failed: productive business debt has no approved schedule",
      );
    if (asset.cashPolicyId === "starting-company-v1") {
      if (Object.hasOwn(asset, "debtPrincipalCents"))
        throw new Error(
          "Game invariant failed: company debt must be registry-owned",
        );
      if (
        !Object.values(state.finance.loansById).some(
          (loan) =>
            loan.kind === "company-loan" && loan.borrowerAssetId === asset.id,
        )
      )
        throw new Error(
          "Game invariant failed: missing canonical company loan",
        );
      const work = asset.workCompensation;
      if (
        !work ||
        !state.playerOrder.includes(work.playerId) ||
        (asset.ownershipByPlayerPpm[work.playerId] ?? 0) <= 0
      )
        throw new Error("Game invariant failed: invalid company work party");
      requireMoney(work.annualCompensationCents);
      requireMoney(work.arrearsCents);
    } else if (asset.workCompensation !== undefined)
      throw new Error("Game invariant failed: unsupported work contract");
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
    const work = asset.workCompensation;
    if (
      work &&
      (!opening.workCompensation ||
        opening.workCompensation.playerId !== work.playerId ||
        !Number.isSafeInteger(
          opening.workCompensation.annualCompensationCents,
        ) ||
        opening.workCompensation.annualCompensationCents < 0)
    )
      throw new Error("Game invariant failed: invalid company work basis");
    if (
      work &&
      opening.workCompensation &&
      opening.workCompensation.annualCompensationCents +
        (opening.annualManagementCostCents ?? 0) !==
        work.annualCompensationCents + (asset.annualManagementCostCents ?? 0)
    )
      throw new Error("Necessary labor cost changed");
    if (!work && opening.workCompensation !== undefined)
      throw new Error("Game invariant failed: unexpected company work basis");
    if (opening.annualManagementCostCents !== undefined)
      requireMoney(opening.annualManagementCostCents);
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
    const work = business.workCompensation;
    const beforeComp =
      business.cashBeforeCompensationCents ?? business.operatingCashCents;
    const workPaid = work ? work.currentPaidCents + work.arrearsPaidCents : 0;
    if (work) {
      if (
        !asset.workCompensation ||
        work.playerId !== asset.workCompensation.playerId
      )
        throw new Error("Game invariant failed: invalid work outcome party");
      for (const key of [
        "currentDueCents",
        "currentPaidCents",
        "arrearsDueCents",
        "arrearsPaidCents",
        "closingArrearsCents",
      ] as const)
        requireMoney(work[key]);
      if (
        work.currentPaidCents > work.currentDueCents ||
        work.arrearsPaidCents > work.arrearsDueCents ||
        work.closingArrearsCents !==
          work.currentDueCents + work.arrearsDueCents - workPaid ||
        work.closingArrearsCents !== asset.workCompensation.arrearsCents ||
        beforeComp !==
          business.operatingCashCents +
            work.currentDueCents +
            (business.managementDueCents ?? 0)
      )
        throw new Error(
          "Game invariant failed: work outcome does not reconcile",
        );
    } else if (asset.workCompensation)
      throw new Error("Game invariant failed: missing work outcome");
    requireMoney(business.managementDueCents ?? 0);
    requireMoney(business.managementPaidCents ?? 0);
    if (
      (business.managementPaidCents ?? 0) > (business.managementDueCents ?? 0)
    )
      throw new Error("Invalid management payment");
    const debtPaid = business.companyDebtPaidCents ?? 0;
    requireMoney(debtPaid);
    const actualDebtPaid = cents(
      outcome.loanPayments
        .filter((payment) => payment.borrowerAssetId === asset.id)
        .reduce((sum, payment) => sum + payment.paidCents, 0),
    );
    if (actualDebtPaid !== debtPaid)
      throw new Error(
        "Game invariant failed: company debt outcome does not reconcile",
      );
    const hasLoanArrears = Object.values(state.finance.loansById).some(
      (loan) =>
        (loan.kind === "company-loan" ||
          (loan.kind === "asset-bank-loan" &&
            loan.purpose === "business-acquisition")) &&
        loan.borrowerAssetId === asset.id &&
        (loan.pastDuePrincipalCents > 0 || loan.unpaidInterestCents > 0),
    );
    // Later contributions may change current cash; the historical closing sum still reconciles.
    const historicalWorkPaid = work?.arrearsPaidCents ?? 0;
    if (
      business.operatingDueCents !==
        business.openingOperatingArrearsCents +
          Math.max(0, -beforeComp) +
          (business.managementDueCents ?? 0) ||
      business.operatingPaidCents > business.operatingDueCents ||
      business.closingOperatingArrearsCents !==
        business.operatingDueCents - business.operatingPaidCents ||
      business.closingCashCents !==
        business.openingCashCents +
          Math.max(0, beforeComp) -
          business.operatingPaidCents -
          workPaid -
          debtPaid -
          distributed ||
      business.retainedFromSurplusCents + distributed !==
        (hasLoanArrears
          ? 0
          : Math.max(
              0,
              business.operatingCashCents +
                (business.managementPaidCents ?? 0) -
                business.operatingPaidCents -
                historicalWorkPaid -
                debtPaid,
            )) ||
      business.closingOperatingArrearsCents !== asset.operatingArrearsCents
    ) {
      throw new Error(
        "Game invariant failed: business outcome does not reconcile",
      );
    }
  }
}
