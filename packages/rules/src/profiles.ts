export const PROFILE_IDS = [
  "high-income-professional",
  "corporate-climber",
  "disciplined-saver",
  "small-business-owner",
  "property-starter",
  "market-investor",
  "self-employed-operator",
  "early-stage-entrepreneur",
] as const;

export type ProfileId = (typeof PROFILE_IDS)[number];

export const OPENING_PERSONAL_DEBT_APR_BPS = 800 as const;
export const PROPERTY_STARTER_MORTGAGE_APR_BPS = 550 as const;
export const PROPERTY_STARTER_MORTGAGE_QUARTERLY_PAYMENT_CENTS =
  433_537 as const;

export interface StartingPropertyFixture {
  readonly marketValueCents: number;
  readonly scheduledQuarterlyRentCents: number;
  readonly occupancyBps: number;
  readonly operatingExpenseRatioBps: number;
  readonly ownershipPpm: number;
}

export interface StartingMortgageFixture {
  readonly openingPrincipalCents: number;
  readonly annualRateBps: number;
  readonly scheduledQuarterlyPaymentCents: number;
}

export interface StartingBusinessFixture {
  readonly annualRevenueCents: number;
  readonly annualOperatingProfitCents: number;
  readonly annualNonOwnerOperatingCostsCents: number;
  readonly annualOwnerWorkCompensationCents: number;
  readonly externalManagementCostCents: number;
  readonly openingCashCents: number;
  readonly enterpriseValueCents: number;
  readonly debtPrincipalCents: number;
  readonly ownershipPpm: number;
}

export interface ProfileStartingFinances {
  readonly startingCashCents: number;
  readonly annualIncomeCents: number;
  readonly monthlyLivingExpenseCents: number;
  readonly openingPersonalDebtPrincipalCents: number;
  readonly monthlyPersonalDebtPaymentCents: number;
  readonly startingPublicInvestmentsCents: number;
  readonly propertyFixture?: StartingPropertyFixture;
  readonly mortgageFixture?: StartingMortgageFixture;
  readonly businessFixture?: StartingBusinessFixture;
}

export interface ProfileDefinition {
  readonly id: ProfileId;
  readonly name: string;
  readonly startingCashCents: number;
  readonly startingFinances: ProfileStartingFinances;
}

const HIGH_INCOME_PROFESSIONAL_FINANCES: ProfileStartingFinances = {
  startingCashCents: 5_000_000,
  annualIncomeCents: 15_000_000,
  monthlyLivingExpenseCents: 650_000,
  openingPersonalDebtPrincipalCents: 5_500_000,
  monthlyPersonalDebtPaymentCents: 85_000,
  startingPublicInvestmentsCents: 2_000_000,
};

const CORPORATE_CLIMBER_FINANCES: ProfileStartingFinances = {
  startingCashCents: 3_500_000,
  annualIncomeCents: 10_000_000,
  monthlyLivingExpenseCents: 460_000,
  openingPersonalDebtPrincipalCents: 1_800_000,
  monthlyPersonalDebtPaymentCents: 45_000,
  startingPublicInvestmentsCents: 1_000_000,
};

const DISCIPLINED_SAVER_FINANCES: ProfileStartingFinances = {
  startingCashCents: 10_500_000,
  annualIncomeCents: 7_200_000,
  monthlyLivingExpenseCents: 340_000,
  openingPersonalDebtPrincipalCents: 500_000,
  monthlyPersonalDebtPaymentCents: 15_000,
  startingPublicInvestmentsCents: 500_000,
};

const SMALL_BUSINESS_OWNER_FINANCES: ProfileStartingFinances = {
  startingCashCents: 3_000_000,
  annualIncomeCents: 0,
  monthlyLivingExpenseCents: 400_000,
  openingPersonalDebtPrincipalCents: 1_000_000,
  monthlyPersonalDebtPaymentCents: 25_000,
  startingPublicInvestmentsCents: 0,
  businessFixture: {
    annualRevenueCents: 50_000_000,
    annualOperatingProfitCents: 8_000_000,
    enterpriseValueCents: 32_000_000,
    debtPrincipalCents: 6_000_000,
    annualNonOwnerOperatingCostsCents: 39_600_000,
    annualOwnerWorkCompensationCents: 2_400_000,
    externalManagementCostCents: 6_000_000,
    openingCashCents: 1_500_000,
    ownershipPpm: 1_000_000,
  },
};

const PROPERTY_STARTER_FINANCES: ProfileStartingFinances = {
  startingCashCents: 2_800_000,
  annualIncomeCents: 7_800_000,
  monthlyLivingExpenseCents: 420_000,
  openingPersonalDebtPrincipalCents: 0,
  monthlyPersonalDebtPaymentCents: 0,
  startingPublicInvestmentsCents: 700_000,
  propertyFixture: {
    marketValueCents: 33_000_000,
    scheduledQuarterlyRentCents: 945_000,
    occupancyBps: 9_500,
    operatingExpenseRatioBps: 3_500,
    ownershipPpm: 1_000_000,
  },
  mortgageFixture: {
    openingPrincipalCents: 25_500_000,
    annualRateBps: PROPERTY_STARTER_MORTGAGE_APR_BPS,
    scheduledQuarterlyPaymentCents:
      PROPERTY_STARTER_MORTGAGE_QUARTERLY_PAYMENT_CENTS,
  },
};

