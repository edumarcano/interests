import type {
  CommandId,
  MatchId,
  PlayerId,
  RoomMemberId,
  TransactionId,
} from "./primitives/ids.js";

export interface MarketLoanQuoteView {
  readonly borrowerName: string;
  readonly principalCents: number;
  readonly annualRateBps: number;
  readonly termQuarters: number;
  readonly firstDueQuarter: number;
  readonly scheduledQuarterlyPaymentCents: number;
  readonly onTimeTotalInterestCents: number;
  readonly repaymentRisk: "full-budget" | "tight-budget";
  readonly canFund: boolean;
  readonly unavailableReason:
    | "borrower-funded"
    | "insufficient-cash"
    | "transaction-active"
    | null;
}

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

export interface PublicMarketTradeLeg {
  readonly instrumentId: string;
  readonly buyCents: number;
  readonly sellCents: number;
}
export interface TradePublicMarketsCommandPayload {
  readonly type: "TRADE_PUBLIC_MARKETS";
  readonly trades: readonly PublicMarketTradeLeg[];
}
export interface PublicMarketTradePreview {
  readonly revision: number;
  readonly feeRateBps: number;
  readonly trades: readonly {
    readonly instrumentId: string;
    readonly buyCents: number;
    readonly sellCents: number;
    readonly feeCents: number;
    readonly removedBasisCents: number;
    readonly realizedGainCents: number;
    readonly resultingValueCents: number;
    readonly resultingBasisCents: number;
  }[];
  readonly totalFeesCents: number;
  readonly cashImpactCents: number;
  readonly resultingCashCents: number;
}

export interface AcceptCareerOfferCommandPayload {
  readonly type: "ACCEPT_CAREER_OFFER";
  readonly offerId: string;
}
export interface ResignLaborCommandPayload {
  readonly type: "RESIGN_LABOR";
}
export interface CareerOfferView {
  readonly id: string;
  readonly name: string;
  readonly role: "professional" | "executive";
  readonly annualCompensationCents: number;
  readonly raiseBps: number;
  readonly transitionCostCents: number;
  readonly ownershipCostCents: number;
  readonly ownershipPurchaseFeeCents: number;
  readonly totalCashRequiredCents: number;
  readonly ownershipPosition: null | {
    readonly annualRevenueCents: number;
    readonly annualOperatingProfitCents: number;
    readonly enterpriseValueCents: number;
    readonly companyCashCents: number;
    readonly debtPrincipalCents: number;
    readonly ownershipPpm: number;
  };
  readonly affordable: boolean;
  readonly tradeoff: string;
}

export type PropertyCommand =
  | {
      readonly type: "BUY_PROPERTY";
      readonly catalogueId: string;
      readonly principalCents: number;
      readonly rateKind: "fixed" | "variable";
    }
  | {
      readonly type: "SELL_PROPERTY" | "RENOVATE_PROPERTY";
      readonly assetId: string;
    }
  | {
      readonly type: "REFINANCE_PROPERTY";
      readonly assetId: string;
      readonly rateKind: "fixed" | "variable";
    }
  | {
      readonly type: "FUND_PROPERTY_RESERVE";
      readonly assetId: string;
      readonly amountCents: number;
    };
export interface PropertyBankQuoteView {
  readonly termQuarters: number;
  readonly creditGrade: string;
  readonly creditEnvironment: string;
  readonly maximumLtvBps: number;
  readonly minimumDscrBps: number;
  readonly principalCents: number;
  readonly rateKind: "fixed" | "variable";
  readonly annualRateBps: number;
  readonly quarterlyPaymentCents: number;
  readonly feeCents: number;
  readonly assetReserveCents: number;
  readonly personalReserveCents: number;
  readonly cashRequiredCents: number;
  readonly canClose: boolean;
}
export interface PropertyOfferView {
  readonly catalogueId: string;
  readonly name: string;
  readonly askingPriceCents: number;
  readonly scheduledQuarterlyRentCents: number;
  readonly occupancyBps: number;
  readonly operatingExpenseRatioBps: number;
  readonly quotes: readonly PropertyBankQuoteView[];
}
export interface PropertyManagementView {
  readonly assetId: string;
  readonly cashCents: number;
  readonly reserveTargetCents: number;
  readonly payoffCents: number;
  readonly saleFeeCents: number;
  readonly netSaleProceedsCents: number;
  readonly canSell: boolean;
  readonly renovationCostCents: number;
  readonly canRenovate: boolean;
  readonly renovated: boolean;
  readonly refinancingQuotes: readonly PropertyBankQuoteView[];
}

