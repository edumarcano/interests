import type { LoanId, PlayerId } from "@interests/shared";
import type { FinanceState, PropertyAsset } from "../model/gameState";
import {
  externalCashAccount,
  playerCashAccount,
  propertyCashAccount,
} from "./account";
import { allocateWeightedCents } from "./allocation";
import { isAssetBorrower } from "./bank";
import { type Cents, cents } from "./money";
import {
  applyLoanPaymentAllocation,
  calculateLoanObligation,
  type LoanPaymentOutcome,
} from "./obligations";
import { allocateProportionalCents } from "./ownership";
import type { CashPostingRequest } from "./posting";
import { calculatePropertyCashFlow } from "./property";

export function planPropertySettlement(
  asset: PropertyAsset,
  basis: PropertyAsset,
  quarter: number,
  loans: FinanceState["loansById"],
) {
  const noi = calculatePropertyCashFlow(basis).netOperatingIncomeCents;
  let cash = cents((asset.cashCents ?? 0) + noi);
  const postings: CashPostingRequest[] = [];
  const updatedLoans: Record<LoanId, FinanceState["loansById"][LoanId]> = {};
  const loanPayments: LoanPaymentOutcome[] = [];
  const pay = (
    amountCents: Cents,
    destination: CashPostingRequest["destination"],
    reason: string,
    extra: Partial<CashPostingRequest> = {},
  ) => {
    if (!amountCents) return;
    cash = cents(cash - amountCents);
    postings.push({
      source: propertyCashAccount(asset.id),
      destination,
      amountCents,
      reason,
      quarter,
      relatedAssetId: asset.id,
      ...extra,
    });
  };
  if (noi)
    postings.push({
      source: externalCashAccount("property-operating-cashflow"),
      destination: propertyCashAccount(asset.id),
      amountCents: noi,
      reason: "property-operating-cashflow",
      quarter,
      relatedAssetId: asset.id,
    });
  const due = Object.values(loans)
    .filter(
      (loan) =>
        loan.kind === "asset-bank-loan" && loan.borrowerAssetId === asset.id,
    )
    .map((loan) => ({
      loan,
      obligation: calculateLoanObligation(loan, quarter),
    }))
    .filter((row) => row.obligation !== null)
    .sort((a, b) => a.loan.id.localeCompare(b.loan.id));
  const total = cents(
    due.reduce((sum, row) => sum + row.obligation!.amountDueCents, 0),
  );
  const allocation = allocateWeightedCents(
    cents(Math.min(total, cash)),
    Object.fromEntries(
      due.map((row) => [row.loan.id, row.obligation!.amountDueCents]),
    ),
  );
  let debtPaid = 0;
  for (const row of due) {
    if (!isAssetBorrower(row.loan))
      throw new Error("Invalid property borrower");
    const applied = applyLoanPaymentAllocation(
      row.loan,
      row.obligation!,
      allocation[row.loan.id]!,
      quarter,
    );
    updatedLoans[row.loan.id] = applied.loan;
    loanPayments.push(applied.outcome);
    debtPaid = cents(debtPaid + applied.outcome.paidCents);
    pay(
      applied.outcome.paidCents,
      externalCashAccount("bank"),
      "asset-bank-loan-payment",
      {
        relatedLoanId: row.loan.id,
        loanPayment: {
          principalCents: applied.outcome.principalPaidCents,
          interestCents: applied.outcome.interestPaidCents,
        },
      },
    );
  }
  const overdue = Object.values(updatedLoans).some(
    (loan) => loan.pastDuePrincipalCents > 0 || loan.unpaidInterestCents > 0,
  );
  const payout = cents(
    overdue
      ? 0
      : Math.min(
          Math.max(0, noi - debtPaid),
          Math.max(0, cash - (asset.debtServiceReserveCents ?? 0)),
        ),
  );
  const distributions = allocateProportionalCents(
    payout,
    basis.ownershipByPlayerPpm,
  );
  for (const playerId of (Object.keys(distributions) as PlayerId[]).sort())
    pay(
      distributions[playerId]!,
      playerCashAccount(playerId),
      "property-operating-distribution",
    );
  return { postings, loansById: updatedLoans, loanPayments };
}
