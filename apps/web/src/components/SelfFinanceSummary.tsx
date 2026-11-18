import type { MatchSelfView } from "@interests/shared";
import type React from "react";

interface Props {
  self: MatchSelfView;
  isFinal?: boolean;
}

export const SelfFinanceSummary: React.FC<Props> = ({
  self,
  isFinal = false,
}) => {
  const formatCents = (amount: number): string =>
    `$${(amount / 100).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;

  const formatBps = (bps: number): string => `${(bps / 100).toFixed(2)}%`;

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-md)",
        padding: "1rem",
        border: "1px solid var(--border-subtle)",
        marginBottom: "1.5rem",
        width: "100%",
      }}
      data-testid="self-finance-summary"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div
          style={{
            fontSize: "0.8rem",
            fontWeight: 700,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Your Financial Position
          {self.profileId && (
            <span
              style={{
                marginLeft: "0.5rem",
                color: "var(--accent-gold)",
                fontWeight: 600,
                textTransform: "none",
              }}
              data-testid="self-profile-id"
            >
              ({self.profileId})
            </span>
          )}
        </div>
        {self.selectedObjectiveId && (
          <div
            style={{
              fontSize: "0.8rem",
              background: "var(--bg-surface-elevated)",
              padding: "0.2rem 0.5rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
            data-testid="self-selected-objective"
          >
            Objective: <strong>{self.selectedObjectiveId}</strong>
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: "0.75rem",
        }}
        data-testid="cash-summary-grid"
      >
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Total Cash
          </div>
          <div
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
            data-testid="self-total-cash"
          >
            {formatCents(self.cashCents)}
          </div>
        </div>

        <div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Reserved Cash
          </div>
          <div
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              color:
                self.reservedCashCents > 0
                  ? "var(--accent-gold)"
                  : "var(--text-muted)",
            }}
            data-testid="self-reserved-cash"
          >
            {formatCents(self.reservedCashCents)}
          </div>
        </div>

        <div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Available Cash
          </div>
          <div
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              color: "var(--accent-green, #10b981)",
            }}
            data-testid="self-available-cash"
          >
            {formatCents(self.availableCashCents)}
          </div>
        </div>
      </div>

      {/* Owned Business Assets */}
      {self.ownedAssets && self.ownedAssets.length > 0 && (
        <div
          style={{
            marginTop: "1rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "0.5rem",
            }}
          >
            Owned Business Assets
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
            data-testid="self-owned-assets-list"
          >
            {self.ownedAssets.map((asset) => (
              <div
                key={asset.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  overflowWrap: "anywhere",
                  fontSize: "0.85rem",
                  background: "var(--bg-surface-elevated)",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "var(--radius-sm)",
                }}
                data-testid={`owned-asset-${asset.id}`}
              >
                <span>
                  <strong>Business {asset.id}</strong> (
                  {(asset.ownershipPpm / 10000).toFixed(0)}% ownership)
                </span>
                <span style={{ color: "var(--text-secondary)" }}>
                  EV: {formatCents(asset.enterpriseValueCents)}
                  {asset.companyCashCents !== undefined && (
                    <>
                      <br />
                      Company cash: {formatCents(asset.companyCashCents)}
                    </>
                  )}
                  {asset.equityValueCents !== undefined && (
                    <>
                      <br />
                      Company equity: {formatCents(asset.equityValueCents)}
                    </>
                  )}
                  {asset.incomeTreatment === "work-and-ownership" &&
                  asset.payoutQuarter != null ? (
                    <>
                      <br />
                      Expected work pay Q{asset.payoutQuarter}:{" "}
                      {asset.expectedWorkPayCents == null
                        ? "unavailable"
                        : formatCents(asset.expectedWorkPayCents)}
                      <br />
                      Expected payout Q{asset.payoutQuarter}:{" "}
                      {asset.expectedPayoutCents == null
                        ? "unavailable"
                        : formatCents(asset.expectedPayoutCents)}
                    </>
                  ) : (
                    asset.payoutQuarter != null && (
                      <>
                        <br />
                        Expected payout Q{asset.payoutQuarter}:{" "}
                        {asset.expectedPayoutCents == null
                          ? "unavailable"
                          : formatCents(asset.expectedPayoutCents)}
                      </>
                    )
                  )}
                  {(asset.annualManagementCostCents ?? 0) > 0 && (
                    <>
                      <br />
                      External management:{" "}
                      {formatCents(asset.annualManagementCostCents ?? 0)} per
                      year
                    </>
                  )}
                  {(asset.workCompensationArrearsCents ?? 0) > 0 && (
                    <>
                      <br />
                      Unpaid work compensation:{" "}
                      {formatCents(asset.workCompensationArrearsCents ?? 0)}
                    </>
                  )}
                  {(asset.operatingArrearsCents ?? 0) > 0 && (
                    <>
                      <br />
                      Company operating arrears:{" "}
                      {formatCents(asset.operatingArrearsCents ?? 0)}
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {self.lastSettlement && (
        <section
          aria-label="Last quarter settlement"
          data-testid="last-settlement"
          style={{ marginTop: "1rem", overflowWrap: "anywhere" }}
        >
          <strong>Q{self.lastSettlement.quarter} settled</strong>
          {self.lastSettlement.workCompensation?.map((payment) => (
            <div
              key={payment.assetId}
              data-testid={`work-pay-${payment.assetId}`}
            >
              Company work pay: received {formatCents(payment.paidCents)} of{" "}
              {formatCents(payment.dueCents)} due
              {payment.unpaidCents > 0
                ? `; ${formatCents(payment.unpaidCents)} remains due`
                : ""}
              .
            </div>
          ))}
          {self.lastSettlement.businessDistributions?.map((payment) => (
            <div
              key={payment.assetId}
              data-testid={`business-payout-${payment.assetId}`}
            >
              Business {payment.assetId}: received{" "}
              {formatCents(payment.amountCents)}.
            </div>
          ))}
          <div>
            Living costs: {formatCents(self.lastSettlement.livingPaidCents)}{" "}
            paid of {formatCents(self.lastSettlement.livingDueCents)} due.
          </div>
          {(self.livingExpenseArrearsCents ?? 0) > 0 && (
            <div role="status">
              Unpaid living costs:{" "}
              {formatCents(self.livingExpenseArrearsCents ?? 0)}. They remain
              due in later quarters.
            </div>
          )}
          {self.lastSettlement.loanPayments.map((payment) => (
            <div
              key={payment.loanId}
              data-testid={`settled-loan-${payment.loanId}`}
            >
              {payment.role === "asset-borrower"
                ? "Asset loan"
                : payment.role === "company-borrower"
                  ? "Company loan"
                  : "Loan"}{" "}
              {payment.loanId}:{" "}
              {payment.role === "lender" ? "received" : "paid"}{" "}
              {formatCents(payment.paidCents)} of{" "}
              {formatCents(payment.dueCents)} due
              {payment.unpaidCents > 0 && (
                <>; {formatCents(payment.unpaidCents)} remains overdue</>
              )}
              .
            </div>
          ))}
          <small>
            {isFinal
              ? "Unpaid claims remain recorded in the final accounts."
              : "Missed payments remain due. Play continues and later settlements collect affordable amounts."}
          </small>
        </section>
      )}

      {/* Active Loans */}
      {self.loans && self.loans.length > 0 && (
        <div
          style={{
            marginTop: "1rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "0.5rem",
            }}
          >
            Loan Positions
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
            data-testid="self-loans-list"
          >
            {self.loans.map((loan) => (
              <div
                key={loan.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  overflowWrap: "anywhere",
                  fontSize: "0.85rem",
                  background: "var(--bg-surface-elevated)",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "var(--radius-sm)",
                }}
                data-testid={`loan-${loan.id}`}
              >
                <span>
                  <strong style={{ textTransform: "capitalize" }}>
                    {loan.role === "asset-borrower"
                      ? "Asset borrower"
                      : loan.role === "company-borrower"
                        ? "Company borrower"
                        : loan.role}
                  </strong>{" "}
                  ({loan.counterpartyNickname})
                </span>
                <span style={{ color: "var(--text-secondary)" }}>
                  {formatCents(loan.outstandingPrincipalCents)} @{" "}
                  {formatBps(loan.annualRateBps)}
                  {loan.amountDueCents !== undefined && (
                    <>
                      <br />
                      Due this quarter: {formatCents(loan.amountDueCents)}
                    </>
                  )}
                  {loan.status === "in-arrears" && (
                    <>
                      <br />
                      Overdue principal:{" "}
                      {formatCents(loan.pastDuePrincipalCents ?? 0)}; unpaid
                      interest: {formatCents(loan.unpaidInterestCents ?? 0)}
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
