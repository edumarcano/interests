import type {
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
} from "@interests/shared";
import type React from "react";
import { useState } from "react";
import { BusinessAuctionPanel } from "./BusinessAuctionPanel";
import { BusinessCapitalPanel } from "./BusinessCapitalPanel";
import { BusinessEquityPanel } from "./BusinessEquityPanel";
import { BusinessLendingPanel } from "./BusinessLendingPanel";
import { EconomicConditionsSummary } from "./EconomicConditionsSummary.js";
import { OpportunityCard } from "./OpportunityCard.js";
import { PropertyPanel } from "./PropertyPanel.js";
import { PublicMarketsPanel } from "./PublicMarketsPanel.js";
import { SelfFinanceSummary } from "./SelfFinanceSummary.js";
import { TransactionPanel } from "./TransactionPanel.js";

interface Props {
  roomCode?: string;
  match: MatchPlayerView;
  isPaused: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}

export const SpotlightView: React.FC<Props> = ({
  roomCode,
  match,
  isPaused,
  onSendCommand,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const round = match.round;
  const activeSpotlightPlayerId = round?.activeSpotlightPlayerId;
  const isMySpotlight = activeSpotlightPlayerId === match.self.playerId;
  const spotlightsCompleted = round?.spotlightsCompleted ?? 0;
  const totalSpotlights = round?.spotlightOrder.length ?? 4;

  const playerMap = new Map(match.players.map((p) => [p.playerId, p]));
  const activePlayer = activeSpotlightPlayerId
    ? playerMap.get(activeSpotlightPlayerId)
    : undefined;

  const handlePassSpotlight = async () => {
    if (!isMySpotlight || isPaused || submitting) return;
    try {
      setSubmitting(true);
      setError(null);
      const res = await onSendCommand({
        type: "PASS_SPOTLIGHT",
      });
      if (!res.ok) {
        setError(res.error.message || "Failed to pass spotlight");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to submit command");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="card"
      style={{ width: "100%", maxWidth: 880, margin: "0 auto" }}
      data-testid="spotlight-view"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <span
            style={{
              fontSize: "0.85rem",
              color: "var(--accent-gold)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Quarter {match.currentQuarter}
          </span>
          <h2
            style={{
              fontSize: "1.75rem",
              marginTop: "0.2rem",
              fontWeight: 700,
            }}
          >
            Spotlight Phase
          </h2>
        </div>

        <div
          style={{
            padding: "0.4rem 0.8rem",
            background: "var(--bg-surface-elevated)",
            borderRadius: "var(--radius-full)",
            border: "1px solid var(--border-subtle)",
            fontSize: "0.85rem",
            fontWeight: 600,
          }}
          data-testid="spotlights-counter"
        >
          Spotlight {Math.min(spotlightsCompleted + 1, totalSpotlights)} of{" "}
          {totalSpotlights}
        </div>
      </div>

      {error && (
        <div
          className="error-banner"
          role="alert"
          data-testid="spotlight-error-banner"
        >
          {error}
        </div>
      )}

      {/* Self Finances Summary */}
      <EconomicConditionsSummary conditions={match.economicConditions} />
      <SelfFinanceSummary self={match.self} />
      <BusinessAuctionPanel
        match={match}
        isPaused={isPaused}
        onSendCommand={onSendCommand}
      />
      <BusinessCapitalPanel
        match={match}
        isPaused={isPaused}
        onSendCommand={onSendCommand}
      />
      {match.businessLoanInvitation && (
        <BusinessLendingPanel
          key={match.businessLoanInvitation.transactionId}
          invitation={match.businessLoanInvitation}
          match={match}
          isPaused={isPaused}
          onSendCommand={onSendCommand}
        />
      )}
      {match.businessEquityInvitation && (
        <BusinessEquityPanel
          key={match.businessEquityInvitation.transactionId}
          invitation={match.businessEquityInvitation}
          match={match}
          isPaused={isPaused}
          onSendCommand={onSendCommand}
        />
      )}

      {roomCode && (
        <PublicMarketsPanel
          roomCode={roomCode}
          match={match}
          isPaused={isPaused}
          onSendCommand={onSendCommand}
        />
      )}

      {/* Private Opportunity Card (Target Buyer, unpursued or investigating) */}
      {match.self.opportunity &&
        !match.hasActiveTransaction &&
        !match.activeTransaction &&
        !match.businessCapital &&
        !match.businessAuction && (
          <OpportunityCard
            opportunity={match.self.opportunity}
            isPaused={isPaused}
            onSendCommand={onSendCommand}
          />
        )}

      <PropertyPanel
        match={match}
        isPaused={isPaused}
        onSendCommand={onSendCommand}
      />

      {/* Transaction & Pursuit Panel */}
      <TransactionPanel
        match={match}
        opportunity={match.self.opportunity}
        isPaused={isPaused}
        onSendCommand={onSendCommand}
      />

      <div style={{ marginBottom: "2rem" }}>
        <div className="grid-4">
          {round?.spotlightOrder.map((pId, idx) => {
            const player = playerMap.get(pId);
            const isActive = pId === activeSpotlightPlayerId;
            const isCompleted = idx < spotlightsCompleted;
            const isSelf = pId === match.self.playerId;

            return (
              <div
                key={pId}
                className={`seat-card ${isActive ? "seat-active" : ""}`}
                style={{
                  opacity: isCompleted ? 0.6 : 1,
                  border: isActive
                    ? "2px solid var(--accent-gold)"
                    : "1px solid var(--border-subtle)",
                }}
                data-testid={`spotlight-seat-${pId}`}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    SPOTLIGHT {idx + 1}
                  </span>
                  {isActive && (
                    <span
                      className="badge"
                      style={{
                        background: "rgba(245, 158, 11, 0.2)",
                        color: "var(--accent-gold)",
                      }}
                      data-testid="active-spotlight-badge"
                    >
                      Active
                    </span>
                  )}
                  {isCompleted && (
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--accent-emerald)",
                        fontWeight: 600,
                      }}
                    >
                      ✓ Done
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "1.05rem",
                    marginTop: "0.25rem",
                  }}
                >
                  {player?.nickname ?? pId} {isSelf && "(You)"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1rem",
          paddingTop: "1.5rem",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        {isMySpotlight ? (
          <div style={{ textAlign: "center" }}>
            <p
              style={{
                fontSize: "1.1rem",
                fontWeight: 600,
                color: "var(--accent-gold)",
                marginBottom: "1rem",
              }}
            >
              It's your spotlight!
            </p>
            {!match.hasActiveTransaction &&
              !match.activeTransaction &&
              !match.businessCapital &&
              !match.businessAuction && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handlePassSpotlight}
                  disabled={isPaused || submitting}
                  style={{
                    minWidth: 200,
                    fontSize: "1.05rem",
                    padding: "0.8rem 2rem",
                  }}
                  id="pass-spotlight-btn"
                  data-testid="pass-spotlight-btn"
                >
                  {submitting
                    ? "Passing..."
                    : error
                      ? "Retry Pass Spotlight"
                      : "Pass Spotlight"}
                </button>
              )}
          </div>
        ) : (
          <p
            style={{
              fontSize: "1.05rem",
              color: "var(--text-secondary)",
              fontStyle: "italic",
            }}
            data-testid="waiting-for-spotlight-player-msg"
          >
            Waiting for {activePlayer?.nickname ?? "active player"} to complete
            spotlight...
          </p>
        )}
      </div>
    </div>
  );
};
