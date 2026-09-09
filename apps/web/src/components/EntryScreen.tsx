import type {
  CreateRoomResponse,
  JoinRoomResponse,
  RecoverRoomResponse,
  SessionBootstrapMembership,
} from "@interests/shared";
import type React from "react";
import { useEffect, useState } from "react";
import {
  ApiClientError,
  createRoom,
  getSession,
  joinRoom,
  recoverRoom,
} from "../api/client.js";

interface Props {
  onSuccess: (params: { roomCode: string; recoveryCode?: string }) => void;
}

type TabType = "create" | "join" | "recover";

export const EntryScreen: React.FC<Props> = ({ onSuccess }) => {
  const [activeTab, setActiveTab] = useState<TabType>("create");
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentRooms, setRecentRooms] = useState<
    readonly SessionBootstrapMembership[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((res) => {
        if (!cancelled && res.memberships && res.memberships.length > 0) {
          setRecentRooms(res.memberships);
        }
      })
      .catch(() => {
        // Not logged in or session expired
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError("Please enter a nickname");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res: CreateRoomResponse = await createRoom(trimmed);
      onSuccess({
        roomCode: res.room.code,
        recoveryCode: res.self.recoveryCode,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to create room");
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedNick = nickname.trim();
    const trimmedCode = roomCode.trim().toUpperCase();
    if (!trimmedNick) {
      setError("Please enter a nickname");
      return;
    }
    if (!trimmedCode) {
      setError("Please enter a room code");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res: JoinRoomResponse = await joinRoom(trimmedCode, trimmedNick);
      onSuccess({
        roomCode: res.room.code,
        recoveryCode: res.self.recoveryCode,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to join room");
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCode = roomCode.trim().toUpperCase();
    const trimmedRecovery = recoveryCode.trim();
    if (!trimmedCode) {
      setError("Please enter a room code");
      return;
    }
    if (!trimmedRecovery) {
      setError("Please enter your recovery code");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res: RecoverRoomResponse = await recoverRoom(
        trimmedCode,
        trimmedRecovery,
      );
      onSuccess({
        roomCode: res.room.code,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to recover seat");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="card"
      style={{ maxWidth: 480, margin: "2rem auto", width: "100%" }}
      data-testid="entry-screen"
    >
      <div className="tab-nav">
        <button
          type="button"
          className={`tab-btn ${activeTab === "create" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("create");
            setError(null);
          }}
          id="tab-create"
        >
          Create Room
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "join" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("join");
            setError(null);
          }}
          id="tab-join"
        >
          Join Room
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "recover" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("recover");
            setError(null);
          }}
          id="tab-recover"
        >
          Recover Seat
        </button>
      </div>

      {error && (
        <div
          className="error-banner"
          role="alert"
          data-testid="entry-error-banner"
        >
          {error}
        </div>
      )}

      {activeTab === "create" && (
        <form
          onSubmit={handleCreate}
          style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          data-testid="create-room-form"
        >
          <div>
            <label
              htmlFor="create-nickname"
              style={{
                display: "block",
                marginBottom: "0.4rem",
                fontSize: "0.9rem",
                color: "var(--text-secondary)",
              }}
            >
              Your Nickname
            </label>
            <input
              id="create-nickname"
              type="text"
              placeholder="e.g. Alex"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              disabled={loading}
              maxLength={24}
              required
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            id="create-room-btn"
          >
            {loading ? "Creating..." : "Create Room"}
          </button>
        </form>
      )}

      {activeTab === "join" && (
        <form
          onSubmit={handleJoin}
          style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          data-testid="join-room-form"
        >
          <div>
            <label
              htmlFor="join-room-code"
              style={{
                display: "block",
                marginBottom: "0.4rem",
                fontSize: "0.9rem",
                color: "var(--text-secondary)",
              }}
            >
              Room Code
            </label>
            <input
              id="join-room-code"
              type="text"
              placeholder="e.g. ABCD"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              disabled={loading}
              maxLength={8}
              style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}
              required
            />
          </div>
          <div>
            <label
              htmlFor="join-nickname"
              style={{
                display: "block",
                marginBottom: "0.4rem",
                fontSize: "0.9rem",
                color: "var(--text-secondary)",
              }}
            >
              Your Nickname
            </label>
            <input
              id="join-nickname"
              type="text"
              placeholder="e.g. Jordan"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              disabled={loading}
              maxLength={24}
              required
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            id="join-room-btn"
          >
            {loading ? "Joining..." : "Join Room"}
          </button>
        </form>
      )}

      {activeTab === "recover" && (
        <form
          onSubmit={handleRecover}
          style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          data-testid="recover-room-form"
        >
          <div>
            <label
              htmlFor="recover-room-code"
              style={{
                display: "block",
                marginBottom: "0.4rem",
                fontSize: "0.9rem",
                color: "var(--text-secondary)",
              }}
            >
              Room Code
            </label>
            <input
              id="recover-room-code"
              type="text"
              placeholder="e.g. ABCD"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              disabled={loading}
              maxLength={8}
              style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}
              required
            />
          </div>
          <div>
            <label
              htmlFor="recover-code"
              style={{
                display: "block",
                marginBottom: "0.4rem",
                fontSize: "0.9rem",
                color: "var(--text-secondary)",
              }}
            >
              Recovery Code
            </label>
            <input
              id="recover-code"
              type="text"
              placeholder="Enter your private recovery code"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              disabled={loading}
              required
            />
          </div>
          <button
            type="submit"
            className="btn-gold"
            disabled={loading}
            id="recover-room-btn"
          >
            {loading ? "Recovering..." : "Recover Seat"}
          </button>
        </form>
      )}

      {recentRooms.length > 0 && (
        <div
          style={{
            marginTop: "2rem",
            paddingTop: "1.5rem",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "var(--text-muted)",
              marginBottom: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Recent Active Rooms
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            {recentRooms.map((r) => (
              <div
                key={r.roomCode}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.5rem 0.75rem",
                  background: "var(--bg-surface-elevated)",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      marginRight: "0.5rem",
                    }}
                  >
                    {r.roomCode}
                  </span>
                  <span
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    as {r.nickname}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{
                    minHeight: 32,
                    padding: "0.25rem 0.75rem",
                    fontSize: "0.85rem",
                  }}
                  onClick={() => onSuccess({ roomCode: r.roomCode })}
                >
                  Resume
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
