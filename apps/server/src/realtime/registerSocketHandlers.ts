import * as cookie from "cookie";
import type { Socket, Server as SocketIOServer } from "socket.io";
import type {
  AuthenticatedMemberResult,
  LobbyRepository,
} from "../lobby/types.js";
import type { RoomConnectionCoordinator } from "./RoomConnectionCoordinator.js";
import {
  SESSION_COOKIE_NAME,
  SOCKET_CLIENT_EVENTS,
  SOCKET_ERROR_CODES,
  SOCKET_PROTOCOL_VERSION,
} from "./socketProtocol.js";
import type { HandshakeAuth } from "./types.js";

function createMiddlewareError(code: string, message: string): Error {
  const error = new Error(message);
  (error as Error & { data: { code: string; message: string } }).data = {
    code,
    message,
  };
  return error;
}

export function registerSocketHandlers(
  io: SocketIOServer,
  repository: LobbyRepository,
  coordinator: RoomConnectionCoordinator,
): void {
  // Handshake authentication and validation middleware
  io.use((socket: Socket, next: (err?: Error) => void) => {
    // 1. Same-Origin check
    const origin = socket.handshake.headers.origin;
    if (origin) {
      const host = socket.handshake.headers.host;
      if (!host) {
        return next(
          createMiddlewareError(
            SOCKET_ERROR_CODES.FORBIDDEN,
            "Missing Host header for Origin validation",
          ),
        );
      }

      try {
        const originUrl = new URL(origin);
        if (originUrl.host !== host) {
          return next(
            createMiddlewareError(
              SOCKET_ERROR_CODES.FORBIDDEN,
              "Cross-origin socket connection rejected: Origin does not match Host",
            ),
          );
        }
      } catch {
        return next(
          createMiddlewareError(
            SOCKET_ERROR_CODES.FORBIDDEN,
            "Invalid Origin header",
          ),
        );
      }
    }

    // 2. Protocol version & handshake auth payload validation
    const auth = socket.handshake.auth as HandshakeAuth | undefined;
    if (!auth || typeof auth !== "object") {
      return next(
        createMiddlewareError(
          SOCKET_ERROR_CODES.INVALID_INPUT,
          "Handshake auth payload is required",
        ),
      );
    }

    // Prohibit client-sent identity or credentials
    const forbiddenKeys = [
      "memberId",
      "PlayerId",
      "playerId",
      "sessionToken",
      "sessionCredential",
      "recoveryCode",
      "recoveryCredential",
    ];
    for (const key of forbiddenKeys) {
      if (key in auth) {
        return next(
          createMiddlewareError(
            SOCKET_ERROR_CODES.INVALID_INPUT,
            `Client must not supply '${key}' in handshake auth`,
          ),
        );
      }
    }

    if (auth.protocolVersion !== SOCKET_PROTOCOL_VERSION) {
      return next(
        createMiddlewareError(
          SOCKET_ERROR_CODES.INCOMPATIBLE_PROTOCOL,
          `Unsupported socket protocol version: expected ${SOCKET_PROTOCOL_VERSION}`,
        ),
      );
    }

    if (
      typeof auth.roomCode !== "string" ||
      auth.roomCode.trim().length === 0
    ) {
      return next(
        createMiddlewareError(
          SOCKET_ERROR_CODES.INVALID_INPUT,
          "Valid roomCode is required in handshake auth",
        ),
      );
    }

    // 3. Cookie extraction & session authentication
    const rawCookie = socket.handshake.headers.cookie;
    if (!rawCookie || typeof rawCookie !== "string") {
      return next(
        createMiddlewareError(
          SOCKET_ERROR_CODES.UNAUTHENTICATED,
          "Session cookie is required",
        ),
      );
    }

    let parsedCookies: Record<string, string | undefined>;
    try {
      parsedCookies = cookie.parse(rawCookie);
    } catch {
      return next(
        createMiddlewareError(
          SOCKET_ERROR_CODES.UNAUTHENTICATED,
          "Malformed cookie header",
        ),
      );
    }

    const sessionToken = parsedCookies[SESSION_COOKIE_NAME];
    if (!sessionToken) {
      return next(
        createMiddlewareError(
          SOCKET_ERROR_CODES.UNAUTHENTICATED,
          "Valid session cookie required",
        ),
      );
    }

    // Verify room membership grant via repository
    const authResult = repository.authenticateMemberForRoom({
      roomCode: auth.roomCode,
      sessionToken,
    });

    if (!authResult) {
      return next(
        createMiddlewareError(
          SOCKET_ERROR_CODES.NOT_A_ROOM_MEMBER,
          "You are not an authorized member of this room",
        ),
      );
    }

    // Store authenticated member result temporarily on socket for connection handler
    (
      socket as Socket & { _authResult?: AuthenticatedMemberResult }
    )._authResult = authResult;

    return next();
  });

  // Socket connection lifecycle
  io.on("connection", (socket: Socket) => {
    const authResult = (
      socket as Socket & { _authResult?: AuthenticatedMemberResult }
    )._authResult;

    if (!authResult) {
      socket.disconnect(true);
      return;
    }

    // Clean temporary reference
    delete (socket as Socket & { _authResult?: AuthenticatedMemberResult })
      ._authResult;

    // Register with connection coordinator
    coordinator.registerConnection(socket, authResult);

    socket.on(SOCKET_CLIENT_EVENTS.SYNCHRONIZE, (payload, ack) => {
      coordinator.handleSynchronized(socket, payload, ack);
    });

    socket.on(SOCKET_CLIENT_EVENTS.RESUME, (ack) => {
      coordinator.handleResume(socket, ack);
    });

    socket.on("disconnect", () => {
      coordinator.handleDisconnect(socket);
    });
  });
}