export interface ExpandBusinessCommandPayload {
  readonly type: "EXPAND_BUSINESS";
  readonly assetId: string;
  readonly investmentCents: number;
}

export type BusinessCapitalTerms =
  | { readonly kind: "company-expansion"; readonly investmentCents: number }
  | {
      readonly kind: "request-equity";
      readonly requests: readonly BusinessEquityRequest[];
    }
  | {
      readonly kind: "secondary-stake-sale";
      readonly sellerPlayerId: string;
      readonly buyerPlayerId: string;
      readonly ownershipPpm: number;
      readonly priceCents: number;
      readonly loanRequests?: readonly BusinessLoanRequest[];
    }
  | {
      readonly kind: "primary-issuance";
      readonly contributions: readonly {
        readonly playerId: string;
        readonly amountCents: number;
        readonly postMoneyOwnershipPpm: number;
      }[];
    };

export type BusinessCapitalCommand =
  | {
      readonly type: "OPEN_BUSINESS_CAPITAL";
      readonly assetId: string;
      readonly terms: BusinessCapitalTerms;
    }
  | {
      readonly type: "REVISE_BUSINESS_CAPITAL";
      readonly transactionId: string;
      readonly expectedTermsRevision: number;
      readonly terms: BusinessCapitalTerms;
    }
  | {
      readonly type:
        | "CONFIRM_BUSINESS_CAPITAL"
        | "WITHDRAW_BUSINESS_CAPITAL"
        | "CLOSE_BUSINESS_CAPITAL";
      readonly transactionId: string;
      readonly expectedTermsRevision: number;
    }
  | {
      readonly type: "OFFER_BUSINESS_LOAN";
      readonly transactionId: string;
      readonly expectedTermsRevision: number;
      readonly slot: number;
      readonly annualRateBps: number;
      readonly termQuarters: number;
    }
  | {
      readonly type: "WITHDRAW_BUSINESS_LOAN" | "SELECT_BUSINESS_LOAN";
      readonly transactionId: string;
      readonly expectedTermsRevision: number;
      readonly slot: number;
      readonly lenderPlayerId: string;
    }
  | {
      readonly type: "OFFER_BUSINESS_EQUITY";
      readonly transactionId: string;
      readonly expectedTermsRevision: number;
      readonly slot: number;
      readonly postMoneyOwnershipPpm: number;
    }
  | {
      readonly type: "SELECT_BUSINESS_EQUITY" | "WITHDRAW_BUSINESS_EQUITY";
      readonly transactionId: string;
      readonly expectedTermsRevision: number;
      readonly slot: number;
      readonly investorPlayerId: string;
    };

export interface BusinessEquityRequest {
  readonly amountCents: number;
  readonly invitedInvestorId?: string;
}

export interface BusinessEquityOfferView {
  readonly investorPlayerId: string;
  readonly slot: number;
  readonly postMoneyOwnershipPpm: number;
  readonly selected: boolean;
}

export type BusinessAuctionCommand =
  | {
      readonly type: "OPEN_BUSINESS_AUCTION";
      readonly assetId: string;
      readonly ownershipPpm: number;
      readonly minimumBidCents: number;
    }
  | {
      readonly type: "RESPOND_BUSINESS_AUCTION";
      readonly transactionId: string;
      readonly bidCents: number | null;
    };

export interface BusinessLoanRequest {
  readonly principalCents: number;
  readonly invitedLenderId?: string;
}

export interface BusinessLoanOfferView {
  readonly lenderPlayerId: string;
  readonly slot: number;
  readonly annualRateBps: number;
  readonly termQuarters: number;
  readonly selected: boolean;
}

export type JointPropertyTerms =
  | { readonly kind: "sale" }
  | { readonly kind: "refinance"; readonly rateKind: "fixed" | "variable" }
  | { readonly kind: "renovation" };
