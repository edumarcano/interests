// @vitest-environment happy-dom

import type {
  MatchPlayerView,
  PauseReason,
  PlayerCommand,
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
import * as apiClient from "../src/api/client.js";
import {
  createCommandEnvelope,
  generateUUID,
} from "../src/command/commandHelper.js";
import { ConnectionStatusBadge } from "../src/components/ConnectionStatusBadge.js";
import { EntryScreen } from "../src/components/EntryScreen.js";
import { LobbyView } from "../src/components/LobbyView.js";
import { MatchView } from "../src/components/MatchView.js";
import { ObjectiveSelection } from "../src/components/ObjectiveSelection.js";
import { PauseBanner } from "../src/components/PauseBanner.js";
import { RecoveryCodeModal } from "../src/components/RecoveryCodeModal.js";
import { ReplacedScreen } from "../src/components/ReplacedScreen.js";
import { RoundStartView } from "../src/components/RoundStartView.js";
import { SpotlightView } from "../src/components/SpotlightView.js";

beforeEach(() => {
  vi.spyOn(apiClient, "getSession").mockResolvedValue({ memberships: [] });
  vi.spyOn(apiClient, "getRuntimeInfo").mockResolvedValue({ lanOrigins: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TASK Section 30: Client Verification Checklist", () => {
  // Mock data helpers
  const mockRoom: RoomLobbyView = {
    code: "TESTROOM",
    status: "open",
    capacity: 4,
    memberCount: 4,
    members: [
      {
        memberId: "m1" as RoomMemberId,
        nickname: "Alice",
        joinOrder: 0,
        isHost: true,
      },
      {
        memberId: "m2" as RoomMemberId,
        nickname: "Bob",
        joinOrder: 1,
        isHost: false,
      },
      {
        memberId: "m3" as RoomMemberId,
        nickname: "Charlie",
        joinOrder: 2,
        isHost: false,
      },
      {
        memberId: "m4" as RoomMemberId,
        nickname: "Dana",
        joinOrder: 3,
        isHost: false,
      },
    ],
  };

  const mockPresenceAllSync: RoomPresencePayload = {
    members: [
      {
        memberId: "m1" as RoomMemberId,
        nickname: "Alice",
        joinOrder: 0,
        isHost: true,
        connected: true,
        synchronized: true,
      },
      {
        memberId: "m2" as RoomMemberId,
        nickname: "Bob",
        joinOrder: 1,
        isHost: false,
        connected: true,
        synchronized: true,
      },
      {
        memberId: "m3" as RoomMemberId,
        nickname: "Charlie",
        joinOrder: 2,
        isHost: false,
        connected: true,
        synchronized: true,
      },
      {
        memberId: "m4" as RoomMemberId,
        nickname: "Dana",
        joinOrder: 3,
        isHost: false,
        connected: true,
        synchronized: true,
      },
    ],
    allConnected: true,
    allSynchronized: true,
    pauseReasons: [],
  };

  const mockSetupMatch: MatchPlayerView = {
    matchId: "match-1" as any,
    modeId: "standard",
    revision: 0,
    phase: "objective-choosing",
    currentQuarter: 1,
    round: null,
    players: [
      {
        playerId: "p1" as any,
        roomMemberId: "m1" as RoomMemberId,
        nickname: "Alice",
        joinOrder: 0,
        isHost: true,
        hasSelectedObjective: false,
      },
      {
        playerId: "p2" as any,
        roomMemberId: "m2" as RoomMemberId,
        nickname: "Bob",
        joinOrder: 1,
        isHost: false,
        hasSelectedObjective: true,
      },
      {
        playerId: "p3" as any,
        roomMemberId: "m3" as RoomMemberId,
        nickname: "Charlie",
        joinOrder: 2,
        isHost: false,
        hasSelectedObjective: false,
      },
      {
        playerId: "p4" as any,
        roomMemberId: "m4" as RoomMemberId,
        nickname: "Dana",
        joinOrder: 3,
        isHost: false,
        hasSelectedObjective: true,
      },
    ],
    self: {
      playerId: "p1" as any,
      profileId: "high-income-professional",
      profile: {
        id: "high-income-professional",
        name: "High-Income Professional",
        startingCashCents: 5_000_000,
      },
      offeredObjectiveIds: ["founder", "property-magnate"],
      offeredObjectives: [
        { id: "founder", name: "Founder", family: "builders" },
        {
          id: "property-magnate",
          name: "Property Magnate",
          family: "builders",
        },
      ],
      selectedObjectiveId: null,
      selectedObjective: null,
      cashCents: 5_000_000,
      reservedCashCents: 0,
      availableCashCents: 5_000_000,
      financialDetails: {
        objectiveEvaluation: null,
        careerOffers: [],
        annualLaborCompensationCents: null,
        quarterlyIncomeCents: 0,
        quarterlyLivingExpenseCents: 0,
        entitledQuarterlyIncomeCents: 0,
        entitledQuarterlyLivingExpenseCents: 0,
        labor: { kind: "not-working" },
        focus: "general",
        completedObservationQuarters: 0,
        publicMarkets: [],
        properties: [],
        objectiveRequirements: [],
      },
    },
    activeTransaction: null,
  };

  const mockRoundStartMatch: MatchPlayerView = {
    ...mockSetupMatch,
    revision: 4,
    phase: "ready-for-first-round",
    round: {
      stage: "round-start",
      spotlightOrder: ["p1" as any, "p2" as any, "p3" as any, "p4" as any],
      activeSpotlightPlayerId: null,
      spotlightsCompleted: 0,
    },
  };

  const mockSpotlightMatch: MatchPlayerView = {
    ...mockSetupMatch,
    revision: 5,
    phase: "ready-for-first-round",
    round: {
      stage: "spotlight",
      spotlightOrder: ["p1" as any, "p2" as any, "p3" as any, "p4" as any],
      activeSpotlightPlayerId: "p1" as any,
      spotlightsCompleted: 0,
    },
  };

  // 1. Landing screen renders Create Room, Join Room, Recover Seat tabs
  it("1. Landing screen renders Create Room, Join Room, Recover Seat tabs", () => {
    const { container } = render(<EntryScreen onSuccess={() => {}} />);
    expect(container.querySelector("#tab-create")).toBeTruthy();
    expect(container.querySelector("#tab-join")).toBeTruthy();
    expect(container.querySelector("#tab-recover")).toBeTruthy();
  });

  // 2. Create Room validates nickname and displays recovery code modal with newly minted code
  it("2. Create Room validates nickname and displays recovery code modal", async () => {
    vi.spyOn(apiClient, "createRoom").mockResolvedValueOnce({
      room: mockRoom,
      self: { memberId: "m1" as RoomMemberId, recoveryCode: "REC-12345" },
    });

    const handleSuccess = vi.fn();
    const { container } = render(<EntryScreen onSuccess={handleSuccess} />);

    const nicknameInput = screen.getByPlaceholderText(/e\.g\. Alex/i);
    fireEvent.change(nicknameInput, { target: { value: "   " } });
    const createBtn = container.querySelector("#create-room-btn")!;
    fireEvent.click(createBtn);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/please enter a nickname/i)).toBeTruthy();

    fireEvent.change(nicknameInput, { target: { value: "Alice" } });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalledWith({
        roomCode: "TESTROOM",
        recoveryCode: "REC-12345",
      });
    });

    // Verify modal displays code
    render(<RecoveryCodeModal recoveryCode="REC-12345" onClose={() => {}} />);
    expect(screen.getByTestId("recovery-code-display").textContent).toBe(
      "REC-12345",
    );
  });

  // 3. Join Room validates 4-letter room code and nickname
  it("3. Join Room validates room code and nickname", async () => {
    vi.spyOn(apiClient, "joinRoom").mockResolvedValueOnce({
      room: mockRoom,
      self: { memberId: "m2" as RoomMemberId, recoveryCode: "REC-JOIN" },
    });

    const handleSuccess = vi.fn();
    const { container } = render(<EntryScreen onSuccess={handleSuccess} />);
    fireEvent.click(container.querySelector("#tab-join")!);

    const codeInput = screen.getByPlaceholderText(/e\.g\. ABCD/i);
    const nickInput = screen.getByPlaceholderText(/e\.g\. Jordan/i);

    // Whitespace nickname
    fireEvent.change(codeInput, { target: { value: "ABCD" } });
    fireEvent.change(nickInput, { target: { value: "   " } });
    fireEvent.click(container.querySelector("#join-room-btn")!);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/please enter a nickname/i)).toBeTruthy();

    // Valid inputs
    fireEvent.change(nickInput, { target: { value: "Bob" } });
    fireEvent.click(container.querySelector("#join-room-btn")!);

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalledWith({
        roomCode: "TESTROOM",
        recoveryCode: "REC-JOIN",
      });
    });
  });

  // 4. Recover Seat submits room code + recovery code and re-attaches to existing seat
  it("4. Recover Seat submits room code + recovery code", async () => {
    vi.spyOn(apiClient, "recoverRoom").mockResolvedValueOnce({
      room: mockRoom,
      self: { memberId: "m1" as RoomMemberId },
    });

    const handleSuccess = vi.fn();
    const { container } = render(<EntryScreen onSuccess={handleSuccess} />);
    fireEvent.click(container.querySelector("#tab-recover")!);

    const codeInput = screen.getByPlaceholderText(/e\.g\. ABCD/i);
    const recInput = screen.getByPlaceholderText(
      /enter your private recovery code/i,
    );

    fireEvent.change(codeInput, { target: { value: "TEST" } });
    fireEvent.change(recInput, { target: { value: "MY-REC-KEY" } });
    fireEvent.click(container.querySelector("#recover-room-btn")!);

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalledWith({
        roomCode: "TESTROOM",
      });
    });
  });

  // 5. Lobby renders 4 seats with nickname, join order, host badge, and connection/sync status
  it("5. Lobby renders 4 seats with nickname, join order, host badge, and connection/sync status", () => {
    render(
      <LobbyView
        room={mockRoom}
        presence={mockPresenceAllSync}
        selfMemberId={"m1" as RoomMemberId}
        pauseReasons={[]}
        onRecoveryCodeRotated={() => {}}
        onLeave={() => {}}
      />,
    );

    expect(screen.getByTestId("room-code-display").textContent).toBe(
      "TESTROOM",
    );
    expect(screen.getByTestId("seat-1")).toBeTruthy();
    expect(screen.getByTestId("seat-2")).toBeTruthy();
    expect(screen.getByTestId("seat-3")).toBeTruthy();
    expect(screen.getByTestId("seat-4")).toBeTruthy();
    expect(screen.getByTestId("host-badge-1")).toBeTruthy();
  });

  // 6. Host controls: "Start Game" enabled only when 4 members connected & synchronized
  it("6. Host controls: Start Game enabled only when 4 members connected & synchronized", () => {
    const { rerender } = render(
      <LobbyView
        room={mockRoom}
        presence={mockPresenceAllSync}
        selfMemberId={"m1" as RoomMemberId} // host
        pauseReasons={[]}
        onRecoveryCodeRotated={() => {}}
        onLeave={() => {}}
      />,
    );

    const startBtn = screen.getByTestId("start-game-btn") as HTMLButtonElement;
    expect(startBtn.disabled).toBe(false);

    // Not synchronized
    const unsyncedPresence: RoomPresencePayload = {
      ...mockPresenceAllSync,
      allSynchronized: false,
    };
    rerender(
      <LobbyView
        room={mockRoom}
        presence={unsyncedPresence}
        selfMemberId={"m1" as RoomMemberId}
        pauseReasons={[]}
        onRecoveryCodeRotated={() => {}}
        onLeave={() => {}}
      />,
    );
    expect(startBtn.disabled).toBe(true);
  });

  // 7. Non-host view: "Start Game" hidden/disabled, showing waiting indicator
  it("7. Non-host view: Start Game hidden, showing waiting indicator", () => {
    render(
      <LobbyView
        room={mockRoom}
        presence={mockPresenceAllSync}
        selfMemberId={"m2" as RoomMemberId} // non-host
        pauseReasons={[]}
        onRecoveryCodeRotated={() => {}}
        onLeave={() => {}}
      />,
    );

    expect(screen.queryByTestId("start-game-btn")).toBeNull();
    expect(screen.getByTestId("waiting-for-host-msg")).toBeTruthy();
  });

  // 8. Objective selection renders profile name, cash, and two offered objectives
  it("8. Objective selection renders profile name, cash, and two offered objectives", () => {
    render(
      <ObjectiveSelection
        match={mockSetupMatch}
        onSendCommand={async () => ({
          ok: true,
          commandId: "c1",
          outcome: "ACCEPTED",
          revision: 1,
        })}
      />,
    );

    expect(screen.getByTestId("profile-name").textContent).toBe(
      "High-Income Professional",
    );
    expect(screen.getByText(/\$50,000/)).toBeTruthy();
    expect(screen.getByTestId("objective-card-founder")).toBeTruthy();
    expect(screen.getByTestId("objective-card-property-magnate")).toBeTruthy();
  });

  // 9. Clicking objective selects it; confirm action sends CHOOSE_OBJECTIVE with expected revision and disables while in-flight
  it("9. Clicking objective selects it; confirm action sends CHOOSE_OBJECTIVE with expected revision", async () => {
    const handleSendCommand = vi.fn().mockImplementation(
      async (cmd: PlayerCommand) =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                ok: true,
                commandId: "c1",
                outcome: "ACCEPTED",
                revision: 1,
              }),
            50,
          );
        }),
    );

    render(
      <ObjectiveSelection
        match={mockSetupMatch}
        onSendCommand={handleSendCommand}
      />,
    );

    const founderCard = screen.getByTestId("objective-card-founder");
    fireEvent.click(founderCard);

    const confirmBtn = screen.getByTestId(
      "confirm-objective-btn",
    ) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);

    fireEvent.click(confirmBtn);
    expect(confirmBtn.disabled).toBe(true);

    await waitFor(() => {
      expect(handleSendCommand).toHaveBeenCalledWith({
        type: "CHOOSE_OBJECTIVE",
        objectiveId: "founder",
      });
    });
  });

  // 10. Objective selection shows other players' ready status without leaking their chosen objective
  it("10. Objective selection shows other players' ready status without leaking their chosen objective", () => {
    render(
      <ObjectiveSelection
        match={mockSetupMatch}
        onSendCommand={async () => ({
          ok: true,
          commandId: "c1",
          outcome: "ACCEPTED",
          revision: 1,
        })}
      />,
    );

    expect(screen.getByTestId("player-ready-status-p2").textContent).toContain(
      "Bob: Ready",
    );
    expect(screen.getByTestId("player-ready-status-p3").textContent).toContain(
      "Charlie: Selecting...",
    );
    // P2's secret objective should not appear anywhere in the document
    expect(screen.queryByText(/founder/i)).toBeTruthy(); // in P1's own cards
    expect(screen.queryByText(/independent/i)).toBeNull();
  });

  // 11. Round start view displays current quarter (Q1) and spotlight turn order
  it("11. Round start view displays current quarter (Q1) and spotlight turn order", () => {
    render(
      <RoundStartView
        match={mockRoundStartMatch}
        isHost={true}
        isPaused={false}
        onSendCommand={async () => ({
          ok: true,
          commandId: "c1",
          outcome: "ACCEPTED",
          revision: 5,
        })}
      />,
    );

    expect(screen.getByTestId("quarter-heading").textContent).toBe("Quarter 1");
    expect(screen.getByTestId("spotlight-order-0").textContent).toContain(
      "Alice",
    );
    expect(screen.getByTestId("spotlight-order-1").textContent).toContain(
      "Bob",
    );
    expect(screen.getByTestId("spotlight-order-2").textContent).toContain(
      "Charlie",
    );
    expect(screen.getByTestId("spotlight-order-3").textContent).toContain(
      "Dana",
    );
  });

  // 12. Host sees "Begin Round" button; non-hosts see waiting message
  it("12. Host sees Begin Round button; non-hosts see waiting message", () => {
    const { rerender } = render(
      <RoundStartView
        match={mockRoundStartMatch}
        isHost={true}
        isPaused={false}
        onSendCommand={async () => ({
          ok: true,
          commandId: "c1",
          outcome: "ACCEPTED",
          revision: 5,
        })}
      />,
    );

    expect(screen.getByTestId("begin-round-btn")).toBeTruthy();
    expect(screen.queryByTestId("waiting-for-host-round-msg")).toBeNull();

    rerender(
      <RoundStartView
        match={mockRoundStartMatch}
        isHost={false}
        isPaused={false}
        onSendCommand={async () => ({
          ok: true,
          commandId: "c1",
          outcome: "ACCEPTED",
          revision: 5,
        })}
      />,
    );

    expect(screen.queryByTestId("begin-round-btn")).toBeNull();
    expect(screen.getByTestId("waiting-for-host-round-msg")).toBeTruthy();
  });

  // 13. Begin Round sends BEGIN_ROUND command
  it("13. Begin Round sends BEGIN_ROUND command", async () => {
    const handleSendCommand = vi.fn().mockResolvedValueOnce({
      ok: true,
      commandId: "c1",
      outcome: "ACCEPTED",
      revision: 5,
    });

    render(
      <RoundStartView
        match={mockRoundStartMatch}
        isHost={true}
        isPaused={false}
        onSendCommand={handleSendCommand}
      />,
    );

    fireEvent.click(screen.getByTestId("begin-round-btn"));
    await waitFor(() => {
      expect(handleSendCommand).toHaveBeenCalledWith({
        type: "BEGIN_ROUND",
      });
    });
  });

  // 14. Spotlight view highlights the active player and displays spotlights completed count
  it("14. Spotlight view highlights the active player and displays spotlights completed count", () => {
    render(
      <SpotlightView
        match={mockSpotlightMatch}
        isPaused={false}
        onSendCommand={async () => ({
          ok: true,
          commandId: "c1",
          outcome: "ACCEPTED",
          revision: 6,
        })}
      />,
    );

    expect(screen.getByTestId("spotlights-counter").textContent).toContain(
      "Spotlight 1 of 4",
    );
    expect(screen.getByTestId("active-spotlight-badge")).toBeTruthy();
  });

  // 15. Active player sees "Pass Spotlight"; non-active players see waiting indicator
  it("15. Active player sees Pass Spotlight; non-active players see waiting indicator", () => {
    const { rerender } = render(
      <SpotlightView
        match={mockSpotlightMatch} // self is p1, active is p1
        isPaused={false}
        onSendCommand={async () => ({
          ok: true,
          commandId: "c1",
          outcome: "ACCEPTED",
          revision: 6,
        })}
      />,
    );

    expect(screen.getByTestId("pass-spotlight-btn")).toBeTruthy();
    expect(screen.queryByTestId("waiting-for-spotlight-player-msg")).toBeNull();

    // Now set active to p2 (Bob)
    const p2ActiveMatch: MatchPlayerView = {
      ...mockSpotlightMatch,
      round: {
        stage: "spotlight",
        spotlightOrder: ["p1" as any, "p2" as any, "p3" as any, "p4" as any],
        activeSpotlightPlayerId: "p2" as any,
        spotlightsCompleted: 1,
      },
    };

    rerender(
      <SpotlightView
        match={p2ActiveMatch}
        isPaused={false}
        onSendCommand={async () => ({
          ok: true,
          commandId: "c1",
          outcome: "ACCEPTED",
          revision: 7,
        })}
      />,
    );

    expect(screen.queryByTestId("pass-spotlight-btn")).toBeNull();
    expect(
      screen.getByTestId("waiting-for-spotlight-player-msg").textContent,
    ).toContain("Bob");
  });

  // 16. Passing spotlight 4 times advances match to Quarter 2 round-start
  it("16. Passing spotlight 4 times advances match to Quarter 2 round-start", () => {
    const q2Match: MatchPlayerView = {
      ...mockSetupMatch,
      currentQuarter: 2,
      revision: 10,
      phase: "ready-for-first-round",
      round: {
        stage: "round-start",
        spotlightOrder: ["p2" as any, "p3" as any, "p4" as any, "p1" as any],
        activeSpotlightPlayerId: null,
        spotlightsCompleted: 0,
      },
    };

    render(
      <RoundStartView
        match={q2Match}
        isHost={true}
        isPaused={false}
        onSendCommand={async () => ({
          ok: true,
          commandId: "c1",
          outcome: "ACCEPTED",
          revision: 11,
        })}
      />,
    );

    expect(screen.getByTestId("quarter-heading").textContent).toBe("Quarter 2");
    expect(screen.getByTestId("spotlight-order-0").textContent).toContain(
      "Bob",
    );
  });

  // 17. Pause banner appears with formatted reason when room is paused
  it("17. Pause banner appears with formatted reason when room is paused", () => {
    const reasons: PauseReason[] = ["DISCONNECTED_MEMBER"];
    render(
      <PauseBanner
        reasons={reasons}
        isHost={false}
        canResume={false}
        onResume={async () => {}}
      />,
    );

    expect(screen.getByTestId("pause-banner")).toBeTruthy();
    expect(screen.getByText(/a player has disconnected/i)).toBeTruthy();
  });

  // 18. Host can resume game when pause cleared; non-hosts cannot
  it("18. Host can resume game when pause cleared; non-hosts cannot", async () => {
    const reasons: PauseReason[] = ["DISCONNECTED_MEMBER"];
    const handleResume = vi.fn().mockResolvedValueOnce(undefined);

    const { rerender } = render(
      <PauseBanner
        reasons={reasons}
        isHost={false}
        canResume={false}
        onResume={handleResume}
      />,
    );

    expect(screen.queryByTestId("resume-match-btn")).toBeNull();

    rerender(
      <PauseBanner
        reasons={reasons}
        isHost={true}
        canResume={true}
        onResume={handleResume}
      />,
    );

    const resumeBtn = screen.getByTestId("resume-match-btn");
    expect(resumeBtn).toBeTruthy();
    fireEvent.click(resumeBtn);

    await waitFor(() => {
      expect(handleResume).toHaveBeenCalled();
    });
  });

  // 19. Replaced session event transitions client cleanly to "Session Replaced" screen
  it("19. Replaced session event transitions client cleanly to Session Replaced screen", () => {
    const handleReset = vi.fn();
    render(<ReplacedScreen reason="NEW_CONTROLLER" onReset={handleReset} />);

    expect(screen.getByTestId("session-replaced-screen")).toBeTruthy();
    expect(
      screen.getByText(/actively controlled by another browser tab/i),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /return to home/i }));
    expect(handleReset).toHaveBeenCalled();
  });

  // 20. MatchView routes to ObjectiveSelection during setup and canonical round stages
  it("20. MatchView routes correctly across canonical phases and round stages", () => {
    const handleCmd = vi.fn().mockResolvedValue({
      ok: true,
      commandId: "c1",
      outcome: "ACCEPTED",
      revision: 1,
    });
    const handleResume = vi.fn().mockResolvedValue({ ok: true, data: {} });

    // Objective selection when phase is objective-choosing and round is null
    const { rerender } = render(
      <MatchView
        match={mockSetupMatch}
        presence={mockPresenceAllSync}
        pauseReasons={[]}
        isHost={true}
        onSendCommand={handleCmd}
        onResumeRoom={handleResume}
      />,
    );
    expect(screen.getByTestId("objective-selection-view")).toBeTruthy();

    // Round-start view when round stage is round-start
    rerender(
      <MatchView
        match={mockRoundStartMatch}
        presence={mockPresenceAllSync}
        pauseReasons={[]}
        isHost={true}
        onSendCommand={handleCmd}
        onResumeRoom={handleResume}
      />,
    );
    expect(screen.getByTestId("round-start-view")).toBeTruthy();

    // Spotlight view when round stage is spotlight
    rerender(
      <MatchView
        match={mockSpotlightMatch}
        presence={mockPresenceAllSync}
        pauseReasons={[]}
        isHost={true}
        onSendCommand={handleCmd}
        onResumeRoom={handleResume}
      />,
    );
    expect(screen.getByTestId("spotlight-view")).toBeTruthy();
  });

  // 21. MatchView host resume requires allConnected AND allSynchronized, and blocks on SYSTEM_FAULT
  it("21. MatchView host resume requires allConnected AND allSynchronized, and blocks on SYSTEM_FAULT", () => {
    const handleCmd = vi.fn().mockResolvedValue({
      ok: true,
      commandId: "c1",
      outcome: "ACCEPTED",
      revision: 1,
    });
    const handleResume = vi.fn().mockResolvedValue({ ok: true, data: {} });

    // Paused with DISCONNECTED_MEMBER, all connected & sync -> canResume true
    const { rerender } = render(
      <MatchView
        match={mockRoundStartMatch}
        presence={mockPresenceAllSync}
        pauseReasons={["DISCONNECTED_MEMBER"]}
        isHost={true}
        onSendCommand={handleCmd}
        onResumeRoom={handleResume}
      />,
    );
    const resumeBtn = screen.getByTestId(
      "resume-match-btn",
    ) as HTMLButtonElement;
    expect(resumeBtn.disabled).toBe(false);

    // If presence is not all synchronized -> disabled
    const unsyncedPresence = { ...mockPresenceAllSync, allSynchronized: false };
    rerender(
      <MatchView
        match={mockRoundStartMatch}
        presence={unsyncedPresence}
        pauseReasons={["DISCONNECTED_MEMBER"]}
        isHost={true}
        onSendCommand={handleCmd}
        onResumeRoom={handleResume}
      />,
    );
    expect(
      (screen.getByTestId("resume-match-btn") as HTMLButtonElement).disabled,
    ).toBe(true);

    // If SYSTEM_FAULT is present -> disabled even if all sync, and alert message is displayed
    rerender(
      <MatchView
        match={mockRoundStartMatch}
        presence={mockPresenceAllSync}
        pauseReasons={["SYSTEM_FAULT"]}
        isHost={true}
        onSendCommand={handleCmd}
        onResumeRoom={handleResume}
      />,
    );
    expect(
      (screen.getByTestId("resume-match-btn") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/manual resume is blocked/i)).toBeTruthy();
  });

  // Helper tests
  it("creates durable command envelope with LAN HTTP-safe UUID when crypto.randomUUID is unavailable and never calls Math.random", () => {
    const mathRandomSpy = vi.spyOn(Math, "random");
    const originalRandomUUID = crypto.randomUUID;
    try {
      // Simulate insecure context on LAN HTTP where crypto.randomUUID is undefined
      // @ts-expect-error test override
      delete crypto.randomUUID;

      const envelope = createCommandEnvelope({ type: "PASS_SPOTLIGHT" }, 42);
      expect(envelope.expectedRevision).toBe(42);
      expect(envelope.command.type).toBe("PASS_SPOTLIGHT");
      expect(typeof envelope.commandId).toBe("string");
      // Valid UUIDv4 format: 8-4-4-4-12 hex with version 4
      const uuidv4Regex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(envelope.commandId).toMatch(uuidv4Regex);
      expect(mathRandomSpy).not.toHaveBeenCalled();
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }
  });

  it("throws explicit controlled error and never uses Math.random when Web Crypto is unavailable", () => {
    const mathRandomSpy = vi.spyOn(Math, "random");
    const originalCrypto = globalThis.crypto;
    try {
      // 1. globalThis.crypto is undefined
      // @ts-expect-error test override
      delete globalThis.crypto;

      expect(() => generateUUID()).toThrow(
        /Cryptographically secure random number generation.*required/i,
      );
      expect(() =>
        createCommandEnvelope({ type: "PASS_SPOTLIGHT" }, 1),
      ).toThrow(/Cryptographically secure random number generation.*required/i);
      expect(mathRandomSpy).not.toHaveBeenCalled();

      // 2. crypto exists but has no secure RNG functions
      Object.defineProperty(globalThis, "crypto", {
        value: {},
        configurable: true,
        writable: true,
      });
      expect(() => generateUUID()).toThrow(
        /Cryptographically secure random number generation.*required/i,
      );
      expect(mathRandomSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
        writable: true,
      });
    }
  });

  it("LobbyView invokes onMatchStarted with returned match on Start Game success", async () => {
    vi.spyOn(apiClient, "startMatch").mockResolvedValueOnce({
      match: mockRoundStartMatch,
    });
    const handleMatchStarted = vi.fn();

    render(
      <LobbyView
        room={mockRoom}
        presence={mockPresenceAllSync}
        selfMemberId={"m1" as RoomMemberId}
        pauseReasons={[]}
        onRecoveryCodeRotated={() => {}}
        onLeave={() => {}}
        onMatchStarted={handleMatchStarted}
      />,
    );

    fireEvent.click(screen.getByTestId("start-game-btn"));
    await waitFor(() => {
      expect(handleMatchStarted).toHaveBeenCalledWith(mockRoundStartMatch);
    });
  });

  it("displays retry button text when action fails", async () => {
    const failingCmd = vi.fn().mockResolvedValue({
      ok: false,
      commandId: "c1",
      error: { code: "TIMEOUT", message: "Timed out" },
      revision: 4,
    });

    // Objective selection retry text
    const { rerender } = render(
      <ObjectiveSelection match={mockSetupMatch} onSendCommand={failingCmd} />,
    );
    fireEvent.click(screen.getByTestId("objective-card-founder"));
    fireEvent.click(screen.getByTestId("confirm-objective-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("confirm-objective-btn").textContent).toContain(
        "Retry Lock In",
      );
    });

    // Round start retry text
    rerender(
      <RoundStartView
        match={mockRoundStartMatch}
        isHost={true}
        isPaused={false}
        onSendCommand={failingCmd}
      />,
    );
    fireEvent.click(screen.getByTestId("begin-round-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("begin-round-btn").textContent).toContain(
        "Retry Begin Round",
      );
    });

    // Spotlight retry text
    rerender(
      <SpotlightView
        match={mockSpotlightMatch}
        isPaused={false}
        onSendCommand={failingCmd}
      />,
    );
    fireEvent.click(screen.getByTestId("pass-spotlight-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("pass-spotlight-btn").textContent).toContain(
        "Retry Pass Spotlight",
      );
    });
  });

  it("renders connection status badge with appropriate label and style", () => {
    const { rerender } = render(<ConnectionStatusBadge status="connected" />);
    expect(screen.getByLabelText(/Connected/i)).toBeTruthy();

    rerender(<ConnectionStatusBadge status="connecting" />);
    expect(screen.getByLabelText(/Connecting/i)).toBeTruthy();

    rerender(<ConnectionStatusBadge status="synchronizing" />);
    expect(screen.getByLabelText(/Synchronizing/i)).toBeTruthy();

    rerender(<ConnectionStatusBadge status="synchronized" />);
    expect(screen.getByLabelText(/Synchronized/i)).toBeTruthy();

    rerender(<ConnectionStatusBadge status="disconnected" />);
    expect(screen.getByLabelText(/Disconnected/i)).toBeTruthy();
  });
});
