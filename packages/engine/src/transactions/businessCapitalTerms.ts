import { OPERATING_RULES } from "@interests/rules";
import {
  asPlayerId,
  type BusinessCapitalTerms,
  type BusinessEquityRequest,
  type BusinessLoanRequest,
  type PlayerId,
} from "@interests/shared";
import {
  type BusinessCapitalConsideration,
  businessStakePurchaseTotalCents,
  type PrimaryContribution,
} from "../finance/businessCapitalAccounting";
import {
  diluteBusinessOwnership,
  transferBusinessStake,
} from "../finance/businessStakes";
import {
  addCents,
  type Cents,
  cents,
  isNonNegativeCents,
} from "../finance/money";
import type { BusinessAsset, GameState } from "../model/gameState";
import {
  assertBusinessEquityOffers,
  isEquitySelection,
} from "./businessEquityOffers";
import { assertBusinessLoanOffers } from "./businessLoanOffers";
import type { BusinessCapitalTransaction } from "./model";

type BusinessCapitalPlan = {
  readonly participants: readonly PlayerId[];
  readonly cashContributions: ReadonlyMap<PlayerId, Cents>;
  readonly terms: BusinessCapitalTerms;
  readonly ready: boolean;
  readonly action:
    | (BusinessCapitalConsideration & {
        readonly loanRequests?: readonly BusinessLoanRequest[];
      })
    | { readonly kind: "company-expansion"; readonly investmentCents: number };
};

