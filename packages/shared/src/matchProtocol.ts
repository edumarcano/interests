import type {
  CommandId,
  MatchId,
  PlayerId,
  RoomMemberId,
  TransactionId,
} from "./primitives/ids.js";

export interface ChooseObjectiveCommandPayload {
  readonly type: "CHOOSE_OBJECTIVE";
  readonly objectiveId: string;
}

export interface BeginRoundCommandPayload {
  readonly type: "BEGIN_ROUND";
}

export interface PassSpotlightCommandPayload {
  readonly type: "PASS_SPOTLIGHT";
}

export interface InvestigateOpportunityCommandPayload {
  readonly type: "INVESTIGATE_OPPORTUNITY";
  readonly opportunityId: string;
}

export interface PursueBusinessCashCommandPayload {
  readonly type: "PURSUE_BUSINESS_CASH";
  readonly opportunityId: string;
}

export interface PursueBusinessWithPlayerLoanCommandPayload {
  readonly type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN";
  readonly opportunityId: string;
  readonly buyerCashContributionCents: number;
  readonly requestedPrincipalCents: number;
}

export interface SubmitPlayerLoanOfferCommandPayload {
  readonly type: "SUBMIT_PLAYER_LOAN_OFFER";
  readonly transactionId: string;
  readonly annualRateBps: number;
  readonly termQuarters: number;
}

export interface AcceptPlayerLoanOfferCommandPayload {
  readonly type: "ACCEPT_PLAYER_LOAN_OFFER";
  readonly transactionId: string;
  readonly expectedTermsRevision: number;
}

export interface CloseBusinessPurchaseCommandPayload {
  readonly type: "CLOSE_BUSINESS_PURCHASE";
  readonly transactionId: string;
}

export interface CancelActiveTransactionCommandPayload {
  readonly type: "CANCEL_ACTIVE_TRANSACTION";
  readonly transactionId: string;
}

export type PlayerCommand =
  | ChooseObjectiveCommandPayload
  | BeginRoundCommandPayload
  | PassSpotlightCommandPayload
  | InvestigateOpportunityCommandPayload
  | PursueBusinessCashCommandPayload
  | PursueBusinessWithPlayerLoanCommandPayload
  | SubmitPlayerLoanOfferCommandPayload
  | AcceptPlayerLoanOfferCommandPayload
  | CloseBusinessPurchaseCommandPayload
  | CancelActiveTransactionCommandPayload;

export interface PlayerCommandEnvelope {
  readonly commandId: CommandId | string;
  readonly expectedRevision: number;
  readonly command: PlayerCommand;
}

export interface MatchPlayerSummaryView {
  readonly playerId: PlayerId;
  readonly roomMemberId: RoomMemberId;
  readonly nickname: string;
  readonly joinOrder: number;
  readonly isHost: boolean;
  readonly hasSelectedObjective: boolean;
}

export interface MatchProfileView {
  readonly id: string;
  readonly name: string;
  readonly startingCashCents?: number;
}

export interface MatchObjectiveOptionView {
  readonly id: string;
  readonly name: string;
  readonly family: string;
}

export interface PrivateOpportunityDiligenceView {
  readonly annualRevenueCents: number;
  readonly annualOperatingProfitCents: number;
  readonly enterpriseValueCents: number;
  readonly debtPrincipalCents: number;
}

export interface PrivateOpportunityView {
  readonly id: string;
  readonly kind: "private-business-purchase";
  readonly askingPriceCents: number;
  readonly sellerPlayerId: PlayerId;
  readonly sellerNickname: string;
  readonly status: "available" | "pursued";
  readonly investigated: boolean;
  readonly facts?: PrivateOpportunityDiligenceView;
}

export interface MatchSelfBusinessAssetView {
  readonly companyCashCents?: number;
  readonly operatingArrearsCents?: number;
  readonly equityValueCents?: number;
  readonly expectedPayoutCents?: number | null;
  readonly payoutQuarter?: number | null;
  readonly incomeTreatment?: "work-and-ownership" | "business-distribution";
  readonly expectedWorkPayCents?: number | null;
  readonly workCompensationArrearsCents?: number;
  readonly id: string;
  readonly kind: "business";
  readonly annualRevenueCents: number;
  readonly annualOperatingProfitCents: number;
  readonly enterpriseValueCents: number;
  readonly debtPrincipalCents: number;
  readonly ownershipPpm: number;
}

export interface MatchSelfLoanView {
  readonly id: string;
  readonly kind: string;
  readonly role: "borrower" | "lender" | "company-borrower";
  readonly counterpartyNickname: string;
  readonly originalPrincipalCents: number;
  readonly outstandingPrincipalCents: number;
  readonly annualRateBps: number;
  readonly termQuarters?: number;
  readonly scheduledQuarterlyPaymentCents?: number;
  readonly amountDueCents?: number;
  readonly pastDuePrincipalCents?: number;
  readonly unpaidInterestCents?: number;
  readonly status?: "current" | "in-arrears" | "repaid";
}

