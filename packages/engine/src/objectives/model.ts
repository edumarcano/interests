import type { ObjectiveId } from "@interests/rules";
import type { AssetId, PlayerId } from "@interests/shared";
import type { Cents } from "../finance/money";

/** Internal engine facts. Never accept these records from a player command or browser. */
export interface ObjectivePropertyClaims {
  readonly assetId: AssetId;
  readonly cashReserveCents: Cents;
  readonly principalCents: Cents;
  readonly unpaidInterestCents: Cents;
  readonly operatingArrearsCents: Cents;
  readonly pastDuePrincipalCents: Cents;
}
export interface ObjectiveFinancingEvidence {
  readonly loanId: string;
  readonly lenderPlayerId: PlayerId;
  readonly beneficialBorrowerId: string;
  readonly fundedTransactionId: string;
  readonly originatedQuarter: number;
  readonly fundedPrincipalCents: Cents;
  readonly outstandingPrincipalCents: Cents;
  readonly unpaidInterestCents: Cents;
  readonly pastDuePrincipalCents: Cents;
  readonly funding: "non-circular" | "circular";
  readonly feesPaidCents: Cents;
  readonly realizedLossesCents: Cents;
  readonly interestReceipts: readonly {
    readonly quarter: number;
    readonly receivedCents: Cents;
    /** Fresh earned interest; excludes collection of an earlier quarter's unpaid interest. */
    readonly currentEarnedCents: Cents;
  }[];
}
export interface ObjectiveDisposalEvidence {
  readonly disposalId?: string;
  readonly transactionId: string;
  readonly underlyingAssetId: string;
  readonly category: "business" | "property" | "public-markets";
  readonly counterparty: {
    readonly kind: "player" | "non-player";
    readonly id: string;
  };
  readonly acquiredQuarter: number;
  readonly settledExposureThroughQuarter: number;
  readonly soldQuarter: number;
  readonly proceedsCents: Cents;
  readonly saleFeesCents: Cents;
  readonly assetCashReleasedCents?: Cents;
  readonly financingCostsCents?: Cents;
  readonly companyClaimsPaidCents?: Cents;
  readonly acquisitionBasisCents: Cents;
  /** Independent gross quote for the actual stake sold, required for player-to-player credit. */
  readonly referenceProceedsCents: Cents | null;
  readonly economicSubstance: "genuine" | "circular";
}
export interface ObjectiveEvidence {
  readonly propertyClaims?: readonly ObjectivePropertyClaims[];
  readonly financing?: readonly ObjectiveFinancingEvidence[];
  /** Complete signed ledger, including losses; produced by authoritative transaction accounting. */
  readonly disposalLedger?: {
    readonly throughRevision: number;
    readonly entries: readonly ObjectiveDisposalEvidence[];
  };
}
export type ProductiveCategory =
  | "business"
  | "property"
  | "public-markets"
  | "financing";
export interface ObjectiveHolding {
  readonly id: string;
  readonly category: ProductiveCategory;
  readonly equityCents: Cents;
}
export interface ObjectiveIncomeSource {
  readonly id: string;
  readonly category: ProductiveCategory | "cash";
  readonly annualReceivedCents: Cents;
}
export interface ObjectiveCompanyMeasurement {
  readonly assetId: AssetId;
  readonly ownershipPpm: number;
  readonly attributableEquityCents: Cents;
  readonly enterpriseValueCents: Cents;
  readonly principalCents: Cents;
  readonly annualOperatingProfitCents: Cents;
  readonly consecutivePositiveQuarters: number;
  readonly overdue: boolean;
}
export interface ObjectiveMeasurements {
  readonly playerId: PlayerId;
  readonly completedQuarters: number;
  readonly protectedAnnualLivingCostCents: Cents;
  readonly liquidCapitalCents: Cents;
  readonly cashCents: Cents;
  readonly grossAssetValueCents: Cents;
  readonly totalLiabilitiesCents: Cents;
  readonly netWorthCents: Cents;
  readonly annualEmploymentIncomeCents: Cents;
  readonly annualInvestmentIncomeCents: Cents;
  readonly annualInvestmentAfterPersonalDebtServiceCents: Cents;
  readonly annualRequiredPersonalDebtServiceCents: Cents;
  readonly annualRecurringSurplusCents: Cents;
  readonly propertyValueCents: Cents;
  readonly propertyEquityCents: Cents;
  readonly propertyPrincipalCents: Cents;
  readonly annualPropertyNetCashFlowCents: Cents;
  readonly controlledProperties: number;
  readonly propertyOverdue: boolean;
  readonly holdings: readonly ObjectiveHolding[];
  readonly incomeSources: readonly ObjectiveIncomeSource[];
  readonly companies: readonly ObjectiveCompanyMeasurement[];
  readonly performingFinancingBookCents: Cents;
  readonly earnedFinancingProfitCents: Cents;
  readonly distinctFundedTransactions: number;
  readonly distinctPerformingBorrowers: number;
  readonly creditedDealGainsCents: Cents;
  readonly profitableDisposals: number;
  readonly profitableDisposalCategories: number;
  readonly profitableDisposalCounterparties: number;
  readonly executiveRole: boolean;
  readonly overdue: boolean;
  readonly evidenceGaps: readonly string[];
}
export interface ObjectiveCheck {
  readonly id: string;
  readonly met: boolean;
  readonly actual: number;
  readonly target: number;
  readonly comparison: "minimum" | "maximum" | "required";
}
export interface ObjectiveEvaluation {
  readonly objectiveId: ObjectiveId;
  readonly status: "eligible" | "ineligible";
  readonly checks: readonly ObjectiveCheck[];
}
