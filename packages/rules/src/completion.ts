import type { EconomicRegimeId } from "./economy";
import type { ObjectiveId } from "./objectives";

/** Approved M7 policy data. Engine activation is delivered in subsequent packets. */
export const COMPLETION_POLICY_ID = "standard-v1-completion-v1";

export const BANK_CREDIT_GRADES = Object.freeze([
  Object.freeze({
    id: "excellent",
    reserveQuarters: 4,
    maxDebtServiceBps: 2_500,
    spreadBps: 175,
  }),
  Object.freeze({
    id: "good",
    reserveQuarters: 2,
    maxDebtServiceBps: 3_500,
    spreadBps: 225,
  }),
  Object.freeze({
    id: "moderate",
    reserveQuarters: 1,
    maxDebtServiceBps: 4_500,
    spreadBps: 300,
  }),
  Object.freeze({
    id: "limited",
    reserveQuarters: 0,
    maxDebtServiceBps: null,
    spreadBps: 425,
  }),
] as const);

export const BANK_LENDING_RULES = Object.freeze({
  publicFundLiquidityBps: 8_000,
  employmentIncomeBps: 10_000,
  otherPositiveIncomeBps: 5_000,
  negativeIncomeBps: 10_000,
  propertyTermQuarters: 120,
  businessTermQuarters: 28,
  fixedPropertyPremiumBps: 50,
  businessPremiumBps: 150,
  personalReserveQuarters: 1,
  assetDebtServiceReserveQuarters: 1,
  firstPaymentQuarterOffset: 1,
  refinancingFeeBps: 100,
  refinancingCashOut: false,
  prepaymentPenaltyBps: 0,
  primaryIssuanceFeeBps: 0,
});

export const ASSET_UNDERWRITING = Object.freeze({
  easy: Object.freeze({
    propertyLtvBps: 8_000,
    propertyDscrBps: 11_000,
    businessShareBps: 6_000,
    businessDscrBps: 12_500,
  }),
  normal: Object.freeze({
    propertyLtvBps: 7_500,
    propertyDscrBps: 12_000,
    businessShareBps: 5_000,
    businessDscrBps: 13_500,
  }),
  tight: Object.freeze({
    propertyLtvBps: 7_000,
    propertyDscrBps: 13_000,
    businessShareBps: 4_000,
    businessDscrBps: 15_000,
  }),
  severe: Object.freeze({
    propertyLtvBps: 6_500,
    propertyDscrBps: 14_000,
    businessShareBps: 2_500,
    businessDscrBps: 17_500,
  }),
});

export type CreditEnvironment = keyof typeof ASSET_UNDERWRITING;

export const COMPLETION_ECONOMY_TARGETS = Object.freeze({
  expansion: Object.freeze({
    baseRateBps: 450,
    annualInflationBps: 250,
    credit: "normal",
  }),
  overheating: Object.freeze({
    baseRateBps: 600,
    annualInflationBps: 450,
    credit: "tight",
  }),
  slowdown: Object.freeze({
    baseRateBps: 500,
    annualInflationBps: 300,
    credit: "tight",
  }),
  recession: Object.freeze({
    baseRateBps: 300,
    annualInflationBps: 100,
    credit: "severe",
  }),
  recovery: Object.freeze({
    baseRateBps: 400,
    annualInflationBps: 200,
    credit: "easy",
  }),
} as const satisfies Record<
  EconomicRegimeId,
  { baseRateBps: number; annualInflationBps: number; credit: CreditEnvironment }
>);

export const OPERATING_RULES = Object.freeze({
  maxQuarterlyRateStepBps: 50,
  maxQuarterlyBusinessRevenueChangeBps: 1_000,
  businessGrowthCostPerAnnualProfitUnit: 4,
  effectQuarterOffset: 1,
  renovationCostBps: 500,
  renovationMinimumCents: 1_000_000,
  renovationRentIncreaseBps: 500,
  renovationOccupancyIncreaseBps: 500,
  renovationValuePerCostBps: 8_000,
  maxQuarterlyOccupancyStepBps: 100,
  residentialRateSensitivity: -2,
  commercialRateSensitivity: -3,
});

export const TRANSACTION_FEES_BPS = Object.freeze({
  property: Object.freeze({ purchase: 200, sale: 400 }),
  business: Object.freeze({ purchase: 200, sale: 300 }),
  publicMarket: Object.freeze({ purchase: 25, sale: 25 }),
});

