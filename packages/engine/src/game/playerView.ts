import {
  BUSINESS_CASH_POLICIES,
  OBJECTIVE_COMMON_INSTRUCTIONS,
  OBJECTIVE_INSTRUCTIONS,
  OBJECTIVE_INSTRUCTIONS_VERSION,
  OBJECTIVE_TARGETS,
  PUBLIC_MARKET_INSTRUMENT_IDS,
  PUBLIC_MARKET_INSTRUMENTS,
  PUBLIC_MARKET_TRADE_FEE_BPS,
} from "@interests/rules";
import type {
  BusinessAuctionView,
  BusinessCapitalView,
  BusinessEquityInvitationView,
  BusinessLoanInvitationView,
  JointPropertyView,
  MatchId,
  MatchResultView,
  MatchSelfFinancialDetailsView,
  PlayerId,
  PropertyAcquisitionView,
  PropertyManagementView,
  PropertyOfferView,
  SelfSettlementView,
  TransactionId,
} from "@interests/shared";
import { calculatePlayerLoanSchedule } from "../finance/amortization";
import { isAssetBorrower } from "../finance/bank";
import { calculateBusinessEquity } from "../finance/business";
import { planBusinessSettlement } from "../finance/businessSettlement";
import { isLenderLoan, isPersonalBorrower } from "../finance/loanParties";
import { calculateLoanObligation } from "../finance/obligations";
import { calculatePropertyCashFlow } from "../finance/property";
import { propertyManagement, propertyOffers } from "../finance/propertyActions";
import type { GameState } from "../model/gameState.js";
import { projectBusinessAuction } from "../transactions/businessAuctionTerms";
import { planBusinessCapital } from "../transactions/businessCapitalTerms";
import {
  businessEquityOfferViews,
  canOfferBusinessEquity,
  equityRequests,
} from "../transactions/businessEquityOffers";
import {
  businessLoanOfferViews,
  canOfferBusinessLoan,
  loanRequests,
} from "../transactions/businessLoanOffers";
import {
  jointPropertyCashRequired,
  jointPropertyParticipants,
} from "../transactions/jointPropertyTerms";
import {
  getAvailableCashCents,
  getReservedCashCents,
} from "../transactions/reservations.js";
import { currentAnnualLaborCompensation, getCareerOffers } from "./career";
import { getActiveSpotlightPlayerId, getSpotlightOrder } from "./round.js";

export interface PurePlayerSummary {
  readonly playerId: PlayerId;
  readonly hasSelectedObjective: boolean;
}

export interface PureOpportunityDiligenceView {
  readonly annualRevenueCents: number;
  readonly annualOperatingProfitCents: number;
  readonly enterpriseValueCents: number;
  readonly debtPrincipalCents: number;
}

export interface PureOpportunityView {
  readonly id: string;
  readonly kind: "private-business-purchase";
  readonly askingPriceCents: number;
  readonly sellerPlayerId: PlayerId;
  readonly status: "available" | "pursued";
  readonly investigated: boolean;
  readonly facts?: PureOpportunityDiligenceView;
}

export interface PureBusinessAssetView {
  readonly companyCashCents: number;
  readonly operatingArrearsCents: number;
  readonly equityValueCents: number;
  readonly expectedPayoutCents: number | null;
  readonly payoutQuarter: number | null;
  readonly incomeTreatment: "work-and-ownership" | "business-distribution";
  readonly expectedWorkPayCents: number | null;
  readonly workCompensationArrearsCents: number;
  readonly annualManagementCostCents: number;
  readonly id: string;
  readonly kind: "business";
  readonly annualRevenueCents: number;
  readonly annualOperatingProfitCents: number;
  readonly enterpriseValueCents: number;
  readonly debtPrincipalCents: number;
  readonly ownershipPpm: number;
}

export interface PureLoanView {
  readonly amountDueCents: number;
  readonly pastDuePrincipalCents: number;
  readonly unpaidInterestCents: number;
  readonly status: "current" | "in-arrears" | "repaid";
  readonly id: string;
  readonly kind: string;
  readonly role: "borrower" | "lender" | "company-borrower" | "asset-borrower";
  readonly counterpartyPlayerId: PlayerId | "bank" | null;
  readonly npcBorrowerName?: string;
  readonly originalPrincipalCents: number;
  readonly outstandingPrincipalCents: number;
  readonly annualRateBps: number;
  readonly termQuarters?: number;
  readonly scheduledQuarterlyPaymentCents?: number;
}

