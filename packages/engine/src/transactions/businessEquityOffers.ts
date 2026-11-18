import type {
  BusinessEquityOfferView,
  BusinessEquityRequest,
  PlayerId,
} from "@interests/shared";
import { addCents, type Cents, cents } from "../finance/money";
import { TOTAL_OWNERSHIP_PPM } from "../finance/ownership";
import type { GameState } from "../model/gameState";
import type { BusinessCapitalTransaction, BusinessEquityOffer } from "./model";

export type EquitySelections = Pick<
  BusinessCapitalTransaction,
  "terms" | "initiatorPlayerId" | "equityOffers" | "selectedEquity"
>;

export function equityRequests(
  tx: Pick<BusinessCapitalTransaction, "terms">,
): readonly BusinessEquityRequest[] {
  return tx.terms.kind === "request-equity" ? tx.terms.requests : [];
}

export function canOfferBusinessEquity(
  tx: EquitySelections,
  investor: PlayerId,
  slot: number,
): boolean {
  const request = equityRequests(tx)[slot];
  return (
    !!request &&
    investor !== tx.initiatorPlayerId &&
    (request.invitedInvestorId === undefined ||
      request.invitedInvestorId === investor)
  );
}

export function isEquitySelection(
  tx: EquitySelections,
  offer: BusinessEquityOffer,
): boolean {
  return (
    tx.selectedEquity?.some(
      (choice) =>
        choice.slot === offer.slot &&
        choice.investorPlayerId === offer.investorPlayerId,
    ) ?? false
  );
}

export function reservedBusinessEquityCash(
  tx: EquitySelections,
  investor: PlayerId,
): Cents {
  const requests = equityRequests(tx);
  let amount = cents(0);
  for (const offer of tx.equityOffers ?? []) {
    const request = requests[offer.slot];
    if (offer.investorPlayerId === investor && request)
      amount = addCents(amount, cents(request.amountCents));
  }
  return amount;
}

export function validEquityOffer(
  tx: EquitySelections,
  offer: BusinessEquityOffer,
): boolean {
  return (
    Number.isInteger(offer.slot) &&
    offer.slot >= 0 &&
    Number.isInteger(offer.postMoneyOwnershipPpm) &&
    offer.postMoneyOwnershipPpm > 0 &&
    offer.postMoneyOwnershipPpm < TOTAL_OWNERSHIP_PPM &&
    canOfferBusinessEquity(tx, offer.investorPlayerId, offer.slot)
  );
}

export function assertBusinessEquityOffers(
  state: GameState,
  tx: BusinessCapitalTransaction,
): void {
  if (
    (tx.equityOffers !== undefined && !Array.isArray(tx.equityOffers)) ||
    (tx.selectedEquity !== undefined && !Array.isArray(tx.selectedEquity))
  )
    throw new Error("Invalid business equity lists");
  const offers = new Set<string>();
  for (const offer of tx.equityOffers ?? []) {
    const key = JSON.stringify([offer.slot, offer.investorPlayerId]);
    if (
      !Object.hasOwn(state.players, offer.investorPlayerId) ||
      offers.has(key) ||
      !validEquityOffer(tx, offer)
    )
      throw new Error("Invalid business equity offer");
    offers.add(key);
  }
  const selectedSlots = new Set<number>();
  for (const choice of tx.selectedEquity ?? []) {
    if (
      selectedSlots.has(choice.slot) ||
      !offers.has(JSON.stringify([choice.slot, choice.investorPlayerId]))
    )
      throw new Error("Invalid business equity selection");
    selectedSlots.add(choice.slot);
  }
  for (const investor of state.playerOrder)
    if (
      reservedBusinessEquityCash(tx, investor) >
      (state.finance.cashByPlayer[investor] ?? 0)
    )
      throw new Error("Business equity offers exceed available cash");
}

/** Only the issuer sees competing terms; other owners can inspect the selected terms. */
export function businessEquityOfferViews(
  tx: EquitySelections,
  viewer: PlayerId,
  isCurrentOwner: boolean,
): readonly BusinessEquityOfferView[] {
  return (tx.equityOffers ?? []).flatMap((offer) => {
    const selected = isEquitySelection(tx, offer);
    return viewer === tx.initiatorPlayerId ||
      viewer === offer.investorPlayerId ||
      (selected && isCurrentOwner)
      ? [
          {
            investorPlayerId: offer.investorPlayerId,
            slot: offer.slot,
            postMoneyOwnershipPpm: offer.postMoneyOwnershipPpm,
            selected,
          },
        ]
      : [];
  });
}
