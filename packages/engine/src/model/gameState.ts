import type {
  BusinessCashPolicyId,
  BusinessSensitivity,
  EconomicRegimeId,
  ObjectiveId,
  ProfileId,
  PropertyMarketKind,
  PublicMarketInstrumentId,
} from "@interests/rules";
import type {
  AssetId,
  GameId,
  LoanId,
  OpportunityId,
  PlayerId,
  TransactionId,
} from "@interests/shared";
import type { BasisPoints, Cents } from "../finance/money";
import type {
  LoanPaymentAccounting,
  SettlementOutcome,
} from "../finance/obligations";
import type { OwnershipPpm } from "../finance/ownership";
import type { Opportunity } from "../opportunities/model";
import type { RecurringContentState } from "../opportunities/recurring";
import type { RandomState } from "../random/prng";
import type { ActiveTransaction } from "../transactions/model";
import type { MatchResult, ProgressState } from "./completionState";

export type {
  BusinessPurchaseDueDiligence,
  Opportunity,
  PrivateBusinessPurchaseInvestigation,
  PrivateBusinessPurchaseOpportunity,
} from "../opportunities/model";

export type {
  ActiveTransaction,
  CashBusinessPurchaseTransaction,
  CashReservation,
} from "../transactions/model";

export type GamePhase =
  | "objective-choosing"
  | "ready-for-first-round"
  | "finished";

export type RoundStage = "round-start" | "spotlight";

export interface RoundState {
  readonly stage: RoundStage;
  readonly spotlightsCompleted: number;
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly profileId: ProfileId;
  readonly offeredObjectiveIds: readonly [ObjectiveId, ObjectiveId];
  readonly selectedObjectiveId: ObjectiveId | null;
}

export interface RecurringPersonalFinance {
  readonly quarterlyIncomeCents: Cents;
  readonly quarterlyLivingExpenseCents: Cents;
}

export type PublicMarketPortfolio = Readonly<
  Record<PublicMarketInstrumentId, Cents>
>;

export interface QuarterStartFinanceBasis {
  readonly propertiesById: Readonly<Record<AssetId, PropertyAsset>>;
  readonly recurringByPlayer: Readonly<
    Record<PlayerId, RecurringPersonalFinance>
  >;
  readonly businessesById: Readonly<Record<AssetId, BusinessQuarterBasis>>;
  readonly quarter: number;
  readonly cashByPlayer: Readonly<Record<PlayerId, Cents>>;
  readonly publicMarketsByPlayer: Readonly<
    Record<PlayerId, PublicMarketPortfolio>
  >;
}

export interface BusinessQuarterBasis {
  readonly annualManagementCostCents?: Cents;
  readonly cashPolicyId: BusinessCashPolicyId;
  readonly workCompensation?: {
    readonly playerId: PlayerId;
    readonly annualCompensationCents: Cents;
  };
  readonly annualOperatingProfitCents: Cents;
  readonly ownershipByPlayerPpm: Readonly<Record<PlayerId, OwnershipPpm>>;
}

export interface PlayerLoan extends LoanPaymentAccounting {
  readonly id: LoanId;
  readonly kind: "player-loan";
  readonly lenderPlayerId: PlayerId;
  readonly borrowerPlayerId: PlayerId;
  readonly originalPrincipalCents: Cents;
  readonly outstandingPrincipalCents: Cents;
  readonly annualRateBps: BasisPoints;
  readonly termQuarters: number;
  readonly installmentsProcessed: number;
  readonly originatedQuarter: number;
  readonly fundedTransactionId?: TransactionId;
}