export type JointPropertyQuote =
  | {
      readonly kind: "sale";
      readonly salePriceCents: number;
      readonly feeCents: number;
      readonly payoffCents: number;
      readonly netProceedsCents: number;
      readonly proceedsByPlayer: Readonly<Record<string, number>>;
    }
  | {
      readonly kind: "refinance";
      readonly payerPlayerId: string;
      readonly cashRequiredCents: number;
      readonly feeCents: number;
      readonly principalCents: number;
      readonly rateKind: "fixed" | "variable";
      readonly annualRateBps: number;
      readonly quarterlyPaymentCents: number;
      readonly assetReserveCents: number;
      readonly firstDueQuarter: number;
      readonly termQuarters: number;
    }
  | {
      readonly kind: "renovation";
      readonly payerPlayerId: string;
      readonly cashRequiredCents: number;
      readonly effectiveQuarter: number;
      readonly rentIncreaseBps: number;
      readonly occupancyIncreaseBps: number;
      readonly valueIncreaseCents: number;
    };
export type JointPropertyCommand =
  | {
      readonly type: "OPEN_JOINT_PROPERTY";
      readonly assetId: string;
      readonly terms: JointPropertyTerms;
    }
  | {
      readonly type: "REVISE_JOINT_PROPERTY";
      readonly transactionId: string;
      readonly expectedTermsRevision: number;
      readonly terms: JointPropertyTerms;
    }
  | {
      readonly type:
        | "CONFIRM_JOINT_PROPERTY"
        | "WITHDRAW_JOINT_PROPERTY"
        | "CLOSE_JOINT_PROPERTY"
        | "CANCEL_JOINT_PROPERTY";
      readonly transactionId: string;
      readonly expectedTermsRevision: number;
    };
export interface JointPropertyView {
  readonly id: string;
  readonly assetId: string;
  readonly initiatorPlayerId: string;
  readonly termsRevision: number;
  readonly terms: JointPropertyTerms;
  readonly quote: JointPropertyQuote;
  readonly ownershipByPlayerPpm: Readonly<Record<string, number>>;
  readonly participantIds: readonly string[];
  readonly confirmedPlayerIds: readonly string[];
  readonly yourCashRequiredCents: number;
}

export interface PropertyAcquisitionTerms {
  readonly catalogueId: string;
  readonly principalCents: number;
  readonly rateKind: "fixed" | "variable";
  readonly buyers: readonly {
    readonly playerId: string;
    readonly cashContributionCents: number;
    readonly ownershipPpm: number;
  }[];
}
export interface PropertyAcquisitionQuote {
  readonly askingPriceCents: number;
  readonly feeCents: number;
  readonly cashRequiredCents: number;
  readonly principalCents: number;
  readonly rateKind: "fixed" | "variable";
  readonly annualRateBps: number;
  readonly quarterlyPaymentCents: number;
  readonly assetReserveCents: number;
  readonly firstDueQuarter: number;
  readonly termQuarters: number;
}
export type PropertyAcquisitionCommand =
  | {
      readonly type: "OPEN_PROPERTY_ACQUISITION";
      readonly terms: PropertyAcquisitionTerms;
    }
  | {
      readonly type: "REVISE_PROPERTY_ACQUISITION";
      readonly transactionId: string;
      readonly expectedTermsRevision: number;
      readonly terms: PropertyAcquisitionTerms;
    }
  | {
      readonly type:
        | "CONFIRM_PROPERTY_ACQUISITION"
        | "WITHDRAW_PROPERTY_ACQUISITION"
        | "CLOSE_PROPERTY_ACQUISITION"
        | "CANCEL_PROPERTY_ACQUISITION";
      readonly transactionId: string;
      readonly expectedTermsRevision: number;
    };
export interface PropertyAcquisitionView {
  readonly id: string;
  readonly leadPlayerId: string;
  readonly termsRevision: number;
  readonly terms: PropertyAcquisitionTerms;
  readonly quote: PropertyAcquisitionQuote;
  readonly confirmedPlayerIds: readonly string[];
}

