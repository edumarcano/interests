import {
  PLAYER_LOAN_MAX_TERM_QUARTERS,
  PLAYER_LOAN_MIN_TERM_QUARTERS,
} from "@finance-game/rules";

import { FinanceDecimal } from "./decimal";
import { type Cents, cents, nonNegativeCents } from "./money";

export interface CalculatePlayerLoanScheduleInput {
  readonly principalCents: number;
  readonly annualRateBps: number;
  readonly termQuarters: number;
}

export interface LoanScheduleRow {
  readonly installmentNumber: number;
  readonly openingPrincipalCents: Cents;
  readonly paymentCents: Cents;
  readonly interestCents: Cents;
  readonly principalCents: Cents;
  readonly closingPrincipalCents: Cents;
}

/**
 * Pure calculator for deterministic player-loan amortization schedules.
 *
 * Implements the approved prototype player-loan calculation policy:
 * - Quarterly periodic rate = annualRateBps / 40000
 * - Positive APR: standard annuity formula P * r / (1 - (1 + r)^(-n))
 *   evaluated with 40-digit ROUND_HALF_UP Decimal and rounded once to cents.
 * - Each non-final period: interest = round_half_up(opening * r),
 *   principal = regularPayment - interest, closing = opening - principal.
 * - Final period: interest = round_half_up(opening * r),
 *   principal = remaining opening principal, payment = principal + interest,
 *   closing = 0.
 * - Zero APR: zero interest, principal divided evenly with remainder cents
 *   allocated to earliest installments.
 * - Rejects if rounding causes non-final principal reduction <= 0.
 */
export function calculatePlayerLoanSchedule(
  input: CalculatePlayerLoanScheduleInput,
): readonly LoanScheduleRow[] {
  const { principalCents, annualRateBps, termQuarters } = input;

  if (
    !Number.isSafeInteger(principalCents) ||
    principalCents <= 0 ||
    principalCents > Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError(
      `Loan principal must be a positive safe integer of cents, got ${String(principalCents)}`,
    );
  }

  if (
    !Number.isSafeInteger(annualRateBps) ||
    annualRateBps < 0 ||
    annualRateBps > Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError(
      `Loan annual rate must be a non-negative safe integer of basis points, got ${String(annualRateBps)}`,
    );
  }

  if (
    !Number.isSafeInteger(termQuarters) ||
    termQuarters < PLAYER_LOAN_MIN_TERM_QUARTERS ||
    termQuarters > PLAYER_LOAN_MAX_TERM_QUARTERS
  ) {
    throw new RangeError(
      `Loan term must be an integer between ${PLAYER_LOAN_MIN_TERM_QUARTERS} and ${PLAYER_LOAN_MAX_TERM_QUARTERS} quarters, got ${String(termQuarters)}`,
    );
  }

  const rows: LoanScheduleRow[] = [];
  let currentPrincipal = principalCents;

  if (annualRateBps === 0) {
    // Zero-interest loan:
    // Every installment must reduce principal. If principalCents < termQuarters,
    // at least one installment would have a zero principal component, causing
    // premature loan payoff before the contractual term completes.
    if (principalCents < termQuarters) {
      throw new RangeError(
        `Unsupported loan terms: zero-interest loan principal (${principalCents} cents) must be at least equal to term in quarters (${termQuarters}) to ensure each installment reduces principal`,
      );
    }

    // Total interest is 0. Allocate principal evenly, distributing remainder cents
    // to the earliest installments in deterministic 1-based order.
    const basePrincipal = Math.floor(principalCents / termQuarters);
    const remainderCents = principalCents % termQuarters;

    for (let i = 1; i <= termQuarters; i++) {
      const opening = currentPrincipal;
      const principalComp =
        i <= remainderCents ? basePrincipal + 1 : basePrincipal;
      const interestComp = 0;
      const payment = principalComp;
      const closing = opening - principalComp;

      rows.push({
        installmentNumber: i,
        openingPrincipalCents: cents(opening),
        paymentCents: cents(payment),
        interestCents: cents(interestComp),
        principalCents: cents(principalComp),
        closingPrincipalCents: cents(closing),
      });

      currentPrincipal = closing;
    }

    return Object.freeze(rows);
  }

  // Positive-rate loan:
  // quarterlyRate = annualRate / 4 = annualRateBps / 40000
  const quarterlyRate = new FinanceDecimal(annualRateBps).dividedBy(40000);
  const pDecimal = new FinanceDecimal(principalCents);
  const one = new FinanceDecimal(1);
  const onePlusR = one.plus(quarterlyRate);

  // Annuity formula: P * r / (1 - (1 + r)^(-n))
  const denominator = one.minus(onePlusR.pow(-termQuarters));
  const paymentDecimal = pDecimal.times(quarterlyRate).dividedBy(denominator);
  const regularPayment = paymentDecimal.round().toNumber();

  if (!Number.isSafeInteger(regularPayment)) {
    throw new RangeError("Regular payment exceeded safe integer range");
  }

  for (let i = 1; i <= termQuarters; i++) {
    const opening = currentPrincipal;
    const isFinal = i === termQuarters;

    // Interest for this period = opening * quarterlyRate (rounded HALF_UP)
    const interestDecimal = new FinanceDecimal(opening).times(quarterlyRate);
    const interestComp = interestDecimal.round().toNumber();

    if (!Number.isSafeInteger(interestComp)) {
      throw new RangeError("Interest component exceeded safe integer range");
    }

    let principalComp: number;
    let payment: number;
    let closing: number;

    if (!isFinal) {
      payment = regularPayment;
      principalComp = payment - interestComp;

      // Policy rule 11: non-final installment must reduce principal
      if (principalComp <= 0) {
        throw new RangeError(
          `Unsupported loan terms: installment ${i} fails to reduce principal (principal component = ${principalComp})`,
        );
      }

      closing = opening - principalComp;
      if (closing < 0) {
        throw new RangeError(
          `Unsupported loan terms: installment ${i} resulted in negative principal`,
        );
      }
    } else {
      // Final installment: absorb all remaining principal and residue
      principalComp = opening;
      payment = principalComp + interestComp;
      closing = 0;
    }

    rows.push({
      installmentNumber: i,
      openingPrincipalCents: cents(opening),
      paymentCents: cents(payment),
      interestCents: nonNegativeCents(interestComp),
      principalCents: cents(principalComp),
      closingPrincipalCents: cents(closing),
    });

    currentPrincipal = closing;
  }

  return Object.freeze(rows);
}