export interface SelfSettlementView {
  readonly workCompensation?: readonly {
    readonly assetId: string;
    readonly dueCents: number;
    readonly paidCents: number;
    readonly unpaidCents: number;
  }[];
  readonly businessDistributions?: readonly {
    readonly assetId: string;
    readonly amountCents: number;
  }[];
  readonly quarter: number;
  readonly livingDueCents: number;
  readonly livingPaidCents: number;
  readonly livingArrearsCents: number;
  readonly loanPayments: readonly {
    readonly loanId: string;
    readonly role: "borrower" | "lender" | "company-borrower";
    readonly dueCents: number;
    readonly paidCents: number;
    readonly principalPaidCents: number;
    readonly interestPaidCents: number;
    readonly unpaidCents: number;
  }[];
}

export type MatchResultView =
  | {
      readonly kind: "objective-victory";
      readonly winnerPlayerId: PlayerId;
      readonly completedQuarter: number;
    }
  | { readonly kind: "safety-draw"; readonly completedQuarter: number };
export interface MatchSelfFinancialDetailsView {
  readonly quarterlyIncomeCents: number;
  readonly quarterlyLivingExpenseCents: number;
  readonly entitledQuarterlyIncomeCents: number;
  readonly entitledQuarterlyLivingExpenseCents: number;
  readonly labor:
    | {
        readonly kind: "employment";
        readonly role: "professional" | "executive";
      }
    | { readonly kind: "owner-work"; readonly assetId: string }
    | { readonly kind: "not-working" };
  readonly focus: string;
  readonly completedObservationQuarters: number;
  readonly publicMarkets: readonly {
    readonly id: string;
    readonly valueCents: number;
    readonly basisCents: number;
  }[];
  readonly properties: readonly {
    readonly id: string;
    readonly ownershipPpm: number;
    readonly marketValueCents: number;
    readonly scheduledQuarterlyRentCents: number;
    readonly occupancyBps: number;
    readonly quarterlyNoiCents: number;
  }[];
  readonly objectiveRequirements: readonly {
    readonly objectiveId: string;
    readonly targets: Readonly<Record<string, number>>;
  }[];
}

export interface MatchSelfView {
  readonly financialDetails: MatchSelfFinancialDetailsView;
  readonly playerId: PlayerId;
  readonly profileId: string;
  readonly profile?: MatchProfileView;
  readonly offeredObjectiveIds: readonly [string, string];
  readonly offeredObjectives?: readonly [
    MatchObjectiveOptionView,
    MatchObjectiveOptionView,
  ];
  readonly selectedObjectiveId: string | null;
  readonly selectedObjective?: MatchObjectiveOptionView | null;
  readonly cashCents: number;
  readonly reservedCashCents: number;
  readonly availableCashCents: number;
  readonly opportunity?: PrivateOpportunityView | null;
  readonly ownedAssets?: readonly MatchSelfBusinessAssetView[];
  readonly loans?: readonly MatchSelfLoanView[];
  readonly livingExpenseArrearsCents?: number;
  readonly lastSettlement?: SelfSettlementView | null;
}

export interface ActiveTransactionOfferView {
  readonly lenderPlayerId: PlayerId;
  readonly lenderNickname: string;
  readonly principalCents: number;
  readonly annualRateBps: number;
  readonly termQuarters: number;
  readonly termsRevision: number;
  readonly status: "offered" | "accepted";
}

export interface ActiveTransactionSummaryView {
  readonly transactionId: TransactionId;
  readonly kind: string;
  readonly role:
    | "buyer"
    | "seller"
    | "lender-candidate"
    | "lender"
    | "uninvolved";
  readonly buyerPlayerId: PlayerId;
  readonly buyerNickname: string;
  readonly sellerPlayerId: PlayerId;
  readonly sellerNickname: string;
  readonly purchasePriceCents: number;
  readonly isFinanced: boolean;
  readonly requestedPrincipalCents?: number;
  readonly buyerContributionCents?: number;
  readonly financingStatus?:
    | "waiting-for-offer"
    | "offer-submitted"
    | "offer-accepted";
  readonly offer?: ActiveTransactionOfferView | null;
  readonly hasExistingOffer?: boolean;
}

export interface MatchRoundView {
  readonly stage: "round-start" | "spotlight";
  readonly spotlightOrder: readonly PlayerId[];
  readonly activeSpotlightPlayerId: PlayerId | null;
  readonly spotlightsCompleted: number;
}

export interface MatchPlayerView {
  readonly result: MatchResultView | null;
  readonly matchId: MatchId;
  readonly modeId: string;
  readonly revision: number;
  readonly phase: string;
  readonly currentQuarter: number;
  readonly round: MatchRoundView | null;
  readonly players: readonly MatchPlayerSummaryView[];
  readonly self: MatchSelfView;
  readonly activeTransaction: ActiveTransactionSummaryView | null;
}

export interface CommandAckAccepted {
  readonly ok: true;
  readonly commandId: string;
  readonly outcome: "ACCEPTED";
  readonly revision: number;
}

export interface CommandAckRejected {
  readonly ok: false;
  readonly commandId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly revision: number;
}

export type CommandAckResult = CommandAckAccepted | CommandAckRejected;
