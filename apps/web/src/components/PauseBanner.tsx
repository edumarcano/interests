import type { PauseReason } from "@interests/shared";
import React, { useState } from "react";

interface Props {
  reasons: readonly PauseReason[];
  isHost: boolean;
  canResume: boolean;
  onResume: () => Promise<void>;
}

function formatReason(reason: PauseReason): string {
  switch (reason) {
    case "DISCONNECTED_MEMBER":
      return "A player has disconnected";
    case "SERVER_RESTART":
      return "Server recently restarted; waiting for all members to reconnect";
    case "MANUAL":
      return "Game paused manually";
    case "SYSTEM_FAULT":
      return "System fault detected";
    default:
      return reason;
  }
}

export const PauseBanner: React.FC<Props> = ({
  reasons,
  isHost,
  canResume,
  onResume,
}) => {
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!reasons || reasons.length === 0) {
    return null;
  }

  const handleResumeClick = async () => {
    try {
      setResuming(true);
      setError(null);
      await onResume();
    } catch (err: any) {
      setError(err?.message || "Failed to resume game");
    } finally {
      setResuming(false);
    }
  };

  return (
    <div
      className="banner-pause"
      role="alert"
      aria-live="assertive"
      data-testid="pause-banner"
    >
      <div>
        <div
          style={{
            fontWeight: 700,
            color: "var(--accent-gold)",
            marginBottom: "0.25rem",
          }}
        >
          Game Paused
        </div>
        <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
          {reasons.map((r) => formatReason(r)).join(" • ")}
        </div>
        {error && (
          <div
            style={{
              fontSize: "0.85rem",
              color: "var(--accent-rose)",
              marginTop: "0.25rem",
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div>
        {isHost ? (
          <button
            type="button"
            className="btn-gold"
            onClick={handleResumeClick}
            disabled={resuming || !canResume}
            id="resume-match-btn"
            data-testid="resume-match-btn"
          >
            {resuming ? "Resuming..." : "Resume Game"}
          </button>
        ) : (
          <span
            style={{
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              fontStyle: "italic",
            }}
          >
            Waiting for host to resume...
          </span>
        )}
      </div>
    </div>
  );
};
