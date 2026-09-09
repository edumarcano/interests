import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  SOCKET_CLIENT_EVENTS,
  SOCKET_PROTOCOL_VERSION,
  SOCKET_SERVER_EVENTS,
} from "@interests/shared";

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

import { io } from "socket.io-client";
import { RealtimeManager } from "../src/socket/socketClient.js";

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

  it("handles BOOTSTRAP event and automatically emits SYNCHRONIZE with connectionGeneration", () => {
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

    const state = manager.getState();
    expect(state.status).toBe("connected");
    expect(state.selfMemberId).toBe("m1");
    expect(state.connectionGeneration).toBe(2);

    const syncEmit = fakeSocket.outgoingEmits.find(
      (e) => e.event === SOCKET_CLIENT_EVENTS.SYNCHRONIZE,
    );
    expect(syncEmit).toBeDefined();
    expect(syncEmit?.payload).toEqual({ connectionGeneration: 2 });
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

  it("sends player command envelope and awaits ack", async () => {
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
  });
});
