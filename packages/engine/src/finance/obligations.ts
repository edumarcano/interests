import type {
  AssetId,
  LoanId,
  PlayerId,
  SettlementId,
} from "@interests/shared";
import type { Loan } from "../model/gameState";
import {
  calculateCompanyLoanSchedule,
  calculatePlayerLoanSchedule,
} from "./amortization";
import type { BusinessSettlementOutcome } from "./businessSettlement";
import { FinanceDecimal } from "./decimal";
import { type Cents, cents } from "./money";

export interface LoanPaymentAccounting {
  readonly principalRepaidCents: Cents;
  readonly pastDuePrincipalCents: Cents;
  readonly unpaidInterestCents: Cents;
  readonly lastProcessedQuarter: number;
}

export interface LoanObligation {
  readonly loanId: LoanId;
  readonly principalDueCents: Cents;
  readonly interestDueCents: Cents;
  readonly amountDueCents: Cents;
}

export interface LivingPaymentOutcome {
  readonly currentDueCents: Cents;
  readonly arrearsDueCents: Cents;
  readonly currentPaidCents: Cents;
  readonly arrearsPaidCents: Cents;
  readonly closingArrearsCents: Cents;
}

export interface LoanPaymentOutcome {
  readonly loanId: LoanId;
  readonly borrowerPlayerId: PlayerId | null;
  readonly borrowerAssetId?: AssetId;
  readonly lenderPlayerId: PlayerId | null;
  readonly dueCents: Cents;
  readonly paidCents: Cents;
  readonly principalPaidCents: Cents;
  readonly interestPaidCents: Cents;
  readonly closingPastDuePrincipalCents: Cents;
  readonly closingUnpaidInterestCents: Cents;
}

export interface SettlementOutcome {
  readonly businesses: readonly BusinessSettlementOutcome[];
  readonly settlementId: SettlementId;
  readonly quarter: number;
  readonly livingByPlayer: Readonly<Record<PlayerId, LivingPaymentOutcome>>;
  readonly loanPayments: readonly LoanPaymentOutcome[];
}

export function calculateLoanObligation(
  loan: Loan,
  quarter: number,
): LoanObligation | null {
  if (
    quarter <= loan.lastProcessedQuarter ||
    ((loan.kind === "company-loan" || loan.kind === "asset-bank-loan") &&
      quarter < loan.firstDueQuarter) ||
    (loan.kind === "player-loan" && quarter <= loan.originatedQuarter) ||
    (loan.outstandingPrincipalCents === 0 && loan.unpaidInterestCents === 0)
  ) {
    return null;
  }
  const currentInterest = cents(
    loan.kind === "asset-bank-loan" &&
      loan.interestPaidThroughQuarter >= quarter
      ? 0
      : new FinanceDecimal(loan.outstandingPrincipalCents)
          .times(loan.annualRateBps)
          .div(40_000)
          .round()
          .toNumber(),
  );
  const interestDueCents = cents(loan.unpaidInterestCents + currentInterest);
  let regularPayment: number;
  let matured = false;
  if (loan.kind === "player-loan") {
    const schedule = calculatePlayerLoanSchedule({
      principalCents: loan.originalPrincipalCents,
      annualRateBps: loan.annualRateBps,
      termQuarters: loan.termQuarters,
    });
    const period = quarter - loan.originatedQuarter;
    const row = schedule[Math.min(period, loan.termQuarters) - 1];
    if (!row) throw new Error("Missing contractual installment");
    regularPayment = row.paymentCents;
    matured = period >= loan.termQuarters;
  } else if (loan.kind === "company-loan") {
    const period = quarter - loan.firstDueQuarter + 1;
    const schedule = calculateCompanyLoanSchedule({
      principalCents: loan.originalPrincipalCents,
      annualRateBps: loan.annualRateBps,
    });
    regularPayment =
      schedule[Math.min(period, loan.termQuarters) - 1]!.paymentCents;
    matured = period >= loan.termQuarters;
  } else {
    if (loan.kind === "asset-bank-loan")
      matured = quarter >= loan.maturityQuarter;
    regularPayment = loan.scheduledQuarterlyPaymentCents;
  }
  const notYetOverdue =
    loan.outstandingPrincipalCents - loan.pastDuePrincipalCents;
  const newPrincipal = matured
    ? notYetOverdue
    : Math.min(notYetOverdue, Math.max(0, regularPayment - currentInterest));
  const principalDueCents = cents(loan.pastDuePrincipalCents + newPrincipal);
  return {
    loanId: loan.id,
    principalDueCents,
    interestDueCents,
    amountDueCents: cents(principalDueCents + interestDueCents),
  };
}

export function applyLoanPaymentAllocation(
  loan: Loan,
  obligation: LoanObligation,
  paidCents: Cents,
  quarter: number,
): { loan: Loan; outcome: LoanPaymentOutcome } {
  if (paidCents < 0 || paidCents > obligation.amountDueCents) {
    throw new RangeError("Payment exceeds loan claim");
  }
  const interestPaidCents = cents(
    Math.min(paidCents, obligation.interestDueCents),
  );
  const principalPaidCents = cents(paidCents - interestPaidCents);
  const accounting: LoanPaymentAccounting = {
    principalRepaidCents: cents(loan.principalRepaidCents + principalPaidCents),
    pastDuePrincipalCents: cents(
      obligation.principalDueCents - principalPaidCents,
    ),
    unpaidInterestCents: cents(obligation.interestDueCents - interestPaidCents),
    lastProcessedQuarter: quarter,
  };
  const updated: Loan =
    loan.kind === "player-loan"
      ? {
          ...loan,
          ...accounting,
          outstandingPrincipalCents: cents(
            loan.outstandingPrincipalCents - principalPaidCents,
          ),
          installmentsProcessed: Math.min(
            loan.termQuarters,
            quarter - loan.originatedQuarter,
          ),
        }
      : {
          ...loan,
          ...accounting,
          outstandingPrincipalCents: cents(
            loan.outstandingPrincipalCents - principalPaidCents,
          ),
          periodsProcessed: loan.periodsProcessed + 1,
        };
  return {
    loan: updated,
    outcome: {
      loanId: loan.id,
      borrowerPlayerId:
        loan.kind === "company-loan" || loan.kind === "asset-bank-loan"
          ? null
          : loan.borrowerPlayerId,
      ...(loan.kind === "company-loan" || loan.kind === "asset-bank-loan"
        ? { borrowerAssetId: loan.borrowerAssetId }
        : {}),
      lenderPlayerId: loan.kind === "player-loan" ? loan.lenderPlayerId : null,
      dueCents: obligation.amountDueCents,
      paidCents,
      principalPaidCents,
      interestPaidCents,
      closingPastDuePrincipalCents: accounting.pastDuePrincipalCents,
      closingUnpaidInterestCents: accounting.unpaidInterestCents,
    },
  };
}
