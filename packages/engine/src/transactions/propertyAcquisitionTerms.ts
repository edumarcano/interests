import { BANK_CREDIT_GRADES, BANK_LENDING_RULES } from "@interests/rules";
import type {
  PlayerId,
  PropertyAcquisitionQuote,
  PropertyAcquisitionTerms,
} from "@interests/shared";
import { calculateAmortizingPayment } from "../finance/amortization";
import { propertyLoanQuote } from "../finance/bank";
import { FinanceDecimal } from "../finance/decimal";
import { cents } from "../finance/money";
import { calculatePropertyCashFlow } from "../finance/property";
import { catalogueProperty, purchaseQuote } from "../finance/propertyActions";
import type { GameState } from "../model/gameState";
import type { PropertyAcquisitionTransaction } from "./model";

/** Client terms choose funding and ownership only; all price and loan figures come from the engine. */
export function quotePropertyAcquisition(
  state: GameState,
  lead: PlayerId,
  terms: PropertyAcquisitionTerms,
  frozen?: PropertyAcquisitionQuote,
): PropertyAcquisitionQuote | null {
  if (
    !terms ||
    typeof terms.catalogueId !== "string" ||
    !["fixed", "variable"].includes(terms.rateKind) ||
    !Number.isSafeInteger(terms.principalCents) ||
    terms.principalCents < 0 ||
    !Array.isArray(terms.buyers) ||
    terms.buyers.length < 2 ||
    terms.buyers.length > state.playerOrder.length ||
    terms.buyers.some(
      (buyer) =>
        !buyer ||
        typeof buyer !== "object" ||
        !state.playerOrder.includes(buyer.playerId as PlayerId),
    ) ||
    new Set(terms.buyers.map((buyer) => buyer.playerId)).size !==
      terms.buyers.length ||
    !terms.buyers.some((buyer) => buyer.playerId === lead) ||
    terms.buyers.some(
      (buyer) =>
        !state.players[buyer.playerId as PlayerId] ||
        !Number.isSafeInteger(buyer.cashContributionCents) ||
        buyer.cashContributionCents <= 0 ||
        !Number.isSafeInteger(buyer.ownershipPpm) ||
        buyer.ownershipPpm <= 0 ||
        buyer.ownershipPpm > 1_000_000,
    ) ||
    terms.buyers.reduce((sum, buyer) => sum + buyer.ownershipPpm, 0) !==
      1_000_000 ||
    Object.values(state.finance.assetsById).some(
      (asset) =>
        asset.kind === "property" && asset.catalogueId === terms.catalogueId,
    )
  )
    return null;
  const property = catalogueProperty(terms.catalogueId, lead);
  if (!property) return null;
  // A transaction's own holds do not reprice its lead's credit strength.
  const unlocked = { ...state, activeTransaction: null };
  const quote = purchaseQuote(
    unlocked,
    lead,
    property,
    terms.principalCents,
    terms.rateKind,
  );
  let annualRateBps: number = quote.annualRateBps;
  let payment: number = quote.quarterlyPaymentCents;
  if (frozen) {
    if (
      !BANK_CREDIT_GRADES.some(
        (grade) =>
          state.economy.baseRateBps +
            grade.spreadBps +
            (terms.rateKind === "fixed"
              ? BANK_LENDING_RULES.fixedPropertyPremiumBps
              : 0) ===
          frozen.annualRateBps,
      )
    )
      return null;
    annualRateBps = frozen.annualRateBps;
    payment = terms.principalCents
      ? calculateAmortizingPayment({
          principalCents: terms.principalCents,
          annualRateBps,
          termQuarters: quote.termQuarters,
        })
      : 0;
  }
  const cashRequiredCents = cents(
    property.marketValueCents - terms.principalCents + quote.feeCents + payment,
  );
  const contributed = terms.buyers.reduce(
    (sum, buyer) => cents(sum + buyer.cashContributionCents),
    0,
  );
  const leadCash = terms.buyers.find(
    (buyer) => buyer.playerId === lead,
  )!.cashContributionCents;
  // Positive integer cross-products use decimal underwriting in the canonical bank quote.
  // Frozen validation preserves only previously accepted structure, not current payer capacity.
  if (
    terms.principalCents > property.marketValueCents ||
    contributed !== cashRequiredCents ||
    (terms.principalCents > 0 &&
      (new FinanceDecimal(terms.principalCents)
        .times(10_000)
        .gt(
          new FinanceDecimal(property.marketValueCents).times(
            quote.maximumLtvBps,
          ),
        ) ||
        new FinanceDecimal(
          calculatePropertyCashFlow(property).netOperatingIncomeCents,
        )
          .times(10_000)
          .lt(new FinanceDecimal(payment).times(quote.minimumDscrBps)) ||
        (!frozen &&
          !propertyLoanQuote(
            unlocked,
            lead,
            property,
            terms.principalCents,
            terms.rateKind,
          ).approved))) ||
    (!frozen &&
      state.finance.cashByPlayer[lead]! - leadCash < quote.personalReserveCents)
  )
    return null;
  return {
    askingPriceCents: property.marketValueCents,
    feeCents: quote.feeCents,
    cashRequiredCents,
    principalCents: terms.principalCents,
    rateKind: terms.rateKind,
    annualRateBps,
    quarterlyPaymentCents: payment,
    assetReserveCents: payment,
    firstDueQuarter:
      state.currentQuarter + BANK_LENDING_RULES.firstPaymentQuarterOffset,
    termQuarters: quote.termQuarters,
  };
}
export function normalizePropertyAcquisitionTerms(
  state: GameState,
  terms: PropertyAcquisitionTerms,
): PropertyAcquisitionTerms {
  return {
    catalogueId: terms.catalogueId,
    principalCents: terms.principalCents,
    rateKind: terms.rateKind,
    buyers: state.playerOrder.flatMap((id) => {
      const buyer = terms.buyers.find((candidate) => candidate.playerId === id);
      return buyer
        ? [
            {
              playerId: id,
              cashContributionCents: buyer.cashContributionCents,
              ownershipPpm: buyer.ownershipPpm,
            },
          ]
        : [];
    }),
  };
}
export function assertPropertyAcquisitionTransaction(
  state: GameState,
  tx: PropertyAcquisitionTransaction,
  active: PlayerId | null,
): void {
  if (
    state.phase !== "ready-for-first-round" ||
    state.round?.stage !== "spotlight" ||
    active !== tx.leadPlayerId ||
    tx.createdQuarter !== state.currentQuarter ||
    !Number.isSafeInteger(tx.termsRevision) ||
    tx.termsRevision < 1 ||
    !Array.isArray(tx.confirmedPlayerIds) ||
    new Set(tx.confirmedPlayerIds).size !== tx.confirmedPlayerIds.length ||
    !tx.confirmedPlayerIds.every((id) =>
      tx.terms.buyers.some(
        (buyer) =>
          buyer.playerId === id &&
          buyer.cashContributionCents <= (state.finance.cashByPlayer[id] ?? 0),
      ),
    )
  )
    throw new Error("Invalid property acquisition transaction");
  const quote = quotePropertyAcquisition(
    state,
    tx.leadPlayerId,
    tx.terms,
    tx.quote,
  );
  if (
    !quote ||
    JSON.stringify(quote) !== JSON.stringify(tx.quote) ||
    JSON.stringify(tx.terms) !==
      JSON.stringify(normalizePropertyAcquisitionTerms(state, tx.terms))
  )
    throw new Error("Invalid property acquisition quote");
}
