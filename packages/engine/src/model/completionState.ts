import type { PublicMarketInstrumentId } from "@interests/rules";
import type { AssetId, PlayerId, TransactionId } from "@interests/shared";
import type { Cents } from "../finance/money";
import type { OwnershipPpm } from "../finance/ownership";
import type { StakeBasisSlice } from "../finance/stakeBasis";

export const FOCUS_AREAS = [
  "general",
  "business",
  "property",
  "career",
  "markets",
  "financing",
] as const;
export type FocusArea = (typeof FOCUS_AREAS)[number];
export type LaborRole =
  | {
      readonly kind: "employment";
      readonly role: "professional" | "executive";
      readonly ownershipPositionAssetId?: AssetId;
    }
  | { readonly kind: "owner-work"; readonly assetId: AssetId }
  | { readonly kind: "not-working" };
export interface AssetAcquisitionBasis {
  readonly acquisition?: {
    readonly kind: "recurring-npc";
    readonly opportunityId: string;
    readonly templateId: string;
    readonly transactionId: TransactionId;
    readonly considerationCents: number;
    readonly feeCents: number;
    readonly bankPrincipalCents: number;
    readonly reserveCents: number;
    readonly buyerCashCents: number;
    readonly buyerCashByPlayer?: Readonly<Record<PlayerId, number>>;
  };
  readonly costCents: Cents;
  readonly acquiredQuarter: number;
  readonly ownershipPpm: OwnershipPpm;
  readonly slices?: readonly StakeBasisSlice[];
}
export type IncomeCategory =
  | "cash"
  | "public-markets"
  | "property"
  | "business"
  | "financing";
export interface SourceObservation {
  readonly category: IncomeCategory;
  readonly recurringReceivedCents: Cents;
  readonly debtServiceOwedCents: Cents;
}
export interface QuarterObservation {
  readonly quarter: number;
  readonly employmentIncomeCents: Cents;
  readonly workIncomeCents: Cents;
  readonly recurringWorkIncomeCents: Cents;
  readonly livingCostOwedCents: Cents;
  readonly debtServiceOwedCents: Cents;
  readonly debtServicePaidCents: Cents;
  readonly sourcesById: Readonly<Record<string, SourceObservation>>;
  readonly companyOperatingProfitById: Readonly<Record<AssetId, Cents>>;
}
export interface PlayerProgress {
  readonly labor: LaborRole;
  readonly focus: FocusArea;
  readonly publicMarketBasis: Readonly<Record<PublicMarketInstrumentId, Cents>>;
  readonly assetsById: Readonly<Record<AssetId, AssetAcquisitionBasis>>;
  readonly quarters: readonly QuarterObservation[];
  readonly realizedGainsCents: Cents;
  readonly publicMarketDisposals: readonly {
    readonly instrumentId: PublicMarketInstrumentId;
    readonly soldQuarter: number;
    readonly tradeValueCents: Cents;
    readonly feeCents: Cents;
    readonly removedBasisCents: Cents;
    readonly realizedGainCents: Cents;
    readonly quarterStartValueCents: Cents;
  }[];
  readonly financingInterestReceivedCents: Cents;
  readonly disposals: readonly {
    readonly assetId: AssetId;
    readonly category: "business" | "property";
    readonly counterpartyPlayerId: PlayerId | null;
    readonly acquiredQuarter: number;
    readonly soldQuarter: number;
    readonly proceedsCents: Cents;
    readonly costCents: Cents;
    readonly referenceEquityCents: Cents;
    readonly transactionId?: TransactionId;
    readonly grossProceedsCents?: Cents;
  }[];
  readonly profitableDisposalAssetIds: readonly string[];
}
export interface ProgressState {
  readonly byPlayer: Readonly<Record<PlayerId, PlayerProgress>>;
}
export type MatchResult =
  | {
      readonly kind: "objective-victory";
      readonly winnerPlayerId: PlayerId;
      readonly completedQuarter: number;
    }
  | { readonly kind: "safety-draw"; readonly completedQuarter: number };

/** Transaction request terms; executable debt lives in the canonical Loan registry. */
export interface AssetBankLoanTerms {
  readonly borrowerAssetId: AssetId;
  readonly leadPlayerId: PlayerId;
  readonly principalCents: Cents;
  readonly pricing:
    | { readonly kind: "fixed"; readonly annualRateBps: number }
    | { readonly kind: "variable"; readonly spreadBps: number };
  readonly termQuarters: number;
  readonly firstDueQuarter: number;
}
export interface NpcFinancingTerms {
  readonly borrowerId: string;
  readonly lenderPlayerId: PlayerId;
  readonly fundedTransactionId: string;
  readonly principalCents: Cents;
  readonly annualRateBps: number;
  readonly termQuarters: number;
}
