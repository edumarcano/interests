import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import {
  Server as SocketIOServer,
  type ServerOptions as SocketIOServerOptions,
} from "socket.io";
import type { ServerConfig } from "./config.js";
import { LobbyError } from "./lobby/errors.js";
import type { LobbyRepository } from "./lobby/types.js";
import { registerLobbyRoutes } from "./routes/lobbyRoutes.js";

export interface CreateServerOptions {
  config?: ServerConfig;
  fastifyOptions?: FastifyServerOptions;
  socketIoOptions?: Partial<SocketIOServerOptions>;
  onClose?: () => Promise<void> | void;
  repository?: LobbyRepository;
}

export interface GameServer {
  fastify: FastifyInstance;
  io: SocketIOServer;
  close: () => Promise<void>;
}

export function createServer(options: CreateServerOptions = {}): GameServer {
  const config = options.config ?? {
    host: "0.0.0.0",
    port: 3000,
    dbPath: "./data/finance-game.sqlite",
    cookieSecure: false,
    rateLimitDisabled: false,
  };

  const fastify = Fastify({
    logger: false,
    ...options.fastifyOptions,
  });

  const io = new SocketIOServer(fastify.server, options.socketIoOptions);

  fastify.register(fastifyCookie);

  fastify.register(fastifyRateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new LobbyError(
        "RATE_LIMITED",
        "Too many requests, please try again later.",
        429,
      ),
  });

  fastify.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof LobbyError) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    const err = error as {
      statusCode?: number;
      code?: string;
      validation?: unknown;
      message?: string;
      error?: { code?: string; message?: string };
    };

    if (
      err.statusCode === 429 ||
      err.code === "FST_ERR_RATE_LIMIT" ||
      err.error?.code === "RATE_LIMITED"
    ) {
      reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests, please try again later.",
        },
      });
      return;
    }

    const statusCode = err.statusCode ?? (err as { status?: number }).status;
    if (err.validation || statusCode === 400) {
      reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: "Invalid input or malformed request payload",
        },
      });
      return;
    }

    reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal server error occurred",
      },
    });
  });

  fastify.get("/api/health", async (_request, _reply) => {
    return { status: "ok" };
  });

  if (options.repository) {
    fastify.register(registerLobbyRoutes, {
      config,
      repository: options.repository,
    });
  }

  fastify.addHook("onClose", async () => {
    await new Promise<void>((resolve) => {
      io.close(() => {
        resolve();
      });
    });

    if (options.onClose) {
      await options.onClose();
    }
  });

  return {
    fastify,
    io,
    close: async () => {
      await fastify.close();
    },
  };
}
