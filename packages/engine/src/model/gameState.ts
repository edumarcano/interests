import type {
  EconomicRegimeId,
  ObjectiveId,
  ProfileId,
  PublicMarketInstrumentId,
} from "@interests/rules";
import type {
  AssetId,
  GameId,
  LoanId,
  OpportunityId,
  PlayerId,
} from "@interests/shared";

import type { BasisPoints, Cents } from "../finance/money";
import type { OwnershipPpm } from "../finance/ownership";
import type { Opportunity } from "../opportunities/model";
import type { RandomState } from "../random/prng";
import type { ActiveTransaction } from "../transactions/model";

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

export type GamePhase = "objective-choosing" | "ready-for-first-round";

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
  readonly quarter: number;
  readonly cashByPlayer: Readonly<Record<PlayerId, Cents>>;
  readonly publicMarketsByPlayer: Readonly<
    Record<PlayerId, PublicMarketPortfolio>
  >;
}

export interface PlayerLoan {
  readonly id: LoanId;
  readonly kind: "player-loan";
  readonly lenderPlayerId: PlayerId;
  readonly borrowerPlayerId: PlayerId;
  readonly originalPrincipalCents: Cents;
  readonly outstandingPrincipalCents: Cents;
  readonly annualRateBps: BasisPoints;
  readonly termQuarters: number;
  readonly installmentsPaid: number;
  readonly originatedQuarter: number;
}

export type LegacyBankLoanPurpose = "personal-debt" | "property-mortgage";

export interface LegacyBankLoan {
  readonly id: LoanId;
  readonly kind: "legacy-bank-loan";
  readonly borrowerPlayerId: PlayerId;
  readonly purpose: LegacyBankLoanPurpose;
  readonly originalPrincipalCents: Cents;
  readonly outstandingPrincipalCents: Cents;
  readonly annualRateBps: BasisPoints;
  readonly scheduledQuarterlyPaymentCents: Cents;
  readonly paymentsApplied: number;
  readonly relatedAssetId?: AssetId;
}

export type Loan = PlayerLoan | LegacyBankLoan;

export interface PropertyAsset {
  readonly id: AssetId;
  readonly kind: "property";
  readonly marketValueCents: Cents;
  readonly scheduledQuarterlyRentCents: Cents;
  readonly occupancyBps: BasisPoints;
  readonly operatingExpenseRatioBps: BasisPoints;
  readonly ownershipByPlayerPpm: Readonly<Record<PlayerId, OwnershipPpm>>;
}

export interface BusinessAsset {
  readonly id: AssetId;
  readonly kind: "business";
  readonly annualRevenueCents: Cents;
  readonly annualOperatingProfitCents: Cents;
  readonly enterpriseValueCents: Cents;
  readonly debtPrincipalCents: Cents;
  readonly ownershipByPlayerPpm: Readonly<Record<PlayerId, OwnershipPpm>>;
}

export type Asset = PropertyAsset | BusinessAsset;

export interface FinanceState {
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
  readonly currentRegime: EconomicRegimeId;
  readonly baseRateBps: BasisPoints;
  readonly lastMarketUpdate: MarketUpdateRecord | null;
}

export interface GameState {
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
}
