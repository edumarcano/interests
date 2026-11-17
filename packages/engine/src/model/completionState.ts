import type { PublicMarketInstrumentId } from "@interests/rules";
import type { AssetId, PlayerId } from "@interests/shared";
import type { Cents } from "../finance/money";
import type { OwnershipPpm } from "../finance/ownership";

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
  | { readonly kind: "employment"; readonly role: "professional" | "executive" }
  | { readonly kind: "owner-work"; readonly assetId: AssetId }
  | { readonly kind: "not-working" };
export interface AssetAcquisitionBasis {
  readonly costCents: Cents;
  readonly acquiredQuarter: number;
  readonly ownershipPpm: OwnershipPpm;
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
    readonly counterpartyPlayerId: PlayerId;
    readonly acquiredQuarter: number;
    readonly soldQuarter: number;
    readonly proceedsCents: Cents;
    readonly costCents: Cents;
    readonly referenceEquityCents: Cents;
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

/** Terms contracts for later origination packets; these are not executable loans yet. */
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
