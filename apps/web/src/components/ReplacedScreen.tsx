import type React from "react";

interface Props {
  reason: "NEW_CONTROLLER" | "RECOVERY" | null;
  onReset: () => void;
}

export const ReplacedScreen: React.FC<Props> = ({ reason, onReset }) => {
  return (
    <div
      className="card"
      style={{
        maxWidth: 520,
        margin: "3rem auto",
        textAlign: "center",
        padding: "2.5rem 2rem",
      }}
      data-testid="session-replaced-screen"
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "rgba(239, 68, 68, 0.15)",
          color: "var(--accent-rose)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 1.5rem auto",
          fontSize: "1.75rem",
        }}
      >
        ⚠️
      </div>
      <h2 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>
        Session Replaced
      </h2>
      <p
        style={{
          color: "var(--text-secondary)",
          marginBottom: "1.5rem",
          lineHeight: 1.6,
        }}
      >
        {reason === "RECOVERY"
          ? "This player seat was recovered with a recovery code in another browser tab or device."
          : "This player seat is now actively controlled by another browser tab or device."}
      </p>
      <p
        style={{
          color: "var(--text-muted)",
          fontSize: "0.85rem",
          marginBottom: "2rem",
        }}
      >
        To prevent conflicts, this window has been disconnected and will not
        reconnect automatically.
      </p>
      <button
        type="button"
        className="btn-primary"
        onClick={onReset}
        id="return-to-landing-btn"
      >
        Return to Home
      </button>
    </div>
  );
};
