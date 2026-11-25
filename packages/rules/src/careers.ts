/** Persistent authored choices; ordinary recurring cards are generated separately. */
export const CAREER_TEMPLATES = Object.freeze([
  Object.freeze({
    id: "steady",
    name: "Steady role",
    raiseBps: 800,
    transitionCostCents: 0,
    minimumAnnualCapacityCents: 0,
    role: "professional",
    ownershipCostCents: 0,
  }),
  Object.freeze({
    id: "major",
    name: "Major promotion",
    raiseBps: 2000,
    transitionCostCents: 500_000,
    minimumAnnualCapacityCents: 0,
    role: "professional",
    ownershipCostCents: 0,
  }),
  Object.freeze({
    id: "executive",
    name: "Executive ownership position",
    raiseBps: 3500,
    transitionCostCents: 0,
    minimumAnnualCapacityCents: 12_000_000,
    role: "executive",
    ownershipCostCents: 10_000_000,
  }),
] as const);
export const CAREER_REENTRY_ANNUAL_CENTS = 6_000_000;
export const EXECUTIVE_COMPANY_TERMS = Object.freeze({
  annualRevenueCents: 10_000_000,
  annualOperatingProfitCents: 2_000_000,
  enterpriseValueCents: 10_000_000,
  companyCashCents: 0,
  debtPrincipalCents: 0,
  ownershipPpm: 1_000_000,
});

/** Necessary management is already included in the quoted after-labor profit. */
export const EXECUTIVE_COMPANY_OPERATING_CALIBRATION = Object.freeze({
  sensitivity: "low",
  fixedAnnualLaborCostsCents: 6_000_000,
} as const);
