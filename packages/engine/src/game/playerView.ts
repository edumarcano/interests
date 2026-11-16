import type {
  MatchId,
  PlayerId,
  SelfSettlementView,
  TransactionId,
} from "@interests/shared";
import { calculatePlayerLoanSchedule } from "../finance/amortization";
import { calculateLoanObligation } from "../finance/obligations";
import type { GameState } from "../model/gameState.js";
import {
  getAvailableCashCents,
  getReservedCashCents,
} from "../transactions/reservations.js";
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
  readonly role: "borrower" | "lender";
  readonly counterpartyPlayerId: PlayerId | "bank";
  readonly originalPrincipalCents: number;
  readonly outstandingPrincipalCents: number;
  readonly annualRateBps: number;
  readonly termQuarters?: number;
  readonly scheduledQuarterlyPaymentCents?: number;
}

export interface PureSelfView {
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
  readonly matchId: MatchId;
  readonly modeId: string;
  readonly revision: number;
  readonly phase: string;
  readonly currentQuarter: number;
  readonly round: PureRoundView | null;
  readonly players: readonly PurePlayerSummary[];
  readonly self: PureSelfView;
  readonly activeTransaction: PureActiveTransactionSummary | null;
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
        ownedAssets.push({
          id: asset.id,
          kind: "business",
          annualRevenueCents: asset.annualRevenueCents,
          annualOperatingProfitCents: asset.annualOperatingProfitCents,
          enterpriseValueCents: asset.enterpriseValueCents,
          debtPrincipalCents: asset.debtPrincipalCents,
          ownershipPpm: ownership,
        });
      }
    }
  }

  const selfLoans: PureLoanView[] = [];
  for (const loan of Object.values(state.finance.loansById).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    const borrower = loan.borrowerPlayerId === playerId;
    const lender =
      loan.kind === "player-loan" && loan.lenderPlayerId === playerId;
    if (!borrower && !lender) continue;
    const repaid =
      loan.outstandingPrincipalCents === 0 && loan.unpaidInterestCents === 0;
    selfLoans.push({
      id: loan.id,
      kind: loan.kind,
      role: borrower ? "borrower" : "lender",
      counterpartyPlayerId:
        loan.kind === "player-loan"
          ? borrower
            ? loan.lenderPlayerId
            : loan.borrowerPlayerId
          : "bank",
      originalPrincipalCents: loan.originalPrincipalCents,
      outstandingPrincipalCents: loan.outstandingPrincipalCents,
      annualRateBps: loan.annualRateBps,
      ...(loan.kind === "player-loan"
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
          livingDueCents: living.currentDueCents + living.arrearsDueCents,
          livingPaidCents: living.currentPaidCents + living.arrearsPaidCents,
          livingArrearsCents: living.closingArrearsCents,
          loanPayments: latest.loanPayments
            .filter(
              (p) =>
                p.borrowerPlayerId === playerId ||
                p.lenderPlayerId === playerId,
            )
            .map((p) => ({
              loanId: p.loanId,
              role: p.borrowerPlayerId === playerId ? "borrower" : "lender",
              dueCents: p.dueCents,
              paidCents: p.paidCents,
              principalPaidCents: p.principalPaidCents,
              interestPaidCents: p.interestPaidCents,
              unpaidCents:
                p.closingPastDuePrincipalCents + p.closingUnpaidInterestCents,
            })),
        }
      : null;

  const self: PureSelfView = {
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
  if (state.activeTransaction !== null) {
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

  return {
    matchId: state.gameId as unknown as MatchId,
    modeId: state.modeId,
    revision: state.revision,
    phase: state.phase,
    currentQuarter: state.currentQuarter,
    round,
    players,
    self,
    activeTransaction,
  };
}
