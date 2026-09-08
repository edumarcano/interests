import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import {
  Server as SocketIOServer,
  type ServerOptions as SocketIOServerOptions,
} from "socket.io";
import type { ServerConfig } from "./config.js";

export interface CreateServerOptions {
  config?: ServerConfig;
  fastifyOptions?: FastifyServerOptions;
  socketIoOptions?: Partial<SocketIOServerOptions>;
  onClose?: () => Promise<void> | void;
}

export interface GameServer {
  fastify: FastifyInstance;
  io: SocketIOServer;
  close: () => Promise<void>;
}

export function createServer(options: CreateServerOptions = {}): GameServer {
  const fastify = Fastify({
    logger: false,
    ...options.fastifyOptions,
  });

  const io = new SocketIOServer(fastify.server, options.socketIoOptions);

  fastify.get("/api/health", async (_request, _reply) => {
    return { status: "ok" };
  });

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
