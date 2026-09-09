import type {
  CommandAckResult,
  MatchPlayerView,
  PlayerCommand,
} from "@interests/shared";
import type React from "react";
import { useState } from "react";

interface Props {
  match: MatchPlayerView;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
}

export const ObjectiveSelection: React.FC<Props> = ({
  match,
  onSendCommand,
}) => {
  const self = match.self;
  const profileName = self.profile?.name ?? self.profileId;
  const offeredObjectives = self.offeredObjectives ?? [
    {
      id: self.offeredObjectiveIds[0] ?? "",
      name: self.offeredObjectiveIds[0] ?? "",
      family: "unknown",
    },
    {
      id: self.offeredObjectiveIds[1] ?? "",
      name: self.offeredObjectiveIds[1] ?? "",
      family: "unknown",
    },
  ];

  const hasSelected = Boolean(self.selectedObjectiveId);
  const [chosenObjectiveId, setChosenObjectiveId] = useState<string | null>(
    self.selectedObjectiveId,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectCard = (objId: string) => {
    if (hasSelected || submitting) return;
    setChosenObjectiveId(objId);
  };

  const handleConfirmObjective = async () => {
    if (!chosenObjectiveId || hasSelected || submitting) return;
    try {
      setSubmitting(true);
      setError(null);
      const res = await onSendCommand({
        type: "CHOOSE_OBJECTIVE",
        objectiveId: chosenObjectiveId,
      });
      if (!res.ok) {
        setError(res.error.message || "Failed to choose objective");
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
      data-testid="objective-selection-view"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <span
            style={{
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Your Starting Profile
          </span>
          <h2
            style={{
              fontSize: "1.5rem",
              color: "var(--accent-emerald)",
              fontWeight: 700,
            }}
            data-testid="profile-name"
          >
            {profileName}
          </h2>
          {self.profile?.startingCashCents !== undefined && (
            <div
              style={{
                fontSize: "0.9rem",
                color: "var(--text-secondary)",
                marginTop: "0.2rem",
              }}
            >
              Starting Cash: $
              {(self.profile.startingCashCents / 100).toLocaleString()}
            </div>
          )}
        </div>

        <div>
          <div
            style={{
              fontSize: "0.8rem",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "0.5rem",
            }}
          >
            Player Selection Progress
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {match.players.map((p) => (
              <div
                key={p.playerId}
                style={{
                  padding: "0.3rem 0.6rem",
                  background: "var(--bg-surface-elevated)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.8rem",
                  border: "1px solid var(--border-subtle)",
                }}
                data-testid={`player-ready-status-${p.playerId}`}
              >
                <span style={{ fontWeight: 600 }}>{p.nickname}: </span>
                <span
                  style={{
                    color: p.hasSelectedObjective
                      ? "var(--accent-emerald)"
                      : "var(--accent-gold)",
                  }}
                >
                  {p.hasSelectedObjective ? "Ready" : "Selecting..."}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div
          className="error-banner"
          role="alert"
          data-testid="objective-error-banner"
        >
          {error}
        </div>
      )}

      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>
          {hasSelected
            ? "Your Selected Objective"
            : "Choose Your Secret Objective"}
        </h3>
        <p
          style={{
            fontSize: "0.9rem",
            color: "var(--text-secondary)",
            marginBottom: "1rem",
          }}
        >
          {hasSelected
            ? "Your objective is locked. Other players only see that you are ready."
            : "Select one of the two private objectives offered to you for this match."}
        </p>

        <div className="grid-2">
          {offeredObjectives.map((obj) => {
            const isChosen =
              chosenObjectiveId === obj.id ||
              self.selectedObjectiveId === obj.id;
            return (
              <button
                type="button"
                key={obj.id}
                className={`objective-card ${isChosen ? "selected" : ""}`}
                onClick={() => handleSelectCard(obj.id)}
                aria-pressed={isChosen}
                data-testid={`objective-card-${obj.id}`}
                style={{ textAlign: "left" }}
              >
                <span className="objective-family-badge">{obj.family}</span>
                <div
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                  }}
                >
                  {obj.name}
                </div>
                {hasSelected && isChosen && (
                  <div
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.85rem",
                      color: "var(--accent-emerald)",
                      fontWeight: 600,
                    }}
                  >
                    ✓ Locked In
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {!hasSelected && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: "1.5rem",
          }}
        >
          <button
            type="button"
            className="btn-primary"
            disabled={!chosenObjectiveId || submitting}
            onClick={handleConfirmObjective}
            id="confirm-objective-btn"
            data-testid="confirm-objective-btn"
          >
            {submitting
              ? "Locking Selection..."
              : error
                ? "Retry Lock In"
                : "Lock In Objective"}
          </button>
        </div>
      )}
    </div>
  );
};