export type PlayerCommand =
  | PropertyAcquisitionCommand
  | BusinessAuctionCommand
  | JointPropertyCommand
  | BusinessCapitalCommand
  | PropertyCommand
  | ExpandBusinessCommandPayload
  | TradePublicMarketsCommandPayload
  | AcceptCareerOfferCommandPayload
  | ResignLaborCommandPayload
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
  readonly annualManagementCostCents?: number;
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
  readonly role: "borrower" | "lender" | "company-borrower" | "asset-borrower";
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
    readonly role:
      | "borrower"
      | "lender"
      | "company-borrower"
      | "asset-borrower";
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
  readonly formerWorkClaims?: readonly {
    readonly assetId: string;
    readonly amountCents: number;
  }[];
  readonly careerOffers: readonly CareerOfferView[];
  readonly annualLaborCompensationCents: number | null;
  readonly quarterlyIncomeCents: number;
  readonly quarterlyLivingExpenseCents: number;
  readonly entitledQuarterlyIncomeCents: number;
  readonly entitledQuarterlyLivingExpenseCents: number;
  readonly labor:
    | {
        readonly kind: "employment";
        readonly role: "professional" | "executive";
        readonly ownershipPositionAssetId?: string;
      }
    | { readonly kind: "owner-work"; readonly assetId: string }
    | { readonly kind: "not-working" };
  readonly focus: string;
  readonly completedObservationQuarters: number;
  readonly publicMarkets: readonly {
    readonly id: string;
    readonly name: string;
    readonly annualDividendYieldBps: number;
    readonly tradeFeeBps: number;
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
    readonly instructionsVersion: string;
    readonly instructions: readonly string[];
    readonly targets: Readonly<Record<string, number>>;
  }[];
}

export interface MatchSelfView {
  readonly propertyOffers?: readonly PropertyOfferView[];
  readonly propertyManagement?: readonly PropertyManagementView[];
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

export interface MatchEconomicConditionsView {
  readonly baseRateBps: number;
  readonly annualInflationBps: number;
  readonly creditEnvironment: "easy" | "normal" | "tight" | "severe";
}

export interface MatchPlayerView {
  readonly hasActiveTransaction?: boolean;
  readonly jointProperty?: JointPropertyView | null;
  readonly propertyAcquisition?: PropertyAcquisitionView | null;
  readonly economicConditions?: MatchEconomicConditionsView;
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
  readonly businessCapital?: BusinessCapitalView | null;
  readonly businessLoanInvitation?: BusinessLoanInvitationView | null;
  readonly businessEquityInvitation?: BusinessEquityInvitationView | null;
  readonly businessAuction?: BusinessAuctionView | null;
}

export interface BusinessEquityInvitationView {
  readonly transactionId: string;
  readonly issuerPlayerId: string;
  readonly termsRevision: number;
  readonly slots: readonly {
    readonly slot: number;
    readonly amountCents: number;
  }[];
  readonly ownOffers: readonly BusinessEquityOfferView[];
  readonly confirmed: boolean;
  readonly readyToConfirm: boolean;
  readonly mustConfirmThroughOwnerView: boolean;
}

export interface BusinessAuctionView {
  readonly id: string;
  readonly assetId: string;
  readonly sellerPlayerId: string;
  readonly ownershipPpm: number;
  readonly minimumBidCents: number;
  readonly responsesReceived: number;
  readonly responsesRequired: number;
  readonly ownResponse:
    | { readonly kind: "pass" }
    | { readonly kind: "bid"; readonly amountCents: number }
    | null;
}

export interface BusinessLoanInvitationView {
  readonly transactionId: string;
  readonly borrowerPlayerId: string;
  readonly termsRevision: number;
  readonly slots: readonly {
    readonly slot: number;
    readonly principalCents: number;
  }[];
  readonly ownOffers: readonly BusinessLoanOfferView[];
  readonly confirmed: boolean;
  readonly selected: boolean;
  readonly readyToConfirm: boolean;
}

export interface BusinessCapitalView {
  readonly id: string;
  readonly assetId: string;
  readonly initiatorPlayerId: string;
  readonly terms: BusinessCapitalTerms;
  readonly termsRevision: number;
  readonly participantIds: readonly string[];
  readonly confirmedPlayerIds: readonly string[];
  readonly yourContributionCents: number;
  readonly loanOffers?: readonly BusinessLoanOfferView[];
  readonly equityOffers?: readonly BusinessEquityOfferView[];
  readonly readyToConfirm?: boolean;
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
