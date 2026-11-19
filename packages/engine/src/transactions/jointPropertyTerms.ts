import {
  BANK_CREDIT_GRADES,
  BANK_LENDING_RULES,
  OPERATING_RULES,
} from "@interests/rules";
import type {
  JointPropertyQuote,
  JointPropertyTerms,
  PlayerId,
  PropertyCommand,
} from "@interests/shared";
import { calculateAmortizingSchedule } from "../finance/amortization";
import { roundedRatio } from "../finance/bank";
import { cents } from "../finance/money";
import { allocateProportionalCents } from "../finance/ownership";
import { propertyManagement } from "../finance/propertyActions";
import type { GameState, PropertyAsset } from "../model/gameState";
import type { JointPropertyTransaction } from "./model";

export function jointPropertyParticipants(
  state: GameState,
  asset: PropertyAsset,
): PlayerId[] {
  return state.playerOrder.filter(
    (id) => (asset.ownershipByPlayerPpm[id] ?? 0) > 0,
  );
}
/** All figures are engine-owned. Only the initiating owner pays renovation/refinance cash. */
export function quoteJointProperty(
  state: GameState,
  asset: PropertyAsset,
  payer: PlayerId,
  terms: JointPropertyTerms,
  frozenForValidation?: JointPropertyQuote,
): JointPropertyQuote | null {
  if (
    !terms ||
    !asset.ownershipByPlayerPpm[payer] ||
    jointPropertyParticipants(state, asset).length < 2
  )
    return null;
  const unlocked = { ...state, activeTransaction: null };
  const position = propertyManagement(unlocked, payer, "unanimous-owners").find(
    (item) => item.assetId === asset.id,
  );
  if (!position) return null;
  switch (terms.kind) {
    case "sale":
      return position.canSell
        ? {
            kind: "sale",
            salePriceCents: asset.marketValueCents,
            feeCents: position.saleFeeCents,
            payoffCents: position.payoffCents,
            netProceedsCents: position.netSaleProceedsCents,
            proceedsByPlayer: allocateProportionalCents(
              cents(position.netSaleProceedsCents),
              asset.ownershipByPlayerPpm,
            ),
          }
        : null;
    case "refinance": {
      const quote = position.refinancingQuotes.find(
        (item) => item.rateKind === terms.rateKind,
      );
      if (!quote || (!frozenForValidation && !quote.canClose)) return null;
      let annualRateBps = quote.annualRateBps;
      let payment = quote.quarterlyPaymentCents;
      if (frozenForValidation) {
        if (
          frozenForValidation.kind !== "refinance" ||
          !BANK_CREDIT_GRADES.some(
            (grade) =>
              state.economy.baseRateBps +
                grade.spreadBps +
                (terms.rateKind === "fixed"
                  ? BANK_LENDING_RULES.fixedPropertyPremiumBps
                  : 0) ===
              frozenForValidation.annualRateBps,
          )
        )
          return null;
        annualRateBps = frozenForValidation.annualRateBps;
        payment = calculateAmortizingSchedule({
          principalCents: quote.principalCents,
          annualRateBps,
          termQuarters: quote.termQuarters,
        })[0]!.paymentCents;
      }
      return {
        kind: "refinance",
        payerPlayerId: payer,
        cashRequiredCents:
          quote.feeCents + Math.max(0, payment - (asset.cashCents ?? 0)),
        feeCents: quote.feeCents,
        principalCents: quote.principalCents,
        rateKind: quote.rateKind,
        annualRateBps,
        quarterlyPaymentCents: payment,
        assetReserveCents: payment,
        firstDueQuarter:
          state.currentQuarter + BANK_LENDING_RULES.firstPaymentQuarterOffset,
        termQuarters: quote.termQuarters,
      };
    }
    case "renovation":
      return (
        frozenForValidation
          ? asset.renovatedQuarter === undefined
          : position.canRenovate
      )
        ? {
            kind: "renovation",
            payerPlayerId: payer,
            cashRequiredCents: position.renovationCostCents,
            effectiveQuarter: state.currentQuarter + 1,
            rentIncreaseBps: OPERATING_RULES.renovationRentIncreaseBps,
            occupancyIncreaseBps: Math.min(
              10_000 - asset.occupancyBps,
              OPERATING_RULES.renovationOccupancyIncreaseBps,
            ),
            valueIncreaseCents: roundedRatio(
              position.renovationCostCents,
              OPERATING_RULES.renovationValuePerCostBps,
            ),
          }
        : null;
  }
  return null;
}
export function jointPropertyCashRequired(
  tx: JointPropertyTransaction,
  actor: PlayerId,
): number {
  return tx.quote.kind !== "sale" && actor === tx.initiatorPlayerId
    ? tx.quote.cashRequiredCents
    : 0;
}
export function jointPropertyCommand(
  tx: JointPropertyTransaction,
): PropertyCommand {
  return tx.terms.kind === "sale"
    ? { type: "SELL_PROPERTY", assetId: tx.assetId }
    : tx.terms.kind === "renovation"
      ? { type: "RENOVATE_PROPERTY", assetId: tx.assetId }
      : {
          type: "REFINANCE_PROPERTY",
          assetId: tx.assetId,
          rateKind: tx.terms.rateKind,
        };
}
export function jointPropertyRightsMatch(
  state: GameState,
  tx: JointPropertyTransaction,
): boolean {
  const asset = state.finance.assetsById[tx.assetId];
  return (
    asset?.kind === "property" &&
    Object.keys(tx.ownershipByPlayerPpm).length ===
      Object.keys(asset.ownershipByPlayerPpm).length &&
    Object.entries(tx.ownershipByPlayerPpm).every(
      ([id, units]) => units === asset.ownershipByPlayerPpm[id as PlayerId],
    )
  );
}
export function assertJointPropertyTransaction(
  state: GameState,
  tx: JointPropertyTransaction,
  active: PlayerId | null,
): void {
  const asset = state.finance.assetsById[tx.assetId];
  if (
    state.phase !== "ready-for-first-round" ||
    asset?.kind !== "property" ||
    !jointPropertyRightsMatch(state, tx) ||
    tx.createdQuarter !== state.currentQuarter ||
    state.round?.stage !== "spotlight" ||
    active !== tx.initiatorPlayerId ||
    !asset.ownershipByPlayerPpm[tx.initiatorPlayerId] ||
    !Number.isSafeInteger(tx.termsRevision) ||
    tx.termsRevision < 1 ||
    !Array.isArray(tx.confirmedPlayerIds) ||
    new Set(tx.confirmedPlayerIds).size !== tx.confirmedPlayerIds.length ||
    !tx.confirmedPlayerIds.every(
      (id) =>
        (asset.ownershipByPlayerPpm[id] ?? 0) > 0 &&
        (state.finance.cashByPlayer[id] ?? 0) >=
          jointPropertyCashRequired(tx, id),
    )
  )
    throw new Error("Invalid joint-property transaction");
  // Capacity changes require a fresh closing quote, not an unloadable/corrupt transaction.
  const quote = quoteJointProperty(
    state,
    asset,
    tx.initiatorPlayerId,
    tx.terms,
    tx.quote,
  );
  if (!quote || JSON.stringify(quote) !== JSON.stringify(tx.quote))
    throw new Error("Invalid joint-property quote");
}