/** A market borrower is not a player and never draws from a player's cash budget. */
export interface NpcLoan extends LoanPaymentAccounting {
  readonly id: LoanId;
  readonly kind: "npc-loan";
  readonly borrowerId: string;
  readonly borrowerName: string;
  readonly lenderPlayerId: PlayerId;
  readonly originalPrincipalCents: Cents;
  readonly outstandingPrincipalCents: Cents;
  readonly annualRateBps: BasisPoints;
  readonly termQuarters: number;
  readonly installmentsProcessed: number;
  readonly originatedQuarter: number;
  readonly fundedTransactionId: TransactionId;
  readonly fundedOpportunityId?: OpportunityId;
  readonly quarterlyRepaymentCapacityCents: Cents;
  readonly interestReceipts: readonly {
    readonly quarter: number;
    readonly receivedCents: Cents;
    readonly currentEarnedCents: Cents;
  }[];
}

export type LegacyBankLoanPurpose = "personal-debt" | "property-mortgage";

export interface LegacyBankLoan extends LoanPaymentAccounting {
  readonly id: LoanId;
  readonly kind: "legacy-bank-loan";
  readonly borrowerPlayerId: PlayerId;
  readonly purpose: LegacyBankLoanPurpose;
  readonly originalPrincipalCents: Cents;
  readonly outstandingPrincipalCents: Cents;
  readonly annualRateBps: BasisPoints;
  readonly scheduledQuarterlyPaymentCents: Cents;
  readonly periodsProcessed: number;
  readonly relatedAssetId?: AssetId;
}

export interface CompanyLoan extends LoanPaymentAccounting {
  readonly id: LoanId;
  readonly kind: "company-loan";
  readonly borrowerAssetId: AssetId;
  readonly originalPrincipalCents: Cents;
  readonly outstandingPrincipalCents: Cents;
  readonly annualRateBps: BasisPoints;
  readonly scheduledQuarterlyPaymentCents: Cents;
  readonly firstDueQuarter: number;
  readonly termQuarters: number;
  readonly periodsProcessed: number;
}

export interface AssetBankLoan extends LoanPaymentAccounting {
  readonly id: LoanId;
  readonly kind: "asset-bank-loan";
  readonly borrowerAssetId: AssetId;
  readonly leadPlayerId: PlayerId;
  readonly purpose: "property-mortgage" | "business-acquisition";
  readonly originalPrincipalCents: Cents;
  readonly outstandingPrincipalCents: Cents;
  readonly annualRateBps: BasisPoints;
  readonly pricing:
    | { readonly kind: "fixed" }
    | { readonly kind: "variable"; readonly spreadBps: number };
  readonly scheduledQuarterlyPaymentCents: Cents;
  readonly firstDueQuarter: number;
  readonly maturityQuarter: number;
  readonly termQuarters: number;
  readonly periodsProcessed: number;
  readonly interestPaidThroughQuarter: number;
  readonly paymentResetQuarter: number;
  readonly paymentBasisPrincipalCents: Cents;
}

export type Loan =
  | PlayerLoan
  | NpcLoan
  | LegacyBankLoan
  | CompanyLoan
  | AssetBankLoan;

export interface PropertyAsset {
  /** Absent on grandfathered properties whose mortgage remains personal. */
  readonly cashCents?: Cents;
  readonly debtServiceReserveCents?: Cents;
  readonly renovatedQuarter?: number;
  readonly renovationPending?: {
    readonly costCents: Cents;
    readonly effectiveQuarter: number;
  };
  readonly catalogueId?: string;
  readonly disposition?: "sold";
  readonly marketKind?: PropertyMarketKind;
  readonly id: AssetId;
  readonly kind: "property";
  readonly marketValueCents: Cents;
  readonly scheduledQuarterlyRentCents: Cents;
  readonly occupancyBps: BasisPoints;
  readonly operatingExpenseRatioBps: BasisPoints;
  readonly ownershipByPlayerPpm: Readonly<Record<PlayerId, OwnershipPpm>>;
}

export interface WorkCompensation {
  readonly playerId: PlayerId;
  readonly annualCompensationCents: Cents;
  readonly arrearsCents: Cents;
}

