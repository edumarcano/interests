import type {
  ActiveTransactionSummaryView,
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
  PrivateOpportunityView,
} from "@interests/shared";
import type React from "react";
import { useState } from "react";

interface Props {
  match: MatchPlayerView;
  opportunity?: PrivateOpportunityView | null;
  isPaused: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}

export const TransactionPanel: React.FC<Props> = ({
  match,
  opportunity,
  isPaused,
  onSendCommand,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Financed pursuit form state (buyer)
  const askingPrice = opportunity?.askingPriceCents ?? 5_000_000;
  const defaultContribution = Math.min(
    3_000_000,
    Math.max(1, match.self.availableCashCents),
  );
  const [buyerContributionCents, setBuyerContributionCents] =
    useState<number>(defaultContribution);
  const [showFinancingForm, setShowFinancingForm] = useState(false);

  // Lender offer form state
  const [annualRateBps, setAnnualRateBps] = useState<number>(1000);
  const [termQuarters, setTermQuarters] = useState<number>(3);

  const activeTx = match.activeTransaction;
  const self = match.self;
  const isMySpotlight =
    match.round?.stage === "spotlight" &&
    match.round?.activeSpotlightPlayerId === self.playerId;

  const formatCents = (amount: number): string =>
    `$${(amount / 100).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;

  const formatBps = (bps: number): string => {
    const percent = (bps / 100).toFixed(2);
    return `${bps} bps (${percent}%)`;
  };

  const handleCommand = async (command: PlayerCommand, errorMsg: string) => {
    if (isPaused || submitting) return;
    try {
      setSubmitting(true);
      setError(null);
      const res = await onSendCommand(command);
      if (!res.ok) {
        setError(res.error.message || errorMsg);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to submit command");
    } finally {
      setSubmitting(false);
    }
  };

  // --- BUYER PURSUIT (Before active transaction) ---
  if (!activeTx) {
    if (match.hasActiveTransaction) return null;
    if (!opportunity || opportunity.status !== "available" || !isMySpotlight) {
      return null;
    }

    const canAffordCash =
      self.availableCashCents >= opportunity.askingPriceCents;
    const requestedPrincipalCents =
      opportunity.askingPriceCents - buyerContributionCents;
    const canAffordContribution =
      self.availableCashCents >= buyerContributionCents;

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
        data-testid="pursuit-controls-panel"
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
          Acquisition Options (Your Turn)
        </div>

        {error && (
          <div
            className="error-banner"
            role="alert"
            style={{ marginBottom: "1rem" }}
            data-testid="transaction-error-banner"
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Cash Purchase Option */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.75rem",
              background: "var(--bg-surface)",
              padding: "1rem",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                100% Cash Acquisition
              </div>
              <div
                style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}
              >
                Pay full asking price (
                {formatCents(opportunity.askingPriceCents)}) from available
                cash.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={isPaused || submitting || !canAffordCash}
              onClick={() =>
                handleCommand(
                  {
                    type: "PURSUE_BUSINESS_CASH",
                    opportunityId: opportunity.id,
                  },
                  "Failed to initiate cash purchase",
                )
              }
              style={{ minHeight: 44 }}
              data-testid="buy-with-cash-btn"
            >
              {submitting ? "Processing..." : "Buy with Cash"}
            </button>
          </div>

          {/* Financed Purchase Option */}
          <div
            style={{
              background: "var(--bg-surface)",
              padding: "1rem",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "0.75rem",
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                  Player-Financed Acquisition
                </div>
                <div
                  style={{
                    color: "var(--text-secondary)",
                    fontSize: "0.85rem",
                  }}
                >
                  Contribute part in cash and request a loan from other players
                  for the rest.
                </div>
              </div>
              {!showFinancingForm && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isPaused || submitting}
                  onClick={() => setShowFinancingForm(true)}
                  style={{ minHeight: 44 }}
                  data-testid="open-financing-form-btn"
                >
                  Use Player Financing
                </button>
              )}
            </div>

            {showFinancingForm && (
              <div
                style={{
                  marginTop: "1rem",
                  paddingTop: "1rem",
                  borderTop: "1px solid var(--border-subtle)",
                }}
                data-testid="financing-request-form"
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "1rem",
                    marginBottom: "1rem",
                  }}
                >
                  <div>
                    <label
                      htmlFor="buyer-cash-contribution"
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        color: "var(--text-muted)",
                        marginBottom: "0.3rem",
                      }}
                    >
                      Your Cash Contribution ($)
                    </label>
                    <input
                      id="buyer-cash-contribution"
                      type="number"
                      step="1000"
                      min="0"
                      max={opportunity.askingPriceCents / 100}
                      value={buyerContributionCents / 100}
                      onChange={(e) => {
                        const dollars = Math.floor(Number(e.target.value) || 0);
                        const centsVal = Math.max(
                          0,
                          Math.min(dollars * 100, opportunity.askingPriceCents),
                        );
                        setBuyerContributionCents(centsVal);
                      }}
                      style={{
                        width: "100%",
                        padding: "0.5rem",
                        background: "var(--bg-surface-elevated)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-primary)",
                        minHeight: 44,
                        fontSize: "1rem",
                      }}
                      data-testid="buyer-contribution-input"
                    />
                  </div>

                  <div>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-muted)",
                        marginBottom: "0.3rem",
                      }}
                    >
                      Requested Loan Principal
                    </div>
                    <div
                      style={{
                        padding: "0.6rem 0.5rem",
                        fontSize: "1.1rem",
                        fontWeight: 700,
                        color: "var(--accent-gold)",
                      }}
                      data-testid="derived-requested-principal"
                    >
                      {formatCents(requestedPrincipalCents)}
                    </div>
                  </div>
                </div>

                {!canAffordContribution && (
                  <div
                    style={{
                      color: "var(--accent-red, #ef4444)",
                      fontSize: "0.85rem",
                      marginBottom: "0.75rem",
                    }}
                  >
                    Contribution exceeds available cash (
                    {formatCents(self.availableCashCents)}).
                  </div>
                )}
                {requestedPrincipalCents <= 0 && (
                  <div
                    style={{
                      color: "var(--accent-red, #ef4444)",
                      fontSize: "0.85rem",
                      marginBottom: "0.75rem",
                    }}
                  >
                    Requested loan principal must be greater than $0.
                  </div>
                )}

                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      isPaused ||
                      submitting ||
                      !canAffordContribution ||
                      requestedPrincipalCents <= 0
                    }
                    onClick={() =>
                      handleCommand(
                        {
                          type: "PURSUE_BUSINESS_WITH_PLAYER_LOAN",
                          opportunityId: opportunity.id,
                          buyerCashContributionCents: buyerContributionCents,
                          requestedPrincipalCents,
                        },
                        "Failed to request financing",
                      )
                    }
                    style={{ minHeight: 44 }}
                    data-testid="submit-financing-request-btn"
                  >
                    {submitting ? "Submitting..." : "Submit Financing Request"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowFinancingForm(false)}
                    style={{ minHeight: 44 }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- ACTIVE TRANSACTION VIEW ---
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
      data-testid="transaction-panel"
    >
      <div
        data-testid="active-transaction-panel"
        style={{ display: "contents" }}
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
            Major Transaction in Progress
          </span>
          <span
            style={{
              fontSize: "0.8rem",
              padding: "0.2rem 0.6rem",
              borderRadius: "var(--radius-full)",
              background: "rgba(245, 158, 11, 0.15)",
              color: "var(--accent-gold)",
              fontWeight: 600,
            }}
            data-testid="tx-status-badge"
          >
            {activeTx.isFinanced ? "Financed Purchase" : "Cash Purchase"}
          </span>
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <h3
            style={{
              fontSize: "1.2rem",
              fontWeight: 700,
              margin: "0 0 0.5rem 0",
            }}
          >
            Business Acquisition Deal
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: "0.75rem",
              fontSize: "0.9rem",
            }}
          >
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                Buyer
              </div>
              <div style={{ fontWeight: 600 }} data-testid="tx-buyer-name">
                {activeTx.buyerNickname}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                Seller
              </div>
              <div style={{ fontWeight: 600 }} data-testid="tx-seller-name">
                {activeTx.sellerNickname}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                Purchase Price
              </div>
              <div style={{ fontWeight: 700 }} data-testid="tx-purchase-price">
                {formatCents(activeTx.purchasePriceCents)}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div
            className="error-banner"
            role="alert"
            style={{ marginBottom: "1rem" }}
            data-testid="active-tx-error-banner"
          >
            {error}
          </div>
        )}

        {/* --- BUYER ROLE VIEW --- */}
        {activeTx.role === "buyer" && (
          <div
            style={{
              background: "var(--bg-surface)",
              borderRadius: "var(--radius-md)",
              padding: "1rem",
              border: "1px solid var(--border-subtle)",
            }}
            data-testid="buyer-controls-section"
          >
            {!activeTx.isFinanced ? (
              // Cash Buyer
              <div>
                <p
                  style={{
                    fontSize: "0.9rem",
                    color: "var(--text-secondary)",
                    marginBottom: "1rem",
                  }}
                >
                  Purchase cash ({formatCents(activeTx.purchasePriceCents)}) is
                  reserved. You may complete the acquisition or cancel the deal.
                </p>
                <div
                  style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}
                >
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={isPaused || submitting}
                    onClick={() =>
                      handleCommand(
                        {
                          type: "CLOSE_BUSINESS_PURCHASE",
                          transactionId: activeTx.transactionId,
                        },
                        "Failed to complete purchase",
                      )
                    }
                    style={{ minHeight: 44 }}
                    data-testid="complete-purchase-btn"
                  >
                    {submitting ? "Closing..." : "Complete Purchase"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={isPaused || submitting}
                    onClick={() =>
                      handleCommand(
                        {
                          type: "CANCEL_ACTIVE_TRANSACTION",
                          transactionId: activeTx.transactionId,
                        },
                        "Failed to cancel deal",
                      )
                    }
                    style={{ minHeight: 44 }}
                    data-testid="cancel-deal-btn"
                  >
                    {submitting ? "Cancelling..." : "Cancel Deal"}
                  </button>
                </div>
              </div>
            ) : (
              // Financed Buyer
              <div>
                <div style={{ marginBottom: "1rem" }}>
                  <div
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Your Reserved Contribution:{" "}
                    <strong>
                      {formatCents(activeTx.buyerContributionCents ?? 0)}
                    </strong>
                  </div>
                  <div
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Requested Loan Principal:{" "}
                    <strong>
                      {formatCents(activeTx.requestedPrincipalCents ?? 0)}
                    </strong>
                  </div>
                </div>

                {activeTx.financingStatus === "waiting-for-offer" && (
                  <div>
                    <p
                      style={{
                        fontSize: "0.9rem",
                        color: "var(--text-muted)",
                        marginBottom: "1rem",
                      }}
                      data-testid="waiting-for-lender-msg"
                    >
                      Waiting for an eligible player to submit a loan financing
                      offer...
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={isPaused || submitting}
                      onClick={() =>
                        handleCommand(
                          {
                            type: "CANCEL_ACTIVE_TRANSACTION",
                            transactionId: activeTx.transactionId,
                          },
                          "Failed to cancel deal",
                        )
                      }
                      style={{ minHeight: 44 }}
                      data-testid="cancel-deal-btn"
                    >
                      Cancel Deal
                    </button>
                  </div>
                )}

                {activeTx.financingStatus === "offer-submitted" &&
                  activeTx.offer && (
                    <div data-testid="offer-details-section">
                      <div
                        style={{
                          background: "var(--bg-surface-elevated)",
                          padding: "0.75rem",
                          borderRadius: "var(--radius-sm)",
                          marginBottom: "1rem",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "0.9rem",
                            marginBottom: "0.3rem",
                          }}
                        >
                          Offer Received from {activeTx.offer.lenderNickname}
                        </div>
                        <div
                          style={{
                            fontSize: "0.85rem",
                            color: "var(--text-secondary)",
                          }}
                        >
                          Principal:{" "}
                          {formatCents(activeTx.offer.principalCents)} | Rate:{" "}
                          {formatBps(activeTx.offer.annualRateBps)} | Term:{" "}
                          {activeTx.offer.termQuarters} quarters (rev{" "}
                          {activeTx.offer.termsRevision})
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: "0.75rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={isPaused || submitting}
                          onClick={() =>
                            handleCommand(
                              {
                                type: "ACCEPT_PLAYER_LOAN_OFFER",
                                transactionId: activeTx.transactionId,
                                expectedTermsRevision:
                                  activeTx.offer!.termsRevision,
                              },
                              "Failed to accept loan offer",
                            )
                          }
                          style={{ minHeight: 44 }}
                          data-testid="accept-offer-btn"
                        >
                          {submitting ? "Accepting..." : "Accept Offer"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={isPaused || submitting}
                          onClick={() =>
                            handleCommand(
                              {
                                type: "CANCEL_ACTIVE_TRANSACTION",
                                transactionId: activeTx.transactionId,
                              },
                              "Failed to cancel deal",
                            )
                          }
                          style={{ minHeight: 44 }}
                          data-testid="cancel-deal-btn"
                        >
                          Cancel Deal
                        </button>
                      </div>
                    </div>
                  )}

                {activeTx.financingStatus === "offer-accepted" &&
                  activeTx.offer && (
                    <div data-testid="offer-accepted-section">
                      <p
                        style={{
                          fontSize: "0.9rem",
                          color: "var(--accent-green, #10b981)",
                          fontWeight: 600,
                          marginBottom: "1rem",
                        }}
                      >
                        Offer from {activeTx.offer.lenderNickname} accepted!
                        Ready to complete purchase.
                      </p>
                      <div
                        style={{
                          display: "flex",
                          gap: "0.75rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={isPaused || submitting}
                          onClick={() =>
                            handleCommand(
                              {
                                type: "CLOSE_BUSINESS_PURCHASE",
                                transactionId: activeTx.transactionId,
                              },
                              "Failed to complete purchase",
                            )
                          }
                          style={{ minHeight: 44 }}
                          data-testid="complete-purchase-btn"
                        >
                          {submitting ? "Closing..." : "Complete Purchase"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={isPaused || submitting}
                          onClick={() =>
                            handleCommand(
                              {
                                type: "CANCEL_ACTIVE_TRANSACTION",
                                transactionId: activeTx.transactionId,
                              },
                              "Failed to cancel deal",
                            )
                          }
                          style={{ minHeight: 44 }}
                          data-testid="cancel-deal-btn"
                        >
                          Cancel Deal
                        </button>
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>
        )}

        {/* --- LENDER CANDIDATE ROLE VIEW --- */}
        {activeTx.role === "lender-candidate" && (
          <div
            style={{
              background: "var(--bg-surface)",
              borderRadius: "var(--radius-md)",
              padding: "1rem",
              border: "1px solid var(--border-subtle)",
            }}
            data-testid="lender-candidate-section"
          >
            {activeTx.hasExistingOffer ? (
              <p
                style={{
                  fontSize: "0.9rem",
                  color: "var(--text-muted)",
                  margin: 0,
                }}
                data-testid="financing-already-offered-msg"
              >
                A financing offer has already been submitted for this
                transaction.
              </p>
            ) : (
              <div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "0.95rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  Financing Opportunity
                </div>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--text-secondary)",
                    marginBottom: "1rem",
                  }}
                >
                  {activeTx.buyerNickname} has requested a{" "}
                  <strong>
                    {formatCents(activeTx.requestedPrincipalCents ?? 0)}
                  </strong>{" "}
                  loan. Your available cash:{" "}
                  <strong>{formatCents(self.availableCashCents)}</strong>.
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: "1rem",
                    marginBottom: "1rem",
                  }}
                >
                  <div>
                    <label
                      htmlFor="lender-rate-bps"
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        color: "var(--text-muted)",
                        marginBottom: "0.3rem",
                      }}
                    >
                      Annual Rate ({formatBps(annualRateBps)})
                    </label>
                    <input
                      id="lender-rate-bps"
                      type="number"
                      step="50"
                      min="0"
                      max="10000"
                      value={annualRateBps}
                      onChange={(e) =>
                        setAnnualRateBps(
                          Math.max(0, Number(e.target.value) || 0),
                        )
                      }
                      style={{
                        width: "100%",
                        padding: "0.5rem",
                        background: "var(--bg-surface-elevated)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-primary)",
                        minHeight: 44,
                        fontSize: "1rem",
                      }}
                      data-testid="lender-rate-input"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="lender-term-quarters"
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        color: "var(--text-muted)",
                        marginBottom: "0.3rem",
                      }}
                    >
                      Term (Quarters: 2-8)
                    </label>
                    <select
                      id="lender-term-quarters"
                      value={termQuarters}
                      onChange={(e) => setTermQuarters(Number(e.target.value))}
                      style={{
                        width: "100%",
                        padding: "0.5rem",
                        background: "var(--bg-surface-elevated)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-primary)",
                        minHeight: 44,
                        fontSize: "1rem",
                      }}
                      data-testid="lender-term-select"
                    >
                      {[2, 3, 4, 5, 6, 7, 8].map((q) => (
                        <option key={q} value={q}>
                          {q} quarters ({q / 4} years)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {self.availableCashCents <
                  (activeTx.requestedPrincipalCents ?? 0) && (
                  <div
                    style={{
                      color: "var(--accent-red, #ef4444)",
                      fontSize: "0.85rem",
                      marginBottom: "0.75rem",
                    }}
                  >
                    Insufficient available cash to fund this loan.
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    isPaused ||
                    submitting ||
                    self.availableCashCents <
                      (activeTx.requestedPrincipalCents ?? 0)
                  }
                  onClick={() =>
                    handleCommand(
                      {
                        type: "SUBMIT_PLAYER_LOAN_OFFER",
                        transactionId: activeTx.transactionId,
                        annualRateBps,
                        termQuarters,
                      },
                      "Failed to submit loan offer",
                    )
                  }
                  style={{ minHeight: 44 }}
                  data-testid="submit-lender-offer-btn"
                >
                  {submitting ? "Submitting Offer..." : "Offer Financing"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* --- LENDER (Submitted) ROLE VIEW --- */}
        {activeTx.role === "lender" && activeTx.offer && (
          <div
            style={{
              background: "var(--bg-surface)",
              borderRadius: "var(--radius-md)",
              padding: "1rem",
              border: "1px solid var(--border-subtle)",
            }}
            data-testid="lender-submitted-section"
          >
            <div
              style={{
                fontWeight: 600,
                fontSize: "0.95rem",
                marginBottom: "0.5rem",
              }}
            >
              Your Financing Offer
            </div>
            <p
              style={{
                fontSize: "0.85rem",
                color: "var(--text-secondary)",
                marginBottom: "0.5rem",
              }}
            >
              You offered {formatCents(activeTx.offer.principalCents)} at{" "}
              {formatBps(activeTx.offer.annualRateBps)} for{" "}
              {activeTx.offer.termQuarters} quarters.
            </p>
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--accent-gold)",
                fontWeight: 600,
              }}
              data-testid="lender-offer-status"
            >
              Status:{" "}
              {activeTx.offer.status === "offered"
                ? "Waiting for buyer acceptance"
                : "Accepted by buyer! Waiting for close."}
            </div>
          </div>
        )}

        {/* --- SELLER ROLE VIEW --- */}
        {activeTx.role === "seller" && (
          <div
            style={{
              background: "var(--bg-surface)",
              borderRadius: "var(--radius-md)",
              padding: "1rem",
              border: "1px solid var(--border-subtle)",
            }}
            data-testid="seller-status-section"
          >
            <div
              style={{
                fontWeight: 600,
                fontSize: "0.95rem",
                marginBottom: "0.5rem",
              }}
            >
              Sale in Progress
            </div>
            <p
              style={{
                fontSize: "0.85rem",
                color: "var(--text-secondary)",
                margin: 0,
              }}
            >
              {activeTx.buyerNickname} is purchasing your debt-free business for{" "}
              {formatCents(activeTx.purchasePriceCents)}.
              {activeTx.isFinanced &&
                ` Financing status: ${activeTx.financingStatus ?? "in progress"}.`}{" "}
              Proceeds will be transferred when the buyer completes the
              purchase.
            </p>
          </div>
        )}

        {/* --- UNINVOLVED ROLE VIEW --- */}
        {activeTx.role === "uninvolved" && (
          <div
            style={{
              background: "var(--bg-surface)",
              borderRadius: "var(--radius-md)",
              padding: "1rem",
              border: "1px solid var(--border-subtle)",
            }}
            data-testid="uninvolved-status-section"
          >
            <p
              style={{
                fontSize: "0.85rem",
                color: "var(--text-muted)",
                margin: 0,
              }}
            >
              {activeTx.buyerNickname} and {activeTx.sellerNickname} are
              negotiating an acquisition for{" "}
              {formatCents(activeTx.purchasePriceCents)}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
