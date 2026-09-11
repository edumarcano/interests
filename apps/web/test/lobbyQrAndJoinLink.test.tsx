// @vitest-environment happy-dom

import type {
  RoomLobbyView,
  RoomMemberId,
  RoomPresencePayload,
} from "@interests/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import * as apiClient from "../src/api/client.js";
import { EntryScreen } from "../src/components/EntryScreen.js";
import { LobbyView } from "../src/components/LobbyView.js";

describe("Lobby QR and Join Link UI", () => {
  const mockRoom: RoomLobbyView = {
    code: "ROOM42",
    status: "open",
    capacity: 4,
    memberCount: 1,
    members: [
      {
        memberId: "m1" as RoomMemberId,
        nickname: "HostPlayer",
        joinOrder: 0,
        isHost: true,
      },
    ],
  };

  const mockPresence: RoomPresencePayload = {
    members: [
      {
        memberId: "m1" as RoomMemberId,
        nickname: "HostPlayer",
        joinOrder: 0,
        isHost: true,
        connected: true,
        synchronized: true,
      },
    ],
    allConnected: false,
    allSynchronized: false,
    pauseReasons: [],
  };

  beforeEach(() => {
    vi.spyOn(apiClient, "getSession").mockResolvedValue({ memberships: [] });
    vi.spyOn(apiClient, "getRuntimeInfo").mockResolvedValue({
      lanOrigins: ["http://192.168.1.100:3000", "http://10.0.0.5:3000"],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders QR code and public join URL with preferred LAN origin and without credentials", async () => {
    render(
      <LobbyView
        room={mockRoom}
        presence={mockPresence}
        selfMemberId={"m1" as RoomMemberId}
        pauseReasons={[]}
        onRecoveryCodeRotated={() => {}}
        onLeave={() => {}}
      />,
    );

    await waitFor(() => {
      const input = screen.getByTestId("join-url-input") as HTMLInputElement;
      expect(input.value).toBe("http://192.168.1.100:3000/?room=ROOM42");
    });

    const qrCode = screen.getByTestId("lobby-qr-code");
    expect(qrCode).toBeTruthy();
    expect(qrCode.getAttribute("aria-label")).toContain("ROOM42");

    // Invariant: no credentials or recovery keys in QR or URL
    const input = screen.getByTestId("join-url-input") as HTMLInputElement;
    expect(input.value).not.toContain("recovery");
    expect(input.value).not.toContain("session");
    expect(input.value).not.toContain("m1");

    // Multiple LAN addresses shown
    const secondaryLinks = screen.getByTestId("secondary-lan-links");
    expect(secondaryLinks.textContent).toContain("http://10.0.0.5:3000");
  });

  it("falls back to window.location.origin when runtime LAN origins are unavailable", async () => {
    vi.spyOn(apiClient, "getRuntimeInfo").mockResolvedValueOnce({
      lanOrigins: [],
    });

    render(
      <LobbyView
        room={mockRoom}
        presence={mockPresence}
        selfMemberId={"m1" as RoomMemberId}
        pauseReasons={[]}
        onRecoveryCodeRotated={() => {}}
        onLeave={() => {}}
      />,
    );

    await waitFor(() => {
      const input = screen.getByTestId("join-url-input") as HTMLInputElement;
      expect(input.value).toContain("/?room=ROOM42");
    });
  });

  it("copies join URL to clipboard on button click", async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      configurable: true,
    });

    render(
      <LobbyView
        room={mockRoom}
        presence={mockPresence}
        selfMemberId={"m1" as RoomMemberId}
        pauseReasons={[]}
        onRecoveryCodeRotated={() => {}}
        onLeave={() => {}}
      />,
    );

    await waitFor(() => {
      const input = screen.getByTestId("join-url-input") as HTMLInputElement;
      expect(input.value).toBe("http://192.168.1.100:3000/?room=ROOM42");
    });

    const copyBtn = screen.getByTestId("copy-join-link-btn");
    fireEvent.click(copyBtn);

    expect(writeTextSpy).toHaveBeenCalledWith(
      "http://192.168.1.100:3000/?room=ROOM42",
    );
  });

  it("pre-fills room code and selects Join Room tab when initialRoomCode/initialTab are provided to EntryScreen", () => {
    render(
      <EntryScreen
        onSuccess={() => {}}
        initialTab="join"
        initialRoomCode="DEEP99"
      />,
    );

    const roomCodeInput = screen.getByPlaceholderText(
      /e\.g\. ABCD/i,
    ) as HTMLInputElement;
    const nicknameInput = screen.getByPlaceholderText(
      /e\.g\. Jordan/i,
    ) as HTMLInputElement;

    expect(roomCodeInput.value).toBe("DEEP99");
    expect(nicknameInput.value).toBe("");
  });

  it("handles deep-link in App safely and opens Join Room tab when player has no session", async () => {
    // Set window.location.search to simulated deep link
    window.history.replaceState({}, "", "/?room=JOINME");

    render(<App />);

    await waitFor(() => {
      // Should show EntryScreen with Join tab
      const roomCodeInput = screen.getByPlaceholderText(
        /e\.g\. ABCD/i,
      ) as HTMLInputElement;
      expect(roomCodeInput.value).toBe("JOINME");
    });

    // Nickname remains blank for user to enter
    const nicknameInput = screen.getByPlaceholderText(
      /e\.g\. Jordan/i,
    ) as HTMLInputElement;
    expect(nicknameInput.value).toBe("");
  });

  it("handles malformed query-param room code safely without crashing", async () => {
    window.history.replaceState({}, "", "/?room=$$$BAD$$$");

    render(<App />);

    await waitFor(() => {
      // Defaults safely to Create Room tab
      expect(screen.getByTestId("create-room-form")).toBeTruthy();
    });
  });
});
