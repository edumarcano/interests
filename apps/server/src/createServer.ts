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
import { RoomConnectionCoordinator } from "./realtime/RoomConnectionCoordinator.js";
import { registerSocketHandlers } from "./realtime/registerSocketHandlers.js";
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
  coordinator?: RoomConnectionCoordinator;
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

  const defaultSocketIoOptions: Partial<SocketIOServerOptions> = {
    maxHttpBufferSize: 64 * 1024,
    perMessageDeflate: false,
  };

  const io = new SocketIOServer(fastify.server, {
    ...defaultSocketIoOptions,
    ...options.socketIoOptions,
  });

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

  const coordinator = options.repository
    ? new RoomConnectionCoordinator(io, options.repository)
    : undefined;

  if (options.repository && coordinator) {
    registerSocketHandlers(io, options.repository, coordinator);
    fastify.register(registerLobbyRoutes, {
      config,
      repository: options.repository,
      coordinator,
    });
  }

  fastify.addHook("onClose", async () => {
    if (coordinator) {
      coordinator.prepareShutdown();
    }

    try {
      io.disconnectSockets(true);
    } catch {
      // ignore
    }

    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      io.close(() => done());
      setTimeout(done, 150);
    });

    try {
      if (typeof fastify.server.closeAllConnections === "function") {
        fastify.server.closeAllConnections();
      }
    } catch {
      // ignore
    }

    if (options.onClose) {
      await options.onClose();
    }
  });

  let isClosing = false;
  return {
    fastify,
    io,
    coordinator,
    close: async () => {
      if (isClosing) return;
      isClosing = true;

      if (coordinator) {
        coordinator.prepareShutdown();
      }

      try {
        io.disconnectSockets(true);
      } catch {
        // ignore
      }

      try {
        if (typeof fastify.server.closeAllConnections === "function") {
          fastify.server.closeAllConnections();
        }
      } catch {
        // ignore
      }

      await fastify.close();
    },
  };
}
