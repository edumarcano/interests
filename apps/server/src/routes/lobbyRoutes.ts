import { SESSION_COOKIE_NAME } from "@interests/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "../config.js";
import { LobbyError } from "../lobby/errors.js";
import type { LobbyRepository } from "../lobby/types.js";
import type { RoomConnectionCoordinator } from "../realtime/RoomConnectionCoordinator.js";
import { discoverLanOrigins } from "../runtime/lanDiscovery.js";

const COOKIE_NAME = SESSION_COOKIE_NAME;
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface LobbyRouteOptions {
  config: ServerConfig;
  repository: LobbyRepository;
  coordinator?: RoomConnectionCoordinator;
}

function validateSameOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const origin = request.headers.origin;
  // If Origin header is absent (non-browser client, test agent, cURL), allow
  if (!origin) {
    return true;
  }

  const host = request.headers.host;
  if (!host) {
    reply.status(403).send({
      error: {
        code: "FORBIDDEN",
        message: "Missing Host header for Origin validation",
      },
    });
    return false;
  }

  try {
    const originUrl = new URL(origin);
    if (originUrl.host !== host) {
      reply.status(403).send({
        error: {
          code: "FORBIDDEN",
          message: "Cross-origin request rejected: Origin does not match Host",
        },
      });
      return false;
    }
    return true;
  } catch {
    reply.status(403).send({
      error: {
        code: "FORBIDDEN",
        message: "Invalid Origin header",
      },
    });
    return false;
  }
}

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  secure: boolean,
): void {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure,
    maxAge: SESSION_MAX_AGE_SECONDS,
    expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
  });
}

export async function registerLobbyRoutes(
  fastify: FastifyInstance,
  options: LobbyRouteOptions,
): Promise<void> {
  const { config, repository } = options;

  // Origin check preHandler for write routes
  const originCheckHook = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const valid = validateSameOrigin(request, reply);
    if (!valid) {
      return reply;
    }
  };

  // POST /api/rooms
  fastify.post<{ Body: { nickname: string } }>(
    "/api/rooms",
    {
      preHandler: originCheckHook,
      config: config.rateLimitDisabled
        ? {}
        : {
            rateLimit: {
              max: 10,
              timeWindow: "1 minute",
            },
          },
    },
    async (request, reply) => {
      const existingSessionToken = request.cookies[COOKIE_NAME];
      const nickname = request.body?.nickname;

      if (!nickname || typeof nickname !== "string") {
        throw new LobbyError("INVALID_INPUT", "Nickname is required", 400);
      }

      const result = repository.createRoomWithHost({
        nickname,
        existingSessionToken,
      });

      if (result.sessionToken) {
        setSessionCookie(reply, result.sessionToken, config.cookieSecure);
      }

      return reply.status(201).send({
        room: result.room,
        self: result.self,
      });
    },
  );

  // POST /api/rooms/:roomCode/join
  fastify.post<{
    Params: { roomCode: string };
    Body: { nickname: string };
  }>(
    "/api/rooms/:roomCode/join",
    {
      preHandler: originCheckHook,
      config: config.rateLimitDisabled
        ? {}
        : {
            rateLimit: {
              max: 30,
              timeWindow: "1 minute",
            },
          },
    },
    async (request, reply) => {
      const existingSessionToken = request.cookies[COOKIE_NAME];
      const nickname = request.body?.nickname;
      const roomCode = request.params.roomCode;

      if (!nickname || typeof nickname !== "string") {
        throw new LobbyError("INVALID_INPUT", "Nickname is required", 400);
      }

      const result = repository.joinRoom({
        roomCode,
        nickname,
        existingSessionToken,
      });

      if (result.sessionToken) {
        setSessionCookie(reply, result.sessionToken, config.cookieSecure);
      }

      options.coordinator?.notifyRosterChanged(roomCode);

      return reply.status(201).send({
        room: result.room,
        self: result.self,
      });
    },
  );

  // GET /api/rooms/:roomCode
  fastify.get<{ Params: { roomCode: string } }>(
    "/api/rooms/:roomCode",
    async (request, reply) => {
      const sessionToken = request.cookies[COOKIE_NAME];
      if (!sessionToken) {
        throw new LobbyError(
          "UNAUTHENTICATED",
          "Session cookie is required",
          401,
        );
      }

      const roomCode = request.params.roomCode;
      const result = repository.getRoomLobbyView({
        roomCode,
        sessionToken,
      });

      return reply.status(200).send(result);
    },
  );

  // GET /api/session
  fastify.get("/api/session", async (request, reply) => {
    const sessionToken = request.cookies[COOKIE_NAME];
    if (!sessionToken) {
      throw new LobbyError(
        "UNAUTHENTICATED",
        "Session cookie is required",
        401,
      );
    }

    const memberships = repository.getSessionBootstrap(sessionToken);
    return reply.status(200).send({ memberships });
  });

  // POST /api/rooms/:roomCode/recover
  fastify.post<{
    Params: { roomCode: string };
    Body: { recoveryCode: string };
  }>(
    "/api/rooms/:roomCode/recover",
    {
      preHandler: originCheckHook,
      config: config.rateLimitDisabled
        ? {}
        : {
            rateLimit: {
              max: 30,
              timeWindow: "1 minute",
            },
          },
    },
    async (request, reply) => {
      const existingSessionToken = request.cookies[COOKIE_NAME];
      const recoveryCode = request.body?.recoveryCode;
      const roomCode = request.params.roomCode;

      if (!recoveryCode || typeof recoveryCode !== "string") {
        throw new LobbyError("INVALID_INPUT", "Recovery code is required", 400);
      }

      const result = repository.recoverMembership({
        roomCode,
        recoveryCode,
        existingSessionToken,
      });

      if (result.sessionToken) {
        setSessionCookie(reply, result.sessionToken, config.cookieSecure);
      }

      options.coordinator?.invalidateMemberController(
        result.self.memberId,
        "RECOVERY",
      );

      return reply.status(200).send({
        room: result.room,
        self: result.self,
      });
    },
  );

  // POST /api/rooms/:roomCode/recovery-code
  fastify.post<{ Params: { roomCode: string } }>(
    "/api/rooms/:roomCode/recovery-code",
    {
      preHandler: originCheckHook,
    },
    async (request, reply) => {
      const sessionToken = request.cookies[COOKIE_NAME];
      if (!sessionToken) {
        throw new LobbyError(
          "UNAUTHENTICATED",
          "Session cookie is required",
          401,
        );
      }

      const roomCode = request.params.roomCode;
      const result = repository.rotateRecoveryCode({
        roomCode,
        sessionToken,
      });

      return reply.status(200).send(result);
    },
  );

  // GET /api/runtime-info
  fastify.get("/api/runtime-info", async (_request, reply) => {
    const lanOrigins = await discoverLanOrigins(config.port);
    return reply.status(200).send({ lanOrigins });
  });
}
