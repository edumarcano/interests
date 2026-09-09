import React, { useEffect, useMemo, useState } from "react";
import { ConnectionStatusBadge } from "./components/ConnectionStatusBadge.js";
import { EntryScreen } from "./components/EntryScreen.js";
import { LobbyView } from "./components/LobbyView.js";
import { MatchView } from "./components/MatchView.js";
import { RecoveryCodeModal } from "./components/RecoveryCodeModal.js";
import { ReplacedScreen } from "./components/ReplacedScreen.js";
import { RealtimeManager, type RealtimeState } from "./socket/socketClient.js";

export const App: React.FC = () => {
  const realtime = useMemo(() => new RealtimeManager(), []);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>(() =>
    realtime.getState(),
  );

  const [currentRoomCode, setCurrentRoomCode] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("room")?.toUpperCase() ?? null;
  });

  const [recoveryCodeToShow, setRecoveryCodeToShow] = useState<string | null>(
    null,
  );

  // Subscribe to socket manager updates
  useEffect(() => {
    return realtime.subscribe(setRealtimeState);
  }, [realtime]);

  // Connect or disconnect when currentRoomCode changes
  useEffect(() => {
    if (currentRoomCode) {
      const url = new URL(window.location.href);
      url.searchParams.set("room", currentRoomCode);
      window.history.replaceState({}, "", url.toString());

      realtime.connect(currentRoomCode);
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState({}, "", url.toString());

      realtime.disconnect();
    }
  }, [currentRoomCode, realtime]);

  const handleEntrySuccess = (params: {
    roomCode: string;
    recoveryCode?: string;
  }) => {
    setCurrentRoomCode(params.roomCode);
    if (params.recoveryCode) {
      setRecoveryCodeToShow(params.recoveryCode);
    }
  };

  const handleLeave = () => {
    setCurrentRoomCode(null);
  };

  const handleResetReplaced = () => {
    setCurrentRoomCode(null);
  };

  const isHost = Boolean(
    realtimeState.room?.members.some(
      (m) => m.memberId === realtimeState.selfMemberId && m.isHost,
    ),
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <h1 className="brand-title">Interests</h1>
          {currentRoomCode && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--bg-surface-elevated)",
                padding: "0.2rem 0.6rem",
                borderRadius: "var(--radius-sm)",
                fontSize: "0.85rem",
                color: "var(--accent-gold)",
                fontWeight: 700,
              }}
            >
              {currentRoomCode}
            </span>
          )}
        </div>
        <div>
          {currentRoomCode ? (
            <ConnectionStatusBadge status={realtimeState.status} />
          ) : (
            <span
              style={{
                fontSize: "0.8rem",
                color: "var(--text-muted)",
                letterSpacing: "0.05em",
              }}
            >
              V1 PREVIEW
            </span>
          )}
        </div>
      </header>

      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {realtimeState.status === "replaced" ? (
          <ReplacedScreen
            reason={realtimeState.replacedReason}
            onReset={handleResetReplaced}
          />
        ) : !currentRoomCode ? (
          <EntryScreen onSuccess={handleEntrySuccess} />
        ) : realtimeState.match ? (
          <MatchView
            match={realtimeState.match}
            presence={realtimeState.presence}
            pauseReasons={realtimeState.pauseReasons}
            isHost={isHost}
            onSendCommand={(cmd) => realtime.sendCommand(cmd)}
            onResumeRoom={() => realtime.resumeRoom()}
          />
        ) : realtimeState.room ? (
          <LobbyView
            room={realtimeState.room}
            presence={realtimeState.presence}
            selfMemberId={realtimeState.selfMemberId}
            pauseReasons={realtimeState.pauseReasons}
            onRecoveryCodeRotated={(newCode) => setRecoveryCodeToShow(newCode)}
            onLeave={handleLeave}
            onMatchStarted={(m) => realtime.setMatch(m)}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              margin: "auto",
              gap: "1rem",
            }}
          >
            <div
              style={{
                fontSize: "1.1rem",
                color: "var(--text-secondary)",
              }}
            >
              Connecting to room {currentRoomCode}...
            </div>
            {realtimeState.error && (
              <div className="error-banner" role="alert">
                {realtimeState.error}
              </div>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={handleLeave}
            >
              Cancel
            </button>
          </div>
        )}
      </main>

      {recoveryCodeToShow && (
        <RecoveryCodeModal
          recoveryCode={recoveryCodeToShow}
          onClose={() => setRecoveryCodeToShow(null)}
        />
      )}
    </div>
  );
};