export interface PureSelfView {
  readonly propertyOffers: readonly PropertyOfferView[];
  readonly propertyManagement: readonly PropertyManagementView[];
  readonly financialDetails: MatchSelfFinancialDetailsView;
  readonly livingExpenseArrearsCents: number;
  readonly lastSettlement: SelfSettlementView | null;
  readonly playerId: PlayerId;
  readonly profileId: string;
  readonly offeredObjectiveIds: readonly [string, string];
  readonly selectedObjectiveId: string | null;
  readonly cashCents: number;
  readonly reservedCashCents: number;
  readonly availableCashCents: number;
  readonly opportunity: PureOpportunityView | null;
  readonly ownedAssets: readonly PureBusinessAssetView[];
  readonly loans: readonly PureLoanView[];
}

export interface PureActiveTransactionOffer {
  readonly lenderPlayerId: PlayerId;
  readonly principalCents: number;
  readonly annualRateBps: number;
  readonly termQuarters: number;
  readonly termsRevision: number;
  readonly status: "offered" | "accepted";
}

export interface PureActiveTransactionSummary {
  readonly transactionId: TransactionId;
  readonly kind: string;
  readonly role:
    | "buyer"
    | "seller"
    | "lender-candidate"
    | "lender"
    | "uninvolved";
  readonly buyerPlayerId: PlayerId;
  readonly sellerPlayerId: PlayerId;
  readonly purchasePriceCents: number;
  readonly isFinanced: boolean;
  readonly requestedPrincipalCents?: number;
  readonly buyerContributionCents?: number;
  readonly financingStatus?:
    | "waiting-for-offer"
    | "offer-submitted"
    | "offer-accepted";
  readonly offer?: PureActiveTransactionOffer | null;
  readonly hasExistingOffer?: boolean;
}

export interface PureRoundView {
  readonly stage: "round-start" | "spotlight";
  readonly spotlightOrder: readonly PlayerId[];
  readonly activeSpotlightPlayerId: PlayerId | null;
  readonly spotlightsCompleted: number;
}

export interface PurePlayerProjection {
  readonly hasActiveTransaction: boolean;
  readonly jointProperty: JointPropertyView | null;
  readonly propertyAcquisition: PropertyAcquisitionView | null;
  readonly result: MatchResultView | null;
  readonly matchId: MatchId;
  readonly modeId: string;
  readonly revision: number;
  readonly phase: string;
  readonly currentQuarter: number;
  readonly round: PureRoundView | null;
  readonly players: readonly PurePlayerSummary[];
  readonly self: PureSelfView;
  readonly activeTransaction: PureActiveTransactionSummary | null;
  readonly businessCapital: BusinessCapitalView | null;
  readonly businessLoanInvitation: BusinessLoanInvitationView | null;
  readonly businessEquityInvitation: BusinessEquityInvitationView | null;
  readonly businessAuction: BusinessAuctionView | null;
}

/**
 * Pure GameState privacy projection for a specific player.
 *
 * Produces an allowlisted, recipient-specific view of the game state.
 * Never includes:
 * - other players' offered or selected objectives
 * - other players' exact cash balances, private finances, or reservations
 * - random state or private seeds
 * - deterministic counters
 * - other players' private opportunities
 * - unrevealed due-diligence facts before investigation
 */
