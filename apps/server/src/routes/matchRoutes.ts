import { SESSION_COOKIE_NAME } from "@interests/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "../config.js";
import type { MatchService } from "../match/MatchService.js";
import { PublicMarketPreviewSchema } from "../match/schema.js";
import { MatchError } from "../match/types.js";

const COOKIE_NAME = SESSION_COOKIE_NAME;

export interface MatchRouteOptions {
  config: ServerConfig;
  matchService: MatchService;
}

function validateSameOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const origin = request.headers.origin;
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

export async function registerMatchRoutes(
  fastify: FastifyInstance,
  options: MatchRouteOptions,
): Promise<void> {
  const { matchService } = options;

  fastify.post(
    "/api/rooms/:roomCode/start",
    async (
      request: FastifyRequest<{ Params: { roomCode: string } }>,
      reply: FastifyReply,
    ) => {
      if (!validateSameOrigin(request, reply)) {
        return;
      }

      const sessionToken = request.cookies[COOKIE_NAME];
      if (!sessionToken) {
        return reply.status(401).send({
          error: {
            code: "UNAUTHENTICATED",
            message: "Valid session cookie required",
          },
        });
      }

      const roomCode = request.params.roomCode;
      try {
        const matchView = await matchService.startMatch({
          roomCode,
          sessionToken,
        });
        return reply.status(200).send({ match: matchView });
      } catch (err) {
        if (err instanceof MatchError) {
          return reply.status(err.statusCode).send({
            error: {
              code: err.code,
              message: err.message,
            },
          });
        }
        throw err;
      }
    },
  );

  fastify.post(
    "/api/rooms/:roomCode/public-market-preview",
    async (
      request: FastifyRequest<{ Params: { roomCode: string } }>,
      reply: FastifyReply,
    ) => {
      reply.header("Cache-Control", "no-store");
      if (!validateSameOrigin(request, reply)) return;
      const sessionToken = request.cookies[COOKIE_NAME];
      if (!sessionToken)
        return reply.status(401).send({
          error: {
            code: "UNAUTHENTICATED",
            message: "Valid session cookie required",
          },
        });
      const input = PublicMarketPreviewSchema.safeParse(request.body);
      if (!input.success)
        return reply.status(400).send({
          error: {
            code: "INVALID_INPUT",
            message: "Invalid public-market basket",
          },
        });
      try {
        const preview = matchService.previewPublicMarkets({
          roomCode: request.params.roomCode,
          sessionToken,
          trades: input.data.trades,
        });
        return reply.send({ preview });
      } catch (error) {
        if (error instanceof MatchError)
          return reply
            .status(error.statusCode)
            .send({ error: { code: error.code, message: error.message } });
        throw error;
      }
    },
  );

  fastify.get(
    "/api/rooms/:roomCode/match",
    async (
      request: FastifyRequest<{ Params: { roomCode: string } }>,
      reply: FastifyReply,
    ) => {
      reply.header("Cache-Control", "no-store");

      const sessionToken = request.cookies[COOKIE_NAME];
      if (!sessionToken) {
        return reply.status(401).send({
          error: {
            code: "UNAUTHENTICATED",
            message: "Valid session cookie required",
          },
        });
      }

      const roomCode = request.params.roomCode;
      try {
        const matchView = matchService.getMatchView({
          roomCode,
          sessionToken,
        });
        return reply.status(200).send({ match: matchView });
      } catch (err) {
        if (err instanceof MatchError) {
          return reply.status(err.statusCode).send({
            error: {
              code: err.code,
              message: err.message,
            },
          });
        }
        throw err;
      }
    },
  );
}
