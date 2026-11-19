import { BUSINESS_CASH_POLICIES, TRANSACTION_FEES_BPS } from "@interests/rules";
import type { AssetId, PlayerId } from "@interests/shared";
import { roundedRatio } from "../finance/bank";
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
    if (asset.npcSale) {
      const sale = asset.npcSale;
      if (
        !Number.isSafeInteger(sale.quarter) ||
        sale.quarter < 1 ||
        sale.quarter > state.currentQuarter ||
        typeof sale.quoteId !== "string" ||
        !sale.quoteId.trim() ||
        typeof sale.buyerId !== "string" ||
        !sale.buyerId.trim() ||
        state.playerOrder.some((id) => id === sale.buyerId) ||
        !/^transaction-[1-9]\d*$/.test(sale.transactionId) ||
        Object.keys(asset.ownershipByPlayerPpm).length !== 0
      )
        throw new Error("Invalid NPC company sale");
      for (const key of [
        "operatingEnterpriseBidCents",
        "retainedCompanyCashCents",
        "grossConsiderationCents",
        "saleFeeCents",
        "bankPayoffCents",
        "bankInterestPaidCents",
        "operatingArrearsPaidCents",
        "workArrearsPaidCents",
        "netOwnerProceedsCents",
      ] as const)
        requireMoney(sale[key]);
      allocateProportionalCents(cents(0), sale.sellerOwnershipByPlayerPpm);
      if (
        Object.keys(sale.sellerOwnershipByPlayerPpm).some(
          (id) => !state.playerOrder.includes(id as PlayerId),
        ) ||
        sale.operatingEnterpriseBidCents === 0 ||
        sale.grossConsiderationCents !==
          sale.operatingEnterpriseBidCents + sale.retainedCompanyCashCents ||
        sale.saleFeeCents !==
          roundedRatio(
            sale.grossConsiderationCents,
            TRANSACTION_FEES_BPS.business.sale,
          ) ||
        sale.bankInterestPaidCents > sale.bankPayoffCents ||
        sale.grossConsiderationCents !==
          sale.saleFeeCents +
            sale.bankPayoffCents +
            sale.operatingArrearsPaidCents +
            sale.workArrearsPaidCents +
            sale.netOwnerProceedsCents ||
        (!asset.workCompensation && sale.workArrearsPaidCents !== 0) ||
        Object.values(state.finance.loansById).some(
          (loan) =>
            (loan.kind === "company-loan" || loan.kind === "asset-bank-loan") &&
            loan.borrowerAssetId === asset.id &&
            (loan.outstandingPrincipalCents ||
              loan.unpaidInterestCents ||
              loan.pastDuePrincipalCents),
        )
      )
        throw new Error("NPC company sale does not reconcile");
    }

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
        (work.annualCompensationCents > 0 &&
          !asset.npcSale &&
          (asset.ownershipByPlayerPpm[work.playerId] ?? 0) <= 0)
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
    if (
      asset.kind === "business" &&
      !asset.npcSale &&
      !Object.hasOwn(basis, asset.id)
    )
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
    const paidAfterOutcome =
      asset.npcSale && asset.npcSale.quarter > outcome.quarter
        ? asset.npcSale
        : null;
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
        work.closingArrearsCents !==
          asset.workCompensation.arrearsCents +
            (paidAfterOutcome?.workArrearsPaidCents ?? 0) ||
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
    const hasLoanArrears = outcome.loanPayments.some(
      (payment) =>
        payment.borrowerAssetId === asset.id &&
        payment.paidCents < payment.dueCents,
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
      business.closingOperatingArrearsCents !==
        asset.operatingArrearsCents +
          (paidAfterOutcome?.operatingArrearsPaidCents ?? 0)
    ) {
      throw new Error(
        "Game invariant failed: business outcome does not reconcile",
      );
    }
  }
}