export function projectPlayerGameState(
  state: GameState,
  playerId: PlayerId,
): PurePlayerProjection {
  const selfPlayer = state.players[playerId];
  if (!selfPlayer) {
    throw new Error(`Player ${playerId} not found in game state`);
  }

  const players: PurePlayerSummary[] = state.playerOrder.map((pId) => {
    const p = state.players[pId];
    return {
      playerId: pId,
      hasSelectedObjective: p ? p.selectedObjectiveId !== null : false,
    };
  });

  // Self finances
  const actualCash = state.finance.cashByPlayer[playerId] ?? 0;
  const reservedCash = getReservedCashCents(state, playerId);
  const availableCash = getAvailableCashCents(state, playerId);

  // Private opportunity for self (visible only after objective selection: ready-for-first-round)
  let opportunityView: PureOpportunityView | null = null;
  if (state.phase === "ready-for-first-round") {
    for (const opp of Object.values(state.opportunitiesById)) {
      if (opp.targetPlayerId === playerId && opp.access === "private") {
        opportunityView = {
          id: opp.id,
          kind: opp.kind,
          askingPriceCents: opp.askingPriceCents,
          sellerPlayerId: opp.sellerPlayerId,
          status: opp.status,
          investigated: opp.investigation.investigated,
          ...(opp.investigation.investigated
            ? {
                facts: {
                  annualRevenueCents:
                    opp.investigation.facts.annualRevenueCents,
                  annualOperatingProfitCents:
                    opp.investigation.facts.annualOperatingProfitCents,
                  enterpriseValueCents:
                    opp.investigation.facts.enterpriseValueCents,
                  debtPrincipalCents:
                    opp.investigation.facts.debtPrincipalCents,
                },
              }
            : {}),
        };
        break;
      }
    }
  }

  // Self owned business assets
  const ownedAssets: PureBusinessAssetView[] = [];
  for (const asset of Object.values(state.finance.assetsById)) {
    if (asset.kind === "business") {
      const ownership = asset.ownershipByPlayerPpm[playerId];
      if (ownership !== undefined && ownership > 0) {
        const firstOperatingQuarter =
          BUSINESS_CASH_POLICIES[asset.cashPolicyId].firstOperatingQuarter;
        const equity = calculateBusinessEquity(asset, state.finance.loansById);
        const opening =
          state.finance.quarterStartBasis.businessesById[asset.id];
        const eligibleNow =
          opening &&
          (opening.ownershipByPlayerPpm[playerId] ?? 0) > 0 &&
          state.currentQuarter >= firstOperatingQuarter;
        const payoutQuarter = eligibleNow
          ? state.currentQuarter
          : Math.max(state.currentQuarter + 1, firstOperatingQuarter);
        let expectedWorkPayCents: number | null = 0;
        let expectedPayoutCents: number | null = 0;
        if (payoutQuarter !== null) {
          try {
            const forecast = planBusinessSettlement(
              asset,
              eligibleNow
                ? opening
                : {
                    cashPolicyId: asset.cashPolicyId,
                    ...(asset.annualManagementCostCents !== undefined
                      ? {
                          annualManagementCostCents:
                            asset.annualManagementCostCents,
                        }
                      : {}),
                    ...(asset.workCompensation
                      ? {
                          workCompensation: {
                            playerId: asset.workCompensation.playerId,
                            annualCompensationCents:
                              asset.workCompensation.annualCompensationCents,
                          },
                        }
                      : {}),
                    annualOperatingProfitCents:
                      asset.annualOperatingProfitCents,
                    ownershipByPlayerPpm: asset.ownershipByPlayerPpm,
                  },
              payoutQuarter,
              state.finance.loansById,
            );
            expectedWorkPayCents = forecast?.outcome.workCompensation
              ? forecast.outcome.workCompensation.currentPaidCents +
                forecast.outcome.workCompensation.arrearsPaidCents
              : 0;
            expectedPayoutCents =
              forecast?.outcome.distributionsByPlayer[playerId] ?? 0;
          } catch (error) {
            if (!(error instanceof RangeError)) throw error;
            expectedPayoutCents = null;
            expectedWorkPayCents = null;
          }
        }
        ownedAssets.push({
          annualManagementCostCents: asset.annualManagementCostCents ?? 0,
          companyCashCents: asset.cashCents,
          operatingArrearsCents: asset.operatingArrearsCents,
          equityValueCents: equity.equityValueCents,
          incomeTreatment:
            asset.workCompensation &&
            (asset.workCompensation.annualCompensationCents > 0 ||
              (eligibleNow &&
                (opening.workCompensation?.annualCompensationCents ?? 0) > 0))
              ? "work-and-ownership"
              : "business-distribution",
          expectedWorkPayCents,
          workCompensationArrearsCents:
            asset.workCompensation?.arrearsCents ?? 0,
          payoutQuarter,
          expectedPayoutCents,
          id: asset.id,
          kind: "business",
          annualRevenueCents: asset.annualRevenueCents,
          annualOperatingProfitCents: asset.annualOperatingProfitCents,
          enterpriseValueCents: asset.enterpriseValueCents,
          debtPrincipalCents: equity.debtPrincipalCents,
          ownershipPpm: ownership,
        });
      }
    }
  }

  const selfLoans: PureLoanView[] = [];
  for (const loan of Object.values(state.finance.loansById).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    const company =
      isAssetBorrower(loan) &&
      (state.finance.assetsById[loan.borrowerAssetId]?.ownershipByPlayerPpm[
        playerId
      ] ?? 0) > 0;
    const borrower =
      isPersonalBorrower(loan) && loan.borrowerPlayerId === playerId;
    const lender = isLenderLoan(loan) && loan.lenderPlayerId === playerId;
    if (!borrower && !lender && !company) continue;
    const repaid =
      loan.outstandingPrincipalCents === 0 && loan.unpaidInterestCents === 0;
    selfLoans.push({
      id: loan.id,
      kind: loan.kind,
      role: company
        ? loan.kind === "asset-bank-loan"
          ? "asset-borrower"
          : "company-borrower"
        : borrower
          ? "borrower"
          : "lender",
      counterpartyPlayerId:
        loan.kind === "player-loan"
          ? borrower
            ? loan.lenderPlayerId
            : loan.borrowerPlayerId
          : loan.kind === "npc-loan"
            ? null
            : "bank",
      ...(loan.kind === "npc-loan"
        ? { npcBorrowerName: loan.borrowerName }
        : {}),
      originalPrincipalCents: loan.originalPrincipalCents,
      outstandingPrincipalCents: loan.outstandingPrincipalCents,
      annualRateBps: loan.annualRateBps,
      ...(isLenderLoan(loan)
        ? {
            termQuarters: loan.termQuarters,
            scheduledQuarterlyPaymentCents: calculatePlayerLoanSchedule({
              principalCents: loan.originalPrincipalCents,
              annualRateBps: loan.annualRateBps,
              termQuarters: loan.termQuarters,
            })[0]?.paymentCents,
          }
        : {
            scheduledQuarterlyPaymentCents: loan.scheduledQuarterlyPaymentCents,
            ...(loan.kind === "company-loan"
              ? { termQuarters: loan.termQuarters }
              : {}),
          }),
      amountDueCents:
        calculateLoanObligation(loan, state.currentQuarter)?.amountDueCents ??
        0,
      pastDuePrincipalCents: loan.pastDuePrincipalCents,
      unpaidInterestCents: loan.unpaidInterestCents,
      status: repaid
        ? "repaid"
        : loan.pastDuePrincipalCents > 0 || loan.unpaidInterestCents > 0
          ? "in-arrears"
          : "current",
    });
  }
  const latest = state.finance.lastSettlement;
  const living = latest?.livingByPlayer[playerId];
  const lastSettlement: SelfSettlementView | null =
    latest && living
      ? {
          quarter: latest.quarter,
          workCompensation: latest.businesses
            .filter((b) => b.workCompensation?.playerId === playerId)
            .map((b) => ({
              assetId: b.assetId,
              dueCents:
                b.workCompensation!.currentDueCents +
                b.workCompensation!.arrearsDueCents,
              paidCents:
                b.workCompensation!.currentPaidCents +
                b.workCompensation!.arrearsPaidCents,
              unpaidCents: b.workCompensation!.closingArrearsCents,
            })),
          businessDistributions: latest.businesses
            .filter((b) => Object.hasOwn(b.distributionsByPlayer, playerId))
            .map((b) => ({
              assetId: b.assetId,
              amountCents: b.distributionsByPlayer[playerId] ?? 0,
            })),
          livingDueCents: living.currentDueCents + living.arrearsDueCents,
          livingPaidCents: living.currentPaidCents + living.arrearsPaidCents,
          livingArrearsCents: living.closingArrearsCents,
          loanPayments: latest.loanPayments
            .filter(
              (p) =>
                p.borrowerPlayerId === playerId ||
                p.lenderPlayerId === playerId ||
                (p.borrowerAssetId !== undefined &&
                  (state.finance.assetsById[p.borrowerAssetId]
                    ?.ownershipByPlayerPpm[playerId] ?? 0) > 0),
            )
            .map((p) => ({
              loanId: p.loanId,
              role: p.borrowerAssetId
                ? state.finance.loansById[p.loanId]?.kind === "asset-bank-loan"
                  ? "asset-borrower"
                  : "company-borrower"
                : p.borrowerPlayerId === playerId
                  ? "borrower"
                  : "lender",
              dueCents: p.dueCents,
              paidCents: p.paidCents,
              principalPaidCents: p.principalPaidCents,
              interestPaidCents: p.interestPaidCents,
              unpaidCents:
                p.closingPastDuePrincipalCents + p.closingUnpaidInterestCents,
            })),
        }
      : null;

  const progress = state.progress.byPlayer[playerId]!;
  const currentRecurring = state.finance.recurringByPlayer[playerId]!;
  const entitledRecurring =
    state.finance.quarterStartBasis.recurringByPlayer[playerId]!;
  let offers: PropertyOfferView[] = [];
  let management: PropertyManagementView[] = [];
  try {
    offers =
      state.phase === "ready-for-first-round"
        ? propertyOffers(state, playerId)
        : [];
    management = propertyManagement(state, playerId);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  const self: PureSelfView = {
    propertyOffers: offers,
    propertyManagement: management,
    financialDetails: {
      formerWorkClaims: Object.values(state.finance.assetsById).flatMap(
        (asset) =>
          asset.kind === "business" &&
          !asset.ownershipByPlayerPpm[playerId] &&
          asset.workCompensation?.playerId === playerId &&
          asset.workCompensation.arrearsCents > 0
            ? [
                {
                  assetId: asset.id,
                  amountCents: asset.workCompensation.arrearsCents,
                },
              ]
            : [],
      ),
      careerOffers: getCareerOffers(state, playerId),
      annualLaborCompensationCents: currentAnnualLaborCompensation(
        state,
        playerId,
      ),
      quarterlyIncomeCents: currentRecurring.quarterlyIncomeCents,
      quarterlyLivingExpenseCents: currentRecurring.quarterlyLivingExpenseCents,
      entitledQuarterlyIncomeCents: entitledRecurring.quarterlyIncomeCents,
      entitledQuarterlyLivingExpenseCents:
        entitledRecurring.quarterlyLivingExpenseCents,
      labor:
        progress.labor.kind === "owner-work"
          ? { kind: "owner-work", assetId: progress.labor.assetId }
          : progress.labor.kind === "employment"
            ? {
                kind: "employment",
                role: progress.labor.role,
                ...(progress.labor.ownershipPositionAssetId
                  ? {
                      ownershipPositionAssetId:
                        progress.labor.ownershipPositionAssetId,
                    }
                  : {}),
              }
            : { kind: "not-working" },
      focus: progress.focus,
      completedObservationQuarters: progress.quarters.length,
      publicMarkets: PUBLIC_MARKET_INSTRUMENT_IDS.map((id) => ({
        id,
        valueCents: state.finance.publicMarketsByPlayer[playerId]![id],
        basisCents: progress.publicMarketBasis[id],
        name: PUBLIC_MARKET_INSTRUMENTS[id].name,
        annualDividendYieldBps:
          PUBLIC_MARKET_INSTRUMENTS[id].annualDividendYieldBps,
        tradeFeeBps: PUBLIC_MARKET_TRADE_FEE_BPS,
      })),
      properties: Object.values(state.finance.assetsById)
        .filter(
          (asset) =>
            asset.kind === "property" &&
            (asset.ownershipByPlayerPpm[playerId] ?? 0) > 0,
        )
        .map((asset) => {
          if (asset.kind !== "property") throw new Error("Expected property");
          return {
            id: asset.id,
            ownershipPpm: asset.ownershipByPlayerPpm[playerId]!,
            marketValueCents: asset.marketValueCents,
            scheduledQuarterlyRentCents: asset.scheduledQuarterlyRentCents,
            occupancyBps: asset.occupancyBps,
            quarterlyNoiCents:
              calculatePropertyCashFlow(asset).netOperatingIncomeCents,
          };
        }),
      objectiveRequirements: selfPlayer.offeredObjectiveIds.map(
        (objectiveId) => ({
          objectiveId,
          instructionsVersion: OBJECTIVE_INSTRUCTIONS_VERSION,
          instructions: [
            ...OBJECTIVE_INSTRUCTIONS[objectiveId],
            ...OBJECTIVE_COMMON_INSTRUCTIONS,
          ],
          targets: { ...OBJECTIVE_TARGETS[objectiveId] },
        }),
      ),
    },
    livingExpenseArrearsCents:
      state.finance.livingArrearsByPlayer[playerId] ?? 0,
    lastSettlement,
    playerId,
    profileId: selfPlayer.profileId,
    offeredObjectiveIds: selfPlayer.offeredObjectiveIds,
    selectedObjectiveId: selfPlayer.selectedObjectiveId,
    cashCents: actualCash,
    reservedCashCents: reservedCash,
    availableCashCents: availableCash,
    opportunity: opportunityView,
    ownedAssets,
    loans: selfLoans,
  };

  // Role-aware active transaction projection
  let activeTransaction: PureActiveTransactionSummary | null = null;
  if (state.activeTransaction?.kind === "cash-business-purchase") {
    const tx = state.activeTransaction;
    const isFinanced = Boolean(tx.playerLoanFinancing);
    const financing = tx.playerLoanFinancing;
    const offer = financing?.offer ?? null;

    let role: PureActiveTransactionSummary["role"] = "uninvolved";
    if (playerId === tx.buyerPlayerId) {
      role = "buyer";
    } else if (playerId === tx.sellerPlayerId) {
      role = "seller";
    } else if (isFinanced) {
      if (offer?.lenderPlayerId === playerId) {
        role = "lender";
      } else if (offer === null) {
        role = "lender-candidate";
      } else {
        role = "uninvolved";
      }
    }

    const financingStatus: PureActiveTransactionSummary["financingStatus"] =
      isFinanced
        ? offer === null
          ? "waiting-for-offer"
          : offer.status === "offered"
            ? "offer-submitted"
            : "offer-accepted"
        : undefined;

    const offerView: PureActiveTransactionOffer | null =
      (role === "buyer" || role === "lender") && offer !== null
        ? {
            lenderPlayerId: offer.lenderPlayerId,
            principalCents: offer.principalCents,
            annualRateBps: offer.annualRateBps,
            termQuarters: offer.termQuarters,
            termsRevision: offer.termsRevision,
            status: offer.status,
          }
        : null;

    activeTransaction = {
      transactionId: tx.id,
      kind: tx.kind,
      role,
      buyerPlayerId: tx.buyerPlayerId,
      sellerPlayerId: tx.sellerPlayerId,
      purchasePriceCents: tx.purchasePriceCents,
      isFinanced,
      ...(role === "buyer"
        ? {
            buyerContributionCents: tx.reservation.amountCents,
            requestedPrincipalCents: financing?.requestedPrincipalCents,
            financingStatus,
            offer: offerView,
          }
        : {}),
      ...(role === "seller"
        ? {
            financingStatus,
          }
        : {}),
      ...(role === "lender"
        ? {
            requestedPrincipalCents: financing?.requestedPrincipalCents,
            financingStatus,
            offer: offerView,
          }
        : {}),
      ...(role === "lender-candidate"
        ? {
            requestedPrincipalCents: financing?.requestedPrincipalCents,
            financingStatus,
            hasExistingOffer: offer !== null,
          }
        : {}),
      ...(role === "uninvolved"
        ? {
            financingStatus,
          }
        : {}),
    };
  }

  const round: PureRoundView | null =
    state.round !== null
      ? {
          stage: state.round.stage,
          spotlightOrder: getSpotlightOrder(state),
          activeSpotlightPlayerId: getActiveSpotlightPlayerId(state),
          spotlightsCompleted: state.round.spotlightsCompleted,
        }
      : null;

  let propertyAcquisition: PropertyAcquisitionView | null = null;
  const acquisition = state.activeTransaction;
  if (
    acquisition?.kind === "property-acquisition" &&
    acquisition.terms.buyers.some((buyer) => buyer.playerId === playerId)
  ) {
    const quote = acquisition.quote;
    propertyAcquisition = {
      id: acquisition.id,
      leadPlayerId: acquisition.leadPlayerId,
      termsRevision: acquisition.termsRevision,
      terms: {
        catalogueId: acquisition.terms.catalogueId,
        principalCents: acquisition.terms.principalCents,
        rateKind: acquisition.terms.rateKind,
        buyers: acquisition.terms.buyers.map((buyer) => ({
          playerId: buyer.playerId,
          cashContributionCents: buyer.cashContributionCents,
          ownershipPpm: buyer.ownershipPpm,
        })),
      },
      quote: {
        askingPriceCents: quote.askingPriceCents,
        feeCents: quote.feeCents,
        cashRequiredCents: quote.cashRequiredCents,
        principalCents: quote.principalCents,
        rateKind: quote.rateKind,
        annualRateBps: quote.annualRateBps,
        quarterlyPaymentCents: quote.quarterlyPaymentCents,
        assetReserveCents: quote.assetReserveCents,
        firstDueQuarter: quote.firstDueQuarter,
        termQuarters: quote.termQuarters,
      },
      confirmedPlayerIds: acquisition.confirmedPlayerIds.filter((id) =>
        acquisition.terms.buyers.some((buyer) => buyer.playerId === id),
      ),
    };
  }
  let jointProperty: JointPropertyView | null = null;
  const joint = state.activeTransaction;
  if (joint?.kind === "joint-property") {
    const asset = state.finance.assetsById[joint.assetId];
    if (
      asset?.kind === "property" &&
      (asset.ownershipByPlayerPpm[playerId] ?? 0) > 0
    ) {
      const participants = jointPropertyParticipants(state, asset);
      const quote = joint.quote;
      const allowedQuote =
        quote.kind === "sale"
          ? {
              kind: quote.kind,
              salePriceCents: quote.salePriceCents,
              feeCents: quote.feeCents,
              payoffCents: quote.payoffCents,
              netProceedsCents: quote.netProceedsCents,
              proceedsByPlayer: Object.fromEntries(
                participants.map((id) => [id, quote.proceedsByPlayer[id] ?? 0]),
              ),
            }
          : quote.kind === "refinance"
            ? {
                kind: quote.kind,
                payerPlayerId: quote.payerPlayerId,
                cashRequiredCents: quote.cashRequiredCents,
                feeCents: quote.feeCents,
                principalCents: quote.principalCents,
                rateKind: quote.rateKind,
                annualRateBps: quote.annualRateBps,
                quarterlyPaymentCents: quote.quarterlyPaymentCents,
                assetReserveCents: quote.assetReserveCents,
                firstDueQuarter: quote.firstDueQuarter,
                termQuarters: quote.termQuarters,
              }
            : {
                kind: quote.kind,
                payerPlayerId: quote.payerPlayerId,
                cashRequiredCents: quote.cashRequiredCents,
                effectiveQuarter: quote.effectiveQuarter,
                rentIncreaseBps: quote.rentIncreaseBps,
                occupancyIncreaseBps: quote.occupancyIncreaseBps,
                valueIncreaseCents: quote.valueIncreaseCents,
              };
      jointProperty = {
        id: joint.id,
        assetId: joint.assetId,
        initiatorPlayerId: joint.initiatorPlayerId,
        termsRevision: joint.termsRevision,
        terms:
          quote.kind === "refinance"
            ? { kind: "refinance", rateKind: quote.rateKind }
            : { kind: quote.kind },
        quote: allowedQuote,
        ownershipByPlayerPpm: Object.fromEntries(
          participants.map((id) => [id, asset.ownershipByPlayerPpm[id]!]),
        ),
        participantIds: participants,
        confirmedPlayerIds: joint.confirmedPlayerIds.filter((id) =>
          participants.includes(id),
        ),
        yourCashRequiredCents: jointPropertyCashRequired(joint, playerId),
      };
    }
  }

  let businessCapital: BusinessCapitalView | null = null;
  let businessLoanInvitation: BusinessLoanInvitationView | null = null;
  let businessEquityInvitation: BusinessEquityInvitationView | null = null;
  const capital = state.activeTransaction;
  if (capital?.kind === "business-capital") {
    const asset = state.finance.assetsById[capital.assetId];
    const plan =
      asset?.kind === "business"
        ? planBusinessCapital(state, asset, capital)
        : null;
    const requests = loanRequests(capital);
    const equity = equityRequests(capital);
    const readyToConfirm = plan?.ready ?? false;
    const isCurrentOwner = (asset?.ownershipByPlayerPpm[playerId] ?? 0) > 0;
    const isDirectParty =
      capital.terms.kind === "request-equity"
        ? isCurrentOwner
        : capital.terms.kind !== "secondary-stake-sale" ||
          capital.terms.buyerPlayerId === playerId ||
          capital.terms.sellerPlayerId === playerId;
    if (isDirectParty && plan?.participants.includes(playerId)) {
      businessCapital = {
        id: capital.id,
        assetId: capital.assetId,
        initiatorPlayerId: capital.initiatorPlayerId,
        terms: plan.terms,
        termsRevision: capital.termsRevision,
        participantIds: plan.participants,
        confirmedPlayerIds: capital.confirmedPlayerIds,
        yourContributionCents: plan.cashContributions.get(playerId) ?? 0,
        ...(requests.length
          ? {
              loanOffers: businessLoanOfferViews(capital, playerId),
              readyToConfirm,
            }
          : {}),
        ...(equity.length
          ? {
              equityOffers: businessEquityOfferViews(
                capital,
                playerId,
                isCurrentOwner,
              ),
              readyToConfirm,
            }
          : {}),
      };
    }
    if (equity.length) {
      const slots = equity.flatMap((request, slot) =>
        canOfferBusinessEquity(capital, playerId, slot)
          ? [{ slot, amountCents: request.amountCents }]
          : [],
      );
      if (slots.length) {
        businessEquityInvitation = {
          transactionId: capital.id,
          issuerPlayerId: capital.initiatorPlayerId,
          termsRevision: capital.termsRevision,
          slots,
          ownOffers: businessEquityOfferViews(capital, playerId, false),
          confirmed: capital.confirmedPlayerIds.includes(playerId),
          readyToConfirm,
          mustConfirmThroughOwnerView: isCurrentOwner,
        };
      }
    }
    if (capital.terms.kind === "secondary-stake-sale" && requests.length) {
      const slots = requests.flatMap((request, slot) =>
        canOfferBusinessLoan(capital, playerId, slot)
          ? [{ slot, principalCents: request.principalCents }]
          : [],
      );
      if (slots.length) {
        const ownOffers = businessLoanOfferViews(capital, playerId);
        businessLoanInvitation = {
          transactionId: capital.id,
          borrowerPlayerId: capital.terms.buyerPlayerId,
          termsRevision: capital.termsRevision,
          slots,
          ownOffers,
          readyToConfirm,
          confirmed: capital.confirmedPlayerIds.includes(playerId),
          selected: ownOffers.some((offer) => offer.selected),
        };
      }
    }
  }

  return {
    hasActiveTransaction: state.activeTransaction !== null,
    jointProperty,
    propertyAcquisition,
    result: state.result
      ? state.result.kind === "objective-victory"
        ? {
            kind: "objective-victory",
            winnerPlayerId: state.result.winnerPlayerId,
            completedQuarter: state.result.completedQuarter,
          }
        : {
            kind: "safety-draw",
            completedQuarter: state.result.completedQuarter,
          }
      : null,
    matchId: state.gameId as unknown as MatchId,
    modeId: state.modeId,
    revision: state.revision,
    phase: state.phase,
    currentQuarter: state.currentQuarter,
    round,
    players,
    self,
    activeTransaction,
    businessCapital,
    businessLoanInvitation,
    businessEquityInvitation,
    businessAuction:
      capital?.kind === "business-auction"
        ? projectBusinessAuction(capital, playerId)
        : null,
  };
}
