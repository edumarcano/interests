import type {
  MatchPlayerView,
  PauseReason,
  RoomLobbyView,
  RoomMemberId,
  RoomPresencePayload,
} from "@interests/shared";
import { QRCodeSVG } from "qrcode.react";
import type React from "react";
import { useEffect, useState } from "react";
import {
  getRuntimeInfo,
  rotateRecoveryCode,
  startMatch,
} from "../api/client.js";

interface Props {
  room: RoomLobbyView;
  presence: RoomPresencePayload | null;
  selfMemberId: RoomMemberId | null;
  pauseReasons: readonly PauseReason[];
  onRecoveryCodeRotated: (newCode: string) => void;
  onLeave: () => void;
  onMatchStarted?: (match: MatchPlayerView) => void;
}

export const LobbyView: React.FC<Props> = ({
  room,
  presence,
  selfMemberId,
  pauseReasons,
  onRecoveryCodeRotated,
  onLeave,
  onMatchStarted,
}) => {
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [starting, setStarting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lanOrigins, setLanOrigins] = useState<readonly string[]>([]);

  useEffect(() => {
    let cancelled = false;
    getRuntimeInfo()
      .then((res) => {
        if (!cancelled && res.lanOrigins) {
          setLanOrigins(res.lanOrigins);
        }
      })
      .catch(() => {
        // Fall back to window.location.origin
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const primaryOrigin =
    lanOrigins.length > 0
      ? lanOrigins[0]
      : typeof window !== "undefined"
        ? window.location.origin
        : "";
  const joinUrl = `${primaryOrigin}/?room=${room.code}`;

  const isHost = room.members.some(
    (m) => m.memberId === selfMemberId && m.isHost,
  );
  const memberCount = room.members.length;
  const isPaused = pauseReasons.length > 0;
  const allSynchronized = presence ? presence.allSynchronized : false;
  const canStart =
    isHost && memberCount === 4 && allSynchronized && !isPaused && !starting;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard error
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // ignore clipboard error
    }
  };

  const handleStartGame = async () => {
    try {
      setStarting(true);
      setError(null);
      const res = await startMatch(room.code);
      if (res?.match) {
        onMatchStarted?.(res.match);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to start match");
      setStarting(false);
    }
  };

  const handleRotateRecovery = async () => {
    try {
      setRotating(true);
      setError(null);
      const res = await rotateRecoveryCode(room.code);
      onRecoveryCodeRotated(res.recoveryCode);
    } catch (err: any) {
      setError(err?.message || "Failed to rotate recovery code");
    } finally {
      setRotating(false);
    }
  };

  // Map presence by memberId
  const presenceMap = new Map<string, { connected: boolean; sync: boolean }>();
  if (presence) {
    for (const p of presence.members) {
      presenceMap.set(p.memberId, {
        connected: p.connected,
        sync: p.synchronized,
      });
    }
  }

  // 4 seats representation: durable joinOrder is 0..3, UI seat number is 1..4
  const seats = [0, 1, 2, 3].map((joinOrder) => {
    const member = room.members.find((m) => m.joinOrder === joinOrder);
    return {
      seatNum: joinOrder + 1,
      member,
    };
  });

  return (
    <div
      className="card"
      style={{ width: "100%", maxWidth: 880, margin: "0 auto" }}
      data-testid="lobby-view"
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
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Room Code
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              marginTop: "0.2rem",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "1.75rem",
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "var(--accent-gold)",
              }}
              data-testid="room-code-display"
            >
              {room.code}
            </span>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleCopyCode}
              style={{ minHeight: 36, padding: "0.35rem 0.75rem" }}
              id="copy-room-code-btn"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleRotateRecovery}
            disabled={rotating}
            style={{ minHeight: 36, padding: "0.35rem 0.75rem" }}
            id="rotate-recovery-btn"
            title="Generate a new recovery code and invalidate previous ones"
          >
            {rotating ? "Rotating..." : "Rotate Recovery Code"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onLeave}
            style={{ minHeight: 36, padding: "0.35rem 0.75rem" }}
            id="leave-lobby-btn"
          >
            Leave
          </button>
        </div>
      </div>

      {error && (
        <div
          className="error-banner"
          role="alert"
          data-testid="lobby-error-banner"
        >
          {error}
        </div>
      )}

      {/* Share / LAN Join Block */}
      <div
        className="card"
        style={{
          background: "var(--bg-surface-elevated)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          padding: "1rem",
          marginBottom: "1.5rem",
          display: "flex",
          flexWrap: "wrap",
          gap: "1.25rem",
          alignItems: "center",
        }}
        data-testid="lobby-share-block"
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            margin: "0 auto",
          }}
        >
          <div
            style={{
              padding: "0.5rem",
              background: "#ffffff",
              borderRadius: "var(--radius-sm)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            data-testid="qr-container"
          >
            <QRCodeSVG
              value={joinUrl}
              size={120}
              bgColor="#ffffff"
              fgColor="#000000"
              level="M"
              role="img"
              aria-label={`QR Code to join room ${room.code}`}
              data-testid="lobby-qr-code"
            />
          </div>
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginTop: "0.35rem",
              textAlign: "center",
            }}
          >
            Scan to Join (Public Link)
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <span
            style={{
              fontSize: "0.8rem",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              fontWeight: 600,
              display: "block",
              marginBottom: "0.35rem",
            }}
          >
            Public Join Link (Same Wi-Fi / LAN)
          </span>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <input
              type="text"
              readOnly
              value={joinUrl}
              data-testid="join-url-input"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.85rem",
                background: "var(--bg-card)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)",
                padding: "0.4rem 0.6rem",
                borderRadius: "var(--radius-sm)",
                flex: "1 1 180px",
                cursor: "text",
              }}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={handleCopyLink}
              style={{
                minHeight: 36,
                padding: "0.35rem 0.75rem",
                whiteSpace: "nowrap",
              }}
              id="copy-join-link-btn"
              data-testid="copy-join-link-btn"
            >
              {copiedLink ? "Copied!" : "Copy Link"}
            </button>
          </div>
          {lanOrigins.length > 1 && (
            <div
              style={{
                marginTop: "0.5rem",
                fontSize: "0.75rem",
                color: "var(--text-muted)",
              }}
              data-testid="secondary-lan-links"
            >
              <span>Other LAN addresses: </span>
              {lanOrigins.slice(1).map((origin, idx) => (
                <span key={origin}>
                  {idx > 0 && ", "}
                  <a
                    href={`${origin}/?room=${room.code}`}
                    style={{ color: "var(--accent-gold)" }}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {origin}
                  </a>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginBottom: "1.5rem" }}>
        <h3
          style={{
            fontSize: "1.1rem",
            marginBottom: "0.75rem",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Seats</span>
          <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            {memberCount} / 4 Players
          </span>
        </h3>

        <div className="grid-4" data-testid="seats-grid">
          {seats.map(({ seatNum, member }) => {
            const isSelf = member?.memberId === selfMemberId;
            const pres = member ? presenceMap.get(member.memberId) : undefined;
            const isConnected = pres?.connected ?? false;
            const isSync = pres?.sync ?? false;

            return (
              <div
                key={seatNum}
                className={`seat-card ${isSelf ? "seat-active" : ""}`}
                data-testid={`seat-${seatNum}`}
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
                    SEAT {seatNum}
                  </span>
                  {member?.isHost && (
                    <span
                      className="badge"
                      style={{
                        background: "rgba(245, 158, 11, 0.2)",
                        color: "var(--accent-gold)",
                      }}
                      data-testid={`host-badge-${seatNum}`}
                    >
                      Host
                    </span>
                  )}
                </div>

                {member ? (
                  <div>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: "1.05rem",
                        marginBottom: "0.25rem",
                      }}
                    >
                      {member.nickname} {isSelf && "(You)"}
                    </div>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        color: isConnected
                          ? isSync
                            ? "var(--accent-emerald)"
                            : "var(--accent-gold)"
                          : "var(--text-muted)",
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "currentColor",
                        }}
                      />
                      {isConnected
                        ? isSync
                          ? "Synchronized"
                          : "Connecting..."
                        : "Offline"}
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      color: "var(--text-muted)",
                      fontStyle: "italic",
                      fontSize: "0.9rem",
                      padding: "0.5rem 0",
                    }}
                  >
                    Open Seat
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          marginTop: "2rem",
          paddingTop: "1.5rem",
          borderTop: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        {isHost ? (
          <>
            <button
              type="button"
              className="btn-gold"
              onClick={handleStartGame}
              disabled={!canStart}
              style={{ minWidth: 200 }}
              id="start-game-btn"
              data-testid="start-game-btn"
            >
              {starting ? "Starting Game..." : "Start Game"}
            </button>
            {!canStart && (
              <p
                style={{
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                  textAlign: "center",
                }}
              >
                {memberCount < 4
                  ? `Waiting for ${4 - memberCount} more player(s) to join...`
                  : isPaused
                    ? "Cannot start while room is paused."
                    : "Waiting for all players to synchronize..."}
              </p>
            )}
          </>
        ) : (
          <p
            style={{
              fontSize: "0.95rem",
              color: "var(--text-secondary)",
              fontStyle: "italic",
            }}
            data-testid="waiting-for-host-msg"
          >
            Waiting for the host to start the game...
          </p>
        )}
      </div>
    </div>
  );
};