export interface CalculateLegacyBankLoanPaymentInput {
  readonly outstandingPrincipalCents: number;
  readonly annualRateBps: number;
  readonly scheduledQuarterlyPaymentCents: number;
}

export interface LegacyBankLoanPaymentResult {
  readonly paymentCents: Cents;
  readonly principalCents: Cents;
  readonly interestCents: Cents;
  readonly closingPrincipalCents: Cents;
  readonly isFinalPayment: boolean;
}

/**
 * Pure deterministic calculation for the NEXT fixed payment on a legacy bank loan.
 *
 * Implements approved A2/A3 prototype rules:
 * - quarterly rate = annualRateBps / 40000
 * - interest = round_half_up(outstandingPrincipal * quarterlyRate)
 * - non-amortizing check: if scheduled payment <= interest, reject.
 * - if normal principal reduction (scheduled - interest) >= outstandingPrincipal:
 *     principal = outstandingPrincipal
 *     payment = principal + interest
 *     closingPrincipal = 0
 *     isFinalPayment = true
 * - otherwise:
 *     principal = scheduled - interest
 *     payment = scheduled
 *     closingPrincipal = outstandingPrincipal - principal
 *     isFinalPayment = false
 */
export function calculateLegacyBankLoanNextPayment(
  input: CalculateLegacyBankLoanPaymentInput,
): LegacyBankLoanPaymentResult {
  const {
    outstandingPrincipalCents,
    annualRateBps,
    scheduledQuarterlyPaymentCents,
  } = input;

  if (
    !Number.isSafeInteger(outstandingPrincipalCents) ||
    outstandingPrincipalCents <= 0 ||
    outstandingPrincipalCents > Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError(
      `outstandingPrincipalCents must be a positive safe integer of cents, got ${String(outstandingPrincipalCents)}`,
    );
  }

  if (
    !Number.isSafeInteger(annualRateBps) ||
    annualRateBps < 0 ||
    annualRateBps > Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError(
      `annualRateBps must be a non-negative safe integer of basis points, got ${String(annualRateBps)}`,
    );
  }

  if (
    !Number.isSafeInteger(scheduledQuarterlyPaymentCents) ||
    scheduledQuarterlyPaymentCents <= 0 ||
    scheduledQuarterlyPaymentCents > Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError(
      `scheduledQuarterlyPaymentCents must be a positive safe integer of cents, got ${String(scheduledQuarterlyPaymentCents)}`,
    );
  }

  const quarterlyRate = new FinanceDecimal(annualRateBps).dividedBy(40000);
  const interestDecimal = new FinanceDecimal(outstandingPrincipalCents).times(
    quarterlyRate,
  );
  const interestComp = interestDecimal.round().toNumber();

  if (!Number.isSafeInteger(interestComp)) {
    throw new RangeError("Interest component exceeded safe integer range");
  }

  if (scheduledQuarterlyPaymentCents <= interestComp) {
    throw new RangeError(
      `Non-amortizing loan terms: scheduled payment (${scheduledQuarterlyPaymentCents}) <= interest (${interestComp})`,
    );
  }

  const normalPrincipalComp = scheduledQuarterlyPaymentCents - interestComp;

  if (normalPrincipalComp >= outstandingPrincipalCents) {
    // Final payment: absorb remaining principal and cleanup residue
    const finalPrincipal = outstandingPrincipalCents;
    const finalPayment = finalPrincipal + interestComp;

    if (!Number.isSafeInteger(finalPayment)) {
      throw new RangeError("Final payment exceeded safe integer range");
    }

    return {
      paymentCents: cents(finalPayment),
      principalCents: cents(finalPrincipal),
      interestCents: nonNegativeCents(interestComp),
      closingPrincipalCents: cents(0),
      isFinalPayment: true,
    };
  }

  const closingPrincipal = outstandingPrincipalCents - normalPrincipalComp;

  return {
    paymentCents: cents(scheduledQuarterlyPaymentCents),
    principalCents: cents(normalPrincipalComp),
    interestCents: nonNegativeCents(interestComp),
    closingPrincipalCents: cents(closingPrincipal),
    isFinalPayment: false,
  };
}