export interface BusinessOperatingModel {
  readonly kind: "revenue-cost-v1";
  readonly sensitivity: BusinessSensitivity;
  readonly referenceAnnualRevenueCents: Cents;
  readonly referenceAnnualNonLaborCostsCents: Cents;
  readonly fixedAnnualLaborCostsCents: Cents;
  readonly annualProfitAdjustmentCents: Cents;
  readonly valuationBasis: "after-labor-profit" | "owner-earnings";
  readonly openingEnterpriseValueCents: Cents;
  readonly openingValuationEarningsCents: Cents;
  readonly quarters: readonly {
    readonly quarter: number;
    readonly operatingProfitCents: Cents;
  }[];
}

export interface BusinessAsset {
  readonly operatingModel?: BusinessOperatingModel;
  readonly annualManagementCostCents?: Cents;
  readonly cashPolicyId: BusinessCashPolicyId;
  readonly cashCents: Cents;
  readonly operatingArrearsCents: Cents;
  readonly id: AssetId;
  readonly kind: "business";
  readonly annualRevenueCents: Cents;
  readonly annualOperatingProfitCents: Cents;
  readonly enterpriseValueCents: Cents;
  readonly pendingAnnualProfitIncreaseCents?: Cents;
  /** Zero on managed acquisition assets; absent on registry-financed starting companies. */
  readonly debtPrincipalCents?: Cents;
  /** Required for starting-company-v1, absent on the managed acquisition policy. */
  readonly workCompensation?: WorkCompensation;
  readonly ownershipByPlayerPpm: Readonly<Record<PlayerId, OwnershipPpm>>;
}

export type Asset = PropertyAsset | BusinessAsset;

export interface FinanceState {
  readonly prepaidAssetInterest?: {
    readonly quarter: number;
    readonly byAssetId: Readonly<
      Record<
        AssetId,
        {
          readonly interestCents: Cents;
          readonly ownershipByPlayerPpm: Readonly<
            Record<PlayerId, OwnershipPpm>
          >;
        }
      >
    >;
  };
  readonly livingArrearsByPlayer: Readonly<Record<PlayerId, Cents>>;
  readonly lastSettlement: SettlementOutcome | null;
  readonly cashByPlayer: Readonly<Record<PlayerId, Cents>>;
  readonly recurringByPlayer: Readonly<
    Record<PlayerId, RecurringPersonalFinance>
  >;
  readonly loansById: Readonly<Record<LoanId, Loan>>;
  readonly assetsById: Readonly<Record<AssetId, Asset>>;
  readonly publicMarketsByPlayer: Readonly<
    Record<PlayerId, PublicMarketPortfolio>
  >;
  readonly quarterStartBasis: QuarterStartFinanceBasis;
}

export interface DeterministicCounters {
  readonly asset: number;
  readonly contract: number;
  readonly loan: number;
  readonly opportunity: number;
  readonly journal: number;
  readonly settlement: number;
  readonly transaction: number;
}

export interface MarketUpdateRecord {
  readonly quarter: number;
  readonly regimeUsed: EconomicRegimeId;
  readonly returnBpsByInstrument: Readonly<
    Record<PublicMarketInstrumentId, number>
  >;
}

export interface EconomyState {
  readonly operatingRandom: RandomState;
  readonly currentRegime: EconomicRegimeId;
  readonly baseRateBps: BasisPoints;
  readonly lastMarketUpdate: MarketUpdateRecord | null;
}

export interface GameState {
  readonly content: RecurringContentState;
  readonly progress: ProgressState;
  readonly result: MatchResult | null;
  readonly gameId: GameId;
  readonly modeId: "standard-v1";
  readonly revision: number;
  readonly phase: GamePhase;
  readonly currentQuarter: number;
  readonly lastSettledQuarter: number;
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly finance: FinanceState;
  readonly economy: EconomyState;
  readonly random: RandomState;
  readonly counters: DeterministicCounters;
  readonly activeTransaction: ActiveTransaction | null;
  readonly opportunitiesById: Readonly<Record<OpportunityId, Opportunity>>;
  readonly round: RoundState | null;
}
