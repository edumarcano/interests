import type {
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
} from "@interests/shared";
import React, { useState } from "react";

interface Props {
  match: MatchPlayerView;
  isHost: boolean;
  isPaused: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}

export const RoundStartView: React.FC<Props> = ({
  match,
  isHost,
  isPaused,
  onSendCommand,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const round = match.round;
  const spotlightOrder = round?.spotlightOrder ?? [];

  // Map player names in spotlight order
  const playerMap = new Map(match.players.map((p) => [p.playerId, p]));

  const handleBeginRound = async () => {
    if (!isHost || isPaused || submitting) return;
    try {
      setSubmitting(true);
      setError(null);
      const res = await onSendCommand({
        type: "BEGIN_ROUND",
      });
      if (!res.ok) {
        setError(res.error.message || "Failed to begin round");
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
      data-testid="round-start-view"
    >
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <span
          style={{
            fontSize: "0.85rem",
            color: "var(--accent-gold)",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Round Overview
        </span>
        <h2
          style={{ fontSize: "2rem", marginTop: "0.25rem", fontWeight: 700 }}
          data-testid="quarter-heading"
        >
          Quarter {match.currentQuarter}
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
          All objectives have been chosen. The board is ready to begin the
          quarter.
        </p>
      </div>

      {error && (
        <div
          className="error-banner"
          role="alert"
          data-testid="round-start-error-banner"
        >
          {error}
        </div>
      )}

      <div style={{ marginBottom: "2rem" }}>
        <h3
          style={{
            fontSize: "1rem",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: "0.75rem",
          }}
        >
          Spotlight Turn Order
        </h3>
        <div className="grid-4">
          {spotlightOrder.map((pId, idx) => {
            const player = playerMap.get(pId);
            const isSelf = pId === match.self.playerId;
            return (
              <div
                key={pId}
                className="seat-card"
                style={{
                  borderLeft: `4px solid ${
                    idx === 0 ? "var(--accent-gold)" : "var(--border-subtle)"
                  }`,
                }}
                data-testid={`spotlight-order-${idx}`}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontWeight: 600,
                  }}
                >
                  TURN {idx + 1}
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "1.05rem",
                    color: "var(--text-primary)",
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
          gap: "0.75rem",
          paddingTop: "1.5rem",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        {isHost ? (
          <button
            type="button"
            className="btn-gold"
            onClick={handleBeginRound}
            disabled={isPaused || submitting}
            style={{ minWidth: 200 }}
            id="begin-round-btn"
            data-testid="begin-round-btn"
          >
            {submitting
              ? "Starting..."
              : error
                ? "Retry Begin Round"
                : "Begin Round"}
          </button>
        ) : (
          <p
            style={{
              fontSize: "0.95rem",
              color: "var(--text-secondary)",
              fontStyle: "italic",
            }}
            data-testid="waiting-for-host-round-msg"
          >
            Waiting for host to begin round...
          </p>
        )}
      </div>
    </div>
  );
};