const MARKET_INVESTOR_FINANCES: ProfileStartingFinances = {
  startingCashCents: 2_500_000,
  annualIncomeCents: 7_600_000,
  monthlyLivingExpenseCents: 400_000,
  openingPersonalDebtPrincipalCents: 1_000_000,
  monthlyPersonalDebtPaymentCents: 25_000,
  startingPublicInvestmentsCents: 8_000_000,
};

const SELF_EMPLOYED_OPERATOR_FINANCES: ProfileStartingFinances = {
  startingCashCents: 4_000_000,
  annualIncomeCents: 0,
  monthlyLivingExpenseCents: 430_000,
  openingPersonalDebtPrincipalCents: 800_000,
  monthlyPersonalDebtPaymentCents: 20_000,
  startingPublicInvestmentsCents: 0,
  businessFixture: {
    annualRevenueCents: 18_000_000,
    annualOperatingProfitCents: 2_400_000,
    enterpriseValueCents: 9_000_000,
    debtPrincipalCents: 2_000_000,
    annualNonOwnerOperatingCostsCents: 7_200_000,
    annualOwnerWorkCompensationCents: 8_400_000,
    externalManagementCostCents: 0,
    openingCashCents: 1_000_000,
    ownershipPpm: 1_000_000,
  },
};

const EARLY_STAGE_ENTREPRENEUR_FINANCES: ProfileStartingFinances = {
  startingCashCents: 2_000_000,
  annualIncomeCents: 0,
  monthlyLivingExpenseCents: 320_000,
  openingPersonalDebtPrincipalCents: 0,
  monthlyPersonalDebtPaymentCents: 0,
  startingPublicInvestmentsCents: 0,
  businessFixture: {
    annualRevenueCents: 30_000_000,
    annualOperatingProfitCents: 3_000_000,
    enterpriseValueCents: 15_000_000,
    debtPrincipalCents: 6_000_000,
    annualNonOwnerOperatingCostsCents: 23_400_000,
    annualOwnerWorkCompensationCents: 3_600_000,
    externalManagementCostCents: 0,
    openingCashCents: 1_500_000,
    ownershipPpm: 1_000_000,
  },
};

export const PROFILES: Readonly<Record<ProfileId, ProfileDefinition>> = {
  "high-income-professional": {
    id: "high-income-professional",
    name: "High-Income Professional",
    startingCashCents: HIGH_INCOME_PROFESSIONAL_FINANCES.startingCashCents,
    startingFinances: HIGH_INCOME_PROFESSIONAL_FINANCES,
  },
  "corporate-climber": {
    id: "corporate-climber",
    name: "Corporate Climber",
    startingCashCents: CORPORATE_CLIMBER_FINANCES.startingCashCents,
    startingFinances: CORPORATE_CLIMBER_FINANCES,
  },
  "disciplined-saver": {
    id: "disciplined-saver",
    name: "Disciplined Saver",
    startingCashCents: DISCIPLINED_SAVER_FINANCES.startingCashCents,
    startingFinances: DISCIPLINED_SAVER_FINANCES,
  },
  "small-business-owner": {
    id: "small-business-owner",
    name: "Small Business Owner",
    startingCashCents: SMALL_BUSINESS_OWNER_FINANCES.startingCashCents,
    startingFinances: SMALL_BUSINESS_OWNER_FINANCES,
  },
  "property-starter": {
    id: "property-starter",
    name: "Property Starter",
    startingCashCents: PROPERTY_STARTER_FINANCES.startingCashCents,
    startingFinances: PROPERTY_STARTER_FINANCES,
  },
  "market-investor": {
    id: "market-investor",
    name: "Market Investor",
    startingCashCents: MARKET_INVESTOR_FINANCES.startingCashCents,
    startingFinances: MARKET_INVESTOR_FINANCES,
  },
  "self-employed-operator": {
    id: "self-employed-operator",
    name: "Self-Employed Operator",
    startingCashCents: SELF_EMPLOYED_OPERATOR_FINANCES.startingCashCents,
    startingFinances: SELF_EMPLOYED_OPERATOR_FINANCES,
  },
  "early-stage-entrepreneur": {
    id: "early-stage-entrepreneur",
    name: "Early-Stage Entrepreneur",
    startingCashCents: EARLY_STAGE_ENTREPRENEUR_FINANCES.startingCashCents,
    startingFinances: EARLY_STAGE_ENTREPRENEUR_FINANCES,
  },
};

export const STARTING_FINANCES_BY_PROFILE: Readonly<
  Record<ProfileId, ProfileStartingFinances>
> = {
  "high-income-professional": HIGH_INCOME_PROFESSIONAL_FINANCES,
  "corporate-climber": CORPORATE_CLIMBER_FINANCES,
  "disciplined-saver": DISCIPLINED_SAVER_FINANCES,
  "small-business-owner": SMALL_BUSINESS_OWNER_FINANCES,
  "property-starter": PROPERTY_STARTER_FINANCES,
  "market-investor": MARKET_INVESTOR_FINANCES,
  "self-employed-operator": SELF_EMPLOYED_OPERATOR_FINANCES,
  "early-stage-entrepreneur": EARLY_STAGE_ENTREPRENEUR_FINANCES,
};

export function isProfileId(value: unknown): value is ProfileId {
  return typeof value === "string" && PROFILE_IDS.includes(value as ProfileId);
}
