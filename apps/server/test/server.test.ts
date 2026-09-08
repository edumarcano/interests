import { describe, expect, it, vi } from "vitest";
import { createServer } from "../src/createServer.js";

describe("Server factory and endpoints", () => {
  it("creates a Fastify server without automatically listening on a network port", () => {
    const server = createServer();
    expect(server.fastify).toBeDefined();
    expect(server.io).toBeDefined();
    expect(server.fastify.server.listening).toBe(false);
  });

  it("responds to GET /api/health with status 200 and non-sensitive status payload", async () => {
    const server = createServer();

    const response = await server.fastify.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({ status: "ok" });

    // Verify non-exposure of sensitive fields
    expect(body).not.toHaveProperty("dbPath");
    expect(body).not.toHaveProperty("seed");
    expect(body).not.toHaveProperty("state");
    expect(body).not.toHaveProperty("credentials");
    expect(body).not.toHaveProperty("env");
  });

  it("attaches Socket.IO to Fastify's underlying HTTP server", () => {
    const server = createServer();
    expect(server.io).toBeDefined();
    // Fastify's underlying server matches Socket.IO's attached server
    expect(server.io.httpServer).toBe(server.fastify.server);
  });

  it("closes Socket.IO, Fastify, and custom onClose handler on clean shutdown", async () => {
    const onCloseHook = vi.fn();
    const server = createServer({
      onClose: onCloseHook,
    });

    await server.close();

    expect(onCloseHook).toHaveBeenCalledTimes(1);
  });
});