export function planBusinessCapital(
  state: GameState,
  asset: BusinessAsset,
  tx: Pick<
    BusinessCapitalTransaction,
    | "terms"
    | "initiatorPlayerId"
    | "selectedLoans"
    | "equityOffers"
    | "selectedEquity"
  >,
): BusinessCapitalPlan | null {
  const { terms, initiatorPlayerId } = tx;
  if (!terms || typeof terms !== "object") return null;
  const participants = new Set<PlayerId>();
  const cashContributions = new Map<PlayerId, Cents>();
  const includeOwners = () => {
    for (const playerId of state.playerOrder)
      if (asset.ownershipByPlayerPpm[playerId]) participants.add(playerId);
  };
  let action: BusinessCapitalPlan["action"];
  let canonicalTerms: BusinessCapitalTerms | undefined;
  let ready = true;
  try {
    switch (terms.kind) {
      case "company-expansion": {
        const ratio = OPERATING_RULES.businessGrowthCostPerAnnualProfitUnit;
        if (
          !asset.ownershipByPlayerPpm[initiatorPlayerId] ||
          !isNonNegativeCents(terms.investmentCents) ||
          !terms.investmentCents ||
          terms.investmentCents % ratio !== 0 ||
          terms.investmentCents > asset.cashCents ||
          asset.pendingAnnualProfitIncreaseCents !== undefined ||
          !Number.isSafeInteger(
            asset.annualOperatingProfitCents + terms.investmentCents / ratio,
          )
        )
          return null;
        includeOwners();
        action = { kind: terms.kind, investmentCents: terms.investmentCents };
        break;
      }
      case "secondary-stake-sale": {
        if (
          typeof terms.sellerPlayerId !== "string" ||
          typeof terms.buyerPlayerId !== "string"
        )
          return null;
        const seller = asPlayerId(terms.sellerPlayerId);
        const buyer = asPlayerId(terms.buyerPlayerId);
        if (
          !Object.hasOwn(state.players, seller) ||
          !Object.hasOwn(state.players, buyer) ||
          !isNonNegativeCents(terms.priceCents) ||
          !terms.priceCents ||
          (initiatorPlayerId !== seller && initiatorPlayerId !== buyer) ||
          (asset.workCompensation?.playerId === seller &&
            asset.ownershipByPlayerPpm[seller] === terms.ownershipPpm)
        )
          return null;
        transferBusinessStake(
          asset.ownershipByPlayerPpm,
          seller,
          buyer,
          terms.ownershipPpm,
        );
        if (
          terms.ownershipPpm === 1_000_000 &&
          (asset.operatingArrearsCents > 0 ||
            (asset.debtPrincipalCents ?? 0) > 0 ||
            Object.values(state.finance.loansById).some(
              (loan) =>
                (loan.kind === "company-loan" ||
                  loan.kind === "asset-bank-loan") &&
                loan.borrowerAssetId === asset.id &&
                (loan.outstandingPrincipalCents || loan.unpaidInterestCents),
            ))
        )
          return null;
        participants.add(seller);
        participants.add(buyer);
        const upfront = businessStakePurchaseTotalCents(terms.priceCents);
        let totalPrincipal = 0;
        let loanRequests: BusinessLoanRequest[] | undefined;
        if (terms.loanRequests !== undefined) {
          if (
            !Array.isArray(terms.loanRequests) ||
            !terms.loanRequests.length ||
            terms.loanRequests.length > 4
          )
            return null;
          loanRequests = [];
          for (const request of terms.loanRequests) {
            if (
              !request ||
              !isNonNegativeCents(request.principalCents) ||
              !request.principalCents ||
              request.principalCents > upfront - totalPrincipal
            )
              return null;
            const lenderId = request.invitedLenderId;
            if (
              lenderId !== undefined &&
              (typeof lenderId !== "string" ||
                !Object.hasOwn(state.players, lenderId) ||
                lenderId === buyer ||
                lenderId === seller)
            )
              return null;
            loanRequests.push({
              principalCents: request.principalCents,
              ...(lenderId === undefined ? {} : { invitedLenderId: lenderId }),
            });
            totalPrincipal += request.principalCents;
          }
        }
        cashContributions.set(buyer, cents(upfront - totalPrincipal));
        for (const choice of tx.selectedLoans ?? [])
          participants.add(choice.lenderPlayerId);
        ready = (tx.selectedLoans ?? []).length === (loanRequests?.length ?? 0);
        action = {
          kind: terms.kind,
          sellerPlayerId: seller,
          buyerPlayerId: buyer,
          ownershipPpm: terms.ownershipPpm,
          priceCents: terms.priceCents,
          ...(loanRequests ? { loanRequests } : {}),
        };
        break;
      }
      case "request-equity": {
        if (
          !asset.ownershipByPlayerPpm[initiatorPlayerId] ||
          !Array.isArray(terms.requests) ||
          !terms.requests.length ||
          terms.requests.length > 4
        )
          return null;
        includeOwners();
        const requests: BusinessEquityRequest[] = [];
        let closingCashCents = asset.cashCents;
        for (const request of terms.requests) {
          if (
            !request ||
            !isNonNegativeCents(request.amountCents) ||
            !request.amountCents
          )
            return null;
          const invited = request.invitedInvestorId;
          if (
            invited !== undefined &&
            (typeof invited !== "string" ||
              invited === initiatorPlayerId ||
              !Object.hasOwn(state.players, invited))
          )
            return null;
          requests.push({
            amountCents: request.amountCents,
            ...(invited === undefined ? {} : { invitedInvestorId: invited }),
          });
          closingCashCents = addCents(closingCashCents, request.amountCents);
        }
        const selected = new Map<PlayerId, PrimaryContribution>();
        for (const offer of tx.equityOffers ?? []) {
          if (!isEquitySelection(tx, offer)) continue;
          const request = requests[offer.slot];
          if (!request) return null;
          const prior = selected.get(offer.investorPlayerId);
          selected.set(offer.investorPlayerId, {
            playerId: offer.investorPlayerId,
            amountCents: addCents(
              cents(prior?.amountCents ?? 0),
              cents(request.amountCents),
            ),
            postMoneyOwnershipPpm:
              (prior?.postMoneyOwnershipPpm ?? 0) + offer.postMoneyOwnershipPpm,
          });
          participants.add(offer.investorPlayerId);
        }
        if (selected.size)
          diluteBusinessOwnership(
            asset.ownershipByPlayerPpm,
            Object.fromEntries(
              [...selected.values()].map((item) => [
                item.playerId,
                item.postMoneyOwnershipPpm,
              ]),
            ),
          );
        // Equity cash is already reserved by each offer, including the selected ones.
        action = {
          kind: "primary-issuance",
          contributions: [...selected.values()],
        };
        canonicalTerms = { kind: terms.kind, requests };
        ready = (tx.selectedEquity ?? []).length === requests.length;
        break;
      }
      case "primary-issuance": {
        if (
          !asset.ownershipByPlayerPpm[initiatorPlayerId] ||
          !Array.isArray(terms.contributions) ||
          !terms.contributions.length ||
          terms.contributions.length > state.playerOrder.length
        )
          return null;
        includeOwners();
        const contributions: Extract<
          BusinessCapitalConsideration,
          { kind: "primary-issuance" }
        >["contributions"][number][] = [];
        for (const contribution of terms.contributions) {
          if (
            !contribution ||
            typeof contribution.playerId !== "string" ||
            !isNonNegativeCents(contribution.amountCents) ||
            !contribution.amountCents
          )
            return null;
          const investor = asPlayerId(contribution.playerId);
          if (
            !Object.hasOwn(state.players, investor) ||
            cashContributions.has(investor)
          )
            return null;
          participants.add(investor);
          cashContributions.set(investor, contribution.amountCents);
          contributions.push({
            playerId: investor,
            amountCents: contribution.amountCents,
            postMoneyOwnershipPpm: contribution.postMoneyOwnershipPpm,
          });
        }
        diluteBusinessOwnership(
          asset.ownershipByPlayerPpm,
          Object.fromEntries(
            contributions.map((item) => [
              item.playerId,
              item.postMoneyOwnershipPpm,
            ]),
          ),
        );
        action = { kind: terms.kind, contributions };
        break;
      }
      default:
        return null;
    }
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) return null;
    throw error;
  }
  return {
    participants: state.playerOrder.filter((id) => participants.has(id)),
    cashContributions,
    terms: canonicalTerms ?? action,
    ready,
    action,
  };
}

export function assertBusinessCapitalTransaction(
  state: GameState,
  tx: BusinessCapitalTransaction,
  activePlayerId: PlayerId | null,
): void {
  const asset = state.finance.assetsById[tx.assetId];
  const plan =
    asset?.kind === "business" ? planBusinessCapital(state, asset, tx) : null;
  if (
    !plan ||
    state.phase !== "ready-for-first-round" ||
    state.round?.stage !== "spotlight" ||
    tx.initiatorPlayerId !== activePlayerId ||
    tx.createdQuarter !== state.currentQuarter ||
    !Number.isSafeInteger(tx.termsRevision) ||
    tx.termsRevision < 1 ||
    !Array.isArray(tx.confirmedPlayerIds) ||
    (tx.confirmedPlayerIds.length > 0 && !plan.ready) ||
    new Set(tx.confirmedPlayerIds).size !== tx.confirmedPlayerIds.length ||
    !tx.confirmedPlayerIds.every(
      (id) =>
        plan.participants.includes(id) &&
        (state.finance.cashByPlayer[id] ?? 0) >=
          (plan.cashContributions.get(id) ?? 0),
    )
  ) {
    throw new Error("Invalid active business capital transaction");
  }
  assertBusinessLoanOffers(state, tx);
  assertBusinessEquityOffers(state, tx);
}