export const RECURRING_CONTENT_RULES = Object.freeze({
  privateOpportunitiesPerPlayerPerQuarter: 1,
  askingPriceVariationBps: 250,
  businessProfitVariationBps: 500,
  focusWeightMultiplier: 3,
  ownershipWeightMultiplier: 2,
  recentCategoryWeightDivisor: 2,
  recentCategoryLookback: 2,
  investigationFeeBps: 25,
  investigationMinimumCents: 10_000,
  investigationMaximumCents: 100_000,
  pressureStartsQuarter: 9,
  expiry: "owner-spotlight-end",
});

export const OBJECTIVE_MEASUREMENT_RULES = Object.freeze({
  lookbackQuarters: 4,
  founderPositiveProfitQuarters: 2,
  materialEquityCents: 5_000_000,
  meaningfulAnnualIncomeMinimumCents: 100_000,
  meaningfulIncomeLivingExpenseBps: 1_000,
  minimumDisposalExposureQuarters: 1,
  controlExclusiveMinimumPpm: 500_000,
  overdueReceivableObjectiveValueBps: 0,
  safetyDrawQuarter: 32,
  victoryBoundary: "finale-close-before-spotlight-advance",
});

export const OBJECTIVE_TARGETS = Object.freeze({
  founder: Object.freeze({
    businessEquityCents: 100_000_000,
    annualOperatingProfitCents: 25_000_000,
    maxDebtToEnterpriseValueBps: 5_000,
    finaleInvestmentCents: 30_000_000,
    exitNetProceedsCents: 100_000_000,
  }),
  "property-magnate": Object.freeze({
    attributableValueCents: 180_000_000,
    equityCents: 50_000_000,
    annualNetCashFlowCents: 6_000_000,
    maxLtvBps: 7_000,
    controlledProperties: 3,
    finaleAcquisitionCents: 60_000_000,
  }),
  independent: Object.freeze({
    incomeToLivingExpenseBps: 15_000,
    meaningfulSources: 3,
    categories: 2,
    reserveMonths: 6,
    maxSourceIncomeBps: 6_000,
  }),
  "capital-allocator": Object.freeze({
    investedEquityCents: 75_000_000,
    materialHoldings: 4,
    categories: 2,
    maxHoldingBps: 4_500,
    annualInvestmentIncomeCents: 3_500_000,
    finaleInvestmentCents: 15_000_000,
  }),
  financier: Object.freeze({
    performingBookCents: 30_000_000,
    earnedProfitCents: 7_500_000,
    meaningfulContracts: 3,
    borrowers: 2,
    liquidityCents: 10_000_000,
    finalePrincipalCents: 15_000_000,
  }),
  "deal-maker": Object.freeze({
    netWorthCents: 75_000_000,
    realizedGainsCents: 25_000_000,
    profitableTransactions: 3,
    finaleConsiderationCents: 40_000_000,
  }),
  "executive-owner": Object.freeze({
    annualEmploymentIncomeCents: 18_000_000,
    productiveEquityCents: 50_000_000,
    annualNonSalaryIncomeCents: 3_000_000,
    liquidityCents: 7_500_000,
    finaleEquityExposureCents: 10_000_000,
  }),
  "wealth-architect": Object.freeze({
    netWorthCents: 100_000_000,
    liquidCapitalCents: 15_000_000,
    annualSurplusCents: 7_000_000,
    productiveCategories: 3,
    maxDebtToAssetsBps: 4_500,
    maxHoldingToNetWorthBps: 5_000,
    finaleDeploymentCents: 20_000_000,
  }),
} as const satisfies Record<ObjectiveId, Readonly<Record<string, number>>>);

/** Stable fully disclosed NPC listings; no randomized hidden facts or Q1 setup changes. */
export const PROPERTY_CATALOGUE = Object.freeze([
  Object.freeze({
    id: "residential-duplex",
    marketKind: "residential",
    name: "Residential duplex",
    marketValueCents: 10_000_000,
    scheduledQuarterlyRentCents: 275_000,
    occupancyBps: 9_500,
    operatingExpenseRatioBps: 3_000,
  }),
  Object.freeze({
    id: "residential-court",
    marketKind: "residential",
    name: "Residential court",
    marketValueCents: 33_000_000,
    scheduledQuarterlyRentCents: 990_000,
    occupancyBps: 9_200,
    operatingExpenseRatioBps: 3_500,
  }),
  Object.freeze({
    id: "commercial-plaza",
    marketKind: "commercial",
    name: "Commercial plaza",
    marketValueCents: 65_000_000,
    scheduledQuarterlyRentCents: 2_112_500,
    occupancyBps: 9_000,
    operatingExpenseRatioBps: 3_500,
  }),
] as const);
