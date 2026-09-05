import { Decimal } from "decimal.js";

/**
 * Centrally configured Decimal constructor for financial calculations.
 *
 * Configured with:
 * - 40 significant digits of precision
 * - ROUND_HALF_UP rounding mode
 *
 * This uses Decimal.clone() so the global Decimal configuration is untouched.
 * Decimal instances must NEVER enter canonical GameState or JournalEntry.
 */
export const FinanceDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

export type FinanceDecimal = InstanceType<typeof FinanceDecimal>;
