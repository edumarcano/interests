import type {
  CommandAckResult,
  PlayerCommand,
  PrivateOpportunityView,
} from "@interests/shared";
import type React from "react";
import { useState } from "react";

interface Props {
  opportunity: PrivateOpportunityView;
  isPaused: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}

export const OpportunityCard: React.FC<Props> = ({
  opportunity,
  isPaused,
  onSendCommand,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatCents = (amount: number): string =>
    `$${(amount / 100).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;

  const handleInvestigate = async () => {
    if (isPaused || submitting || opportunity.investigated) return;
    try {
      setSubmitting(true);
      setError(null);
      const res = await onSendCommand({
        type: "INVESTIGATE_OPPORTUNITY",
        opportunityId: opportunity.id,
      });
      if (!res.ok) {
        setError(res.error.message || "Failed to investigate opportunity");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to submit investigation command");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="card"
      style={{
        border: "1px solid var(--accent-gold)",
        background: "var(--bg-surface-elevated)",
        borderRadius: "var(--radius-lg)",
        padding: "1.25rem",
        marginBottom: "1.5rem",
        width: "100%",
      }}
      data-testid="private-opportunity-card"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "0.75rem",
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            color: "var(--accent-gold)",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Private Acquisition Opportunity
        </span>
        <span
          style={{
            fontSize: "0.8rem",
            padding: "0.2rem 0.6rem",
            borderRadius: "var(--radius-full)",
            background:
              opportunity.status === "available"
                ? "rgba(16, 185, 129, 0.15)"
                : "rgba(245, 158, 11, 0.15)",
            color:
              opportunity.status === "available"
                ? "var(--accent-green, #10b981)"
                : "var(--accent-gold)",
            fontWeight: 600,
            textTransform: "capitalize",
          }}
          data-testid="opportunity-status-badge"
        >
          {opportunity.status}
        </span>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <h3
          style={{
            fontSize: "1.2rem",
            fontWeight: 700,
            margin: "0 0 0.5rem 0",
          }}
          data-testid="opportunity-title"
        >
          Debt-Free Operating Business
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "0.75rem",
            fontSize: "0.9rem",
          }}
        >
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
              Asking Price
            </div>
            <div
              style={{
                fontSize: "1.25rem",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
              data-testid="opportunity-asking-price"
            >
              {formatCents(opportunity.askingPriceCents)}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
              Offered by
            </div>
            <div
              style={{ fontWeight: 600, color: "var(--text-primary)" }}
              data-testid="opportunity-seller-name"
            >
              {opportunity.sellerNickname}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div
          className="error-banner"
          role="alert"
          style={{ marginBottom: "1rem" }}
          data-testid="opportunity-error-banner"
        >
          {error}
        </div>
      )}

      {!opportunity.investigated ? (
        <div
          style={{
            background: "var(--bg-surface)",
            borderRadius: "var(--radius-md)",
            padding: "1rem",
            border: "1px dashed var(--border-subtle)",
          }}
          data-testid="diligence-unrevealed-section"
        >
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--text-secondary)",
              margin: "0 0 0.75rem 0",
            }}
          >
            Financial details, cash flows, and enterprise valuation are
            confidential until private due diligence is performed.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleInvestigate}
            disabled={isPaused || submitting}
            style={{ minHeight: 44, width: "100%" }}
            data-testid="investigate-opportunity-btn"
          >
            {submitting
              ? "Conducting Due Diligence..."
              : "Perform Due Diligence"}
          </button>
        </div>
      ) : (
        <div
          style={{
            background: "var(--bg-surface)",
            borderRadius: "var(--radius-md)",
            padding: "1rem",
            border: "1px solid var(--border-subtle)",
          }}
          data-testid="diligence-revealed-section"
        >
          <div
            style={{
              fontSize: "0.8rem",
              fontWeight: 700,
              color: "var(--accent-gold)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "0.75rem",
            }}
          >
            Due Diligence Findings
          </div>
          {opportunity.facts && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: "0.75rem",
              }}
              data-testid="diligence-facts-grid"
            >
              <div>
                <div
                  style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}
                >
                  Annual Revenue
                </div>
                <div
                  style={{ fontWeight: 600 }}
                  data-testid="fact-annual-revenue"
                >
                  {formatCents(opportunity.facts.annualRevenueCents)}
                </div>
              </div>
              <div>
                <div
                  style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}
                >
                  Operating Profit
                </div>
                <div
                  style={{ fontWeight: 600 }}
                  data-testid="fact-operating-profit"
                >
                  {formatCents(opportunity.facts.annualOperatingProfitCents)}
                </div>
              </div>
              <div>
                <div
                  style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}
                >
                  Enterprise Value
                </div>
                <div
                  style={{ fontWeight: 600 }}
                  data-testid="fact-enterprise-value"
                >
                  {formatCents(opportunity.facts.enterpriseValueCents)}
                </div>
              </div>
              <div>
                <div
                  style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}
                >
                  Existing Debt
                </div>
                <div
                  style={{ fontWeight: 600 }}
                  data-testid="fact-debt-principal"
                >
                  {formatCents(opportunity.facts.debtPrincipalCents)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
