// @vitest-environment happy-dom

import type { MatchSelfView, PlayerId } from "@interests/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SelfFinanceSummary } from "../src/components/SelfFinanceSummary";

afterEach(cleanup);
const self: MatchSelfView = {
  playerId: "self" as PlayerId,
  profileId: "small-business-owner",
  offeredObjectiveIds: ["founder", "independent"],
  selectedObjectiveId: "founder",
  cashCents: 0,
  reservedCashCents: 0,
  availableCashCents: 0,
  livingExpenseArrearsCents: 12_345,
  loans: [
    {
      id: "loan-1",
      kind: "player-loan",
      role: "borrower",
      counterpartyNickname: "Lender",
      originalPrincipalCents: 100_000,
      outstandingPrincipalCents: 100_000,
      annualRateBps: 1_000,
      status: "in-arrears",
      amountDueCents: 102_500,
      pastDuePrincipalCents: 50_000,
      unpaidInterestCents: 2_500,
    },
  ],
  lastSettlement: {
    quarter: 3,
    livingDueCents: 40_000,
    livingPaidCents: 27_655,
    livingArrearsCents: 12_345,
    loanPayments: [
      {
        loanId: "loan-1",
        role: "borrower",
        dueCents: 52_500,
        paidCents: 0,
        principalPaidCents: 0,
        interestPaidCents: 0,
        unpaidCents: 52_500,
      },
    ],
  },
};
it("explains a zero payment and unpaid living costs while showing that the quarter advanced", () => {
  render(<SelfFinanceSummary self={self} />);
  expect(screen.getByTestId("last-settlement").textContent).toContain(
    "Q3 settled",
  );
  expect(screen.getByRole("status").textContent).toContain("$123.45");
  expect(screen.getByTestId("settled-loan-loan-1").textContent).toContain(
    "paid $0 of $525 due; $525 remains overdue",
  );
  expect(screen.getByTestId("last-settlement").textContent).toContain(
    "Play continues",
  );
  expect(screen.getByTestId("loan-loan-1").textContent).toContain(
    "Due this quarter: $1,025",
  );
});
it("describes the lender's own missed receipt without showing the debtor's living budget", () => {
  render(
    <SelfFinanceSummary
      self={{
        ...self,
        livingExpenseArrearsCents: 0,
        loans: [],
        lastSettlement: {
          quarter: 3,
          livingDueCents: 0,
          livingPaidCents: 0,
          livingArrearsCents: 0,
          loanPayments: [
            {
              loanId: "loan-1",
              role: "lender",
              dueCents: 52_500,
              paidCents: 0,
              principalPaidCents: 0,
              interestPaidCents: 0,
              unpaidCents: 52_500,
            },
          ],
        },
      }}
    />,
  );
  expect(screen.getByTestId("settled-loan-loan-1").textContent).toContain(
    "received $0 of $525 due",
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByTestId("last-settlement").textContent).not.toContain(
    "$123.45",
  );
});
