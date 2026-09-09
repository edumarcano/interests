import type React from "react";
import { useState } from "react";

interface Props {
  recoveryCode: string;
  onClose: () => void;
}

export const RecoveryCodeModal: React.FC<Props> = ({
  recoveryCode,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard write might fail in some iframe/unfocused contexts
    }
  };

  return (
    <div
      className="glass-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="modal-content">
        <h2
          id="modal-title"
          style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}
        >
          Your Private Recovery Code
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          Save this code securely. If you close this tab or change devices, use
          this code to recover your seat in the room.
        </p>

        <div
          className="code-pill"
          id="recovery-code-display"
          data-testid="recovery-code-display"
        >
          {recoveryCode}
        </div>

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleCopy}
            style={{ flex: 1 }}
            id="copy-recovery-code-btn"
          >
            {copied ? "Copied!" : "Copy Code"}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onClose}
            style={{ flex: 1 }}
            id="dismiss-recovery-code-btn"
          >
            I Saved It
          </button>
        </div>
      </div>
    </div>
  );
};
