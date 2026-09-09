import { EventEmitter } from "node:events";
import {
  SOCKET_CLIENT_EVENTS,
  SOCKET_PROTOCOL_VERSION,
  SOCKET_SERVER_EVENTS,
} from "@interests/shared";
import { io } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeManager } from "../src/socket/socketClient.js";

class MockSocket extends EventEmitter {
  connected = true;
  disconnect = vi.fn();
  outgoingEmits: Array<{ event: string; payload: any; ack?: Function }> = [];

  // When client emits to server
  emit(event: string, ...args: any[]): boolean {
    const payload = args[0];
    const ack =
      typeof args[args.length - 1] === "function"
        ? args[args.length - 1]
        : undefined;
    this.outgoingEmits.push({ event, payload, ack });
    return super.emit(event, ...args);
  }

  // Helper to trigger server-sent events to client
  receiveServerEvent(event: string, payload: any) {
    super.emit(event, payload);
  }
}

const fakeSocket = new MockSocket();

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => fakeSocket),
}));

describe("RealtimeManager unit tests", () => {
  beforeEach(() => {
    fakeSocket.removeAllListeners();
    fakeSocket.connected = true;
    fakeSocket.disconnect.mockClear();
    fakeSocket.outgoingEmits = [];
    vi.mocked(io).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects with roomCode and protocolVersion auth", () => {
    const manager = new RealtimeManager();
    manager.connect("ROOM1");

    expect(io).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/socket.io",
        auth: {
          roomCode: "ROOM1",
          protocolVersion: SOCKET_PROTOCOL_VERSION,
        },
      }),
    );
    expect(manager.getState().status).toBe("connecting");
  });

  it("handles BOOTSTRAP event, sets status to synchronizing, and sets status to synchronized once ack returns", () => {
    const manager = new RealtimeManager();
    manager.connect("ROOM1");

    const bootstrapPayload = {
      protocolVersion: SOCKET_PROTOCOL_VERSION,
      room: {
        code: "ROOM1",
        status: "open",
        capacity: 4,
        memberCount: 1,
        members: [],
      },
      self: {
        memberId: "m1",
        connectionGeneration: 2,
      },
      presence: {
        members: [],
        allConnected: true,
        allSynchronized: true,
        pauseReasons: [],
      },
      pause: { reasons: [] },
      match: null,
    };

    // Simulate server emitting session:bootstrap
    fakeSocket.receiveServerEvent(
      SOCKET_SERVER_EVENTS.BOOTSTRAP,
      bootstrapPayload,
    );

    const stateDuringSync = manager.getState();
    expect(stateDuringSync.status).toBe("synchronizing");
    expect(stateDuringSync.selfMemberId).toBe("m1");
    expect(stateDuringSync.connectionGeneration).toBe(2);

    const syncEmit = fakeSocket.outgoingEmits.find(
      (e) => e.event === SOCKET_CLIENT_EVENTS.SYNCHRONIZE,
    );
    expect(syncEmit).toBeDefined();
    expect(syncEmit?.payload).toEqual({ connectionGeneration: 2 });
    expect(typeof syncEmit?.ack).toBe("function");

    // Invoke synchronize ack callback from server
    syncEmit?.ack?.({ ok: true });
    expect(manager.getState().status).toBe("synchronized");
  });

  it("disconnects and sets replaced status when REPLACED event is received", () => {
    const manager = new RealtimeManager();
    manager.connect("ROOM1");

    fakeSocket.receiveServerEvent(SOCKET_SERVER_EVENTS.REPLACED, {
      reason: "NEW_CONTROLLER",
    });

    expect(manager.getState().status).toBe("replaced");
    expect(manager.getState().replacedReason).toBe("NEW_CONTROLLER");
    expect(fakeSocket.disconnect).toHaveBeenCalled();
  });

  it("sends player command envelope and awaits ack, clearing pending command on success", async () => {
    const manager = new RealtimeManager();
    manager.connect("ROOM1");

    // Hook to auto-respond to command
    fakeSocket.on(
      SOCKET_CLIENT_EVENTS.COMMAND,
      (envelope: any, ack?: Function) => {
        if (ack) {
          ack({
            ok: true,
            commandId: envelope.commandId,
            outcome: "ACCEPTED",
            revision: 1,
          });
        }
      },
    );

    const result = await manager.sendCommand({ type: "PASS_SPOTLIGHT" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe("ACCEPTED");
      expect(result.revision).toBe(1);
    }
    expect(manager.getPendingCommand()).toBeNull();
  });

  it("preserves pending command envelope on timeout, and retryPendingCommand reuses the exact same envelope", async () => {
    const manager = new RealtimeManager();
    manager.connect("ROOM1");

    // Send with very short timeout so it times out without an ack
    const timeoutResult = await manager.sendCommand(
      { type: "PASS_SPOTLIGHT" },
      10,
    );
    expect(timeoutResult.ok).toBe(false);
    expect(timeoutResult.error.code).toBe("TIMEOUT");

    const pending = manager.getPendingCommand();
    expect(pending).not.toBeNull();
    const originalCommandId = pending?.commandId;

    // Hook to acknowledge retry
    fakeSocket.on(
      SOCKET_CLIENT_EVENTS.COMMAND,
      (envelope: any, ack?: Function) => {
        if (ack) {
          ack({
            ok: true,
            commandId: envelope.commandId,
            outcome: "ACCEPTED",
            revision: envelope.expectedRevision + 1,
          });
        }
      },
    );

    const retryResult = await manager.retryPendingCommand();
    expect(retryResult.ok).toBe(true);
    expect(retryResult.commandId).toBe(originalCommandId);
    expect(manager.getPendingCommand()).toBeNull();
  });

  it("calling sendCommand with the same command after timeout reuses the exact same envelope and commandId", async () => {
    const manager = new RealtimeManager();
    manager.connect("ROOM1");

    // First attempt times out
    const timeoutResult = await manager.sendCommand(
      { type: "CHOOSE_OBJECTIVE", objectiveId: "founder" },
      10,
    );
    expect(timeoutResult.ok).toBe(false);
    expect(timeoutResult.error.code).toBe("TIMEOUT");

    const pending = manager.getPendingCommand();
    expect(pending).not.toBeNull();
    const firstCommandId = pending?.commandId;

    // Second attempt via standard sendCommand (as normal UI component does on retry)
    let secondSentEnvelope: any = null;
    fakeSocket.on(
      SOCKET_CLIENT_EVENTS.COMMAND,
      (envelope: any, ack?: Function) => {
        secondSentEnvelope = envelope;
        if (ack) {
          ack({
            ok: true,
            commandId: envelope.commandId,
            outcome: "ACCEPTED",
            revision: 1,
          });
        }
      },
    );

    const secondResult = await manager.sendCommand({
      type: "CHOOSE_OBJECTIVE",
      objectiveId: "founder",
    });
    expect(secondResult.ok).toBe(true);
    expect(secondResult.commandId).toBe(firstCommandId);
    expect(secondSentEnvelope.commandId).toBe(firstCommandId);
    expect(manager.getPendingCommand()).toBeNull();
  });

  it("calling sendCommand with a different command after timeout generates a new envelope", async () => {
    const manager = new RealtimeManager();
    manager.connect("ROOM1");

    // First attempt times out
    await manager.sendCommand(
      { type: "CHOOSE_OBJECTIVE", objectiveId: "founder" },
      10,
    );
    const firstCommandId = manager.getPendingCommand()?.commandId;

    fakeSocket.on(
      SOCKET_CLIENT_EVENTS.COMMAND,
      (envelope: any, ack?: Function) => {
        if (ack) {
          ack({
            ok: true,
            commandId: envelope.commandId,
            outcome: "ACCEPTED",
            revision: 1,
          });
        }
      },
    );

    // User changed selection to a different objective
    const secondResult = await manager.sendCommand({
      type: "CHOOSE_OBJECTIVE",
      objectiveId: "property-magnate",
    });
    expect(secondResult.ok).toBe(true);
    expect(secondResult.commandId).not.toBe(firstCommandId);
  });

  it("terminal rejected ack clears pending command", async () => {
    const manager = new RealtimeManager();
    manager.connect("ROOM1");

    fakeSocket.on(
      SOCKET_CLIENT_EVENTS.COMMAND,
      (envelope: any, ack?: Function) => {
        if (ack) {
          ack({
            ok: false,
            commandId: envelope.commandId,
            error: { code: "STALE_REVISION", message: "Stale revision" },
            revision: 2,
          });
        }
      },
    );

    const res = await manager.sendCommand({ type: "BEGIN_ROUND" });
    expect(res.ok).toBe(false);
    expect(manager.getPendingCommand()).toBeNull();
  });

  it("late ack for older command does not clear newer pending command", async () => {
    const manager = new RealtimeManager();
    manager.connect("ROOM1");

    let firstAckFn: Function | null = null;
    fakeSocket.once(
      SOCKET_CLIENT_EVENTS.COMMAND,
      (envelope: any, ack?: Function) => {
        firstAckFn = ack ?? null;
      },
    );

    // First command times out
    await manager.sendCommand({ type: "PASS_SPOTLIGHT" }, 10);
    const firstCommandId = manager.getPendingCommand()?.commandId;

    // User submits a genuinely new command (e.g. choose objective)
    fakeSocket.once(
      SOCKET_CLIENT_EVENTS.COMMAND,
      (_envelope: any, _ack?: Function) => {
        // don't ack immediately
      },
    );
    manager.sendCommand(
      { type: "CHOOSE_OBJECTIVE", objectiveId: "founder" },
      1000,
    );

    const secondCommandId = manager.getPendingCommand()?.commandId;
    expect(secondCommandId).not.toBe(firstCommandId);

    // Now late ack for first command arrives
    firstAckFn?.({
      ok: true,
      commandId: firstCommandId,
      outcome: "ACCEPTED",
      revision: 1,
    });

    // Pending command should NOT be cleared because it belongs to the second command
    expect(manager.getPendingCommand()?.commandId).toBe(secondCommandId);
  });

  it("setMatch updates match and clears pending command if revision advanced", async () => {
    const manager = new RealtimeManager();
    manager.connect("ROOM1");

    await manager.sendCommand({ type: "BEGIN_ROUND" }, 10);
    expect(manager.getPendingCommand()).not.toBeNull();

    manager.setMatch({
      matchId: "m1" as any,
      modeId: "standard",
      revision: 5,
      phase: "ready-for-first-round",
      currentQuarter: 1,
      round: {
        stage: "round-start",
        spotlightOrder: [],
        activeSpotlightPlayerId: null,
        spotlightsCompleted: 0,
      },
      players: [],
      self: {
        playerId: "p1" as any,
        profileId: "prof",
        offeredObjectiveIds: ["a", "b"],
        selectedObjectiveId: null,
      },
      activeTransaction: null,
    });

    expect(manager.getState().match?.revision).toBe(5);
    expect(manager.getPendingCommand()).toBeNull();
  });
});
