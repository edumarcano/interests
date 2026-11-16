export const MANDATORY_SETTLEMENT_POLICY = Object.freeze({
  id: "mandatory-arrears-v1",
  priority: Object.freeze(["current-living", "living-arrears", "loans"] as const),
  loanAllocation: "proportional-due-claims",
  loanPaymentOrder: "interest-before-principal",
  incomingLoanPaymentsFundSameQuarter: false,
  capitalizeUnpaidInterest: false,
});

export const BUSINESS_CASH_POLICIES = Object.freeze({
  "legacy-owner-income-v1": Object.freeze({ kind: "legacy-owner-income" }),
  "retained-profit-v1": Object.freeze({
    kind: "retained-profit",
    retentionBps: 2_000,
    firstOperatingQuarter: 2,
  }),
});

export type BusinessCashPolicyId = keyof typeof BUSINESS_CASH_POLICIES;

export const OPENING_COMPANY_LOAN_CALIBRATION = Object.freeze({
  annualRateBps: 800,
  termQuarters: 28,
});
