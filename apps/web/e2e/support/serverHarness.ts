import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const req = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export interface TestServerHarness {
  readonly port: number;
  readonly origin: string;
  readonly dbPath: string;
  getLogs: () => string;
  restart: () => Promise<void>;
  stop: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export async function startTestServer(
  options: {
    setupScenario?: "standard-v1" | "q1-business-diagnostic";
    ordinarySeed?: string;
  } = {},
): Promise<TestServerHarness> {
  const port = await getFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "interests-e2e-"));
  const dbPath = path.join(tempDir, `match-${runId}.sqlite`);
  const staticRoot = path.resolve(__dirname, "../../dist");

  // Ensure apps/web/dist exists
  if (!fs.existsSync(staticRoot)) {
    throw new Error(
      `apps/web/dist not found at ${staticRoot}. Please run "pnpm build:web" before running E2E tests.`,
    );
  }

  if (
    options.ordinarySeed &&
    options.setupScenario === "q1-business-diagnostic"
  )
    throw new Error(
      "Seeded acceptance requires the ordinary Standard V1 setup",
    );
  const serverMainPath = path.resolve(
    __dirname,
    options.ordinarySeed
      ? "../../../server/test/support/startSeededAcceptanceServer.ts"
      : "../../../server/src/main.ts",
  );
  const serverArgs = options.ordinarySeed
    ? [serverMainPath, options.ordinarySeed]
    : [serverMainPath];

  let child: ChildProcess | null = null;
  let serverLogs: string[] = [];

  const spawnServerProcess = async (): Promise<void> => {
    serverLogs = [];
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        INTERESTS_SETUP_SCENARIO: options.setupScenario ?? "standard-v1",
        INTERESTS_HOST: "127.0.0.1",
        INTERESTS_PORT: String(port),
        INTERESTS_DB_PATH: dbPath,
        INTERESTS_RATE_LIMIT_DISABLED: "true",
        INTERESTS_COOKIE_SECURE: "false",
        INTERESTS_STATIC_ROOT: staticRoot,
      };

      try {
        // Run with node and tsx/cli entry directly
        const tsxCli = req.resolve("tsx/cli");
        child = spawn(process.execPath, [tsxCli, ...serverArgs], {
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        // Fallback using pnpm exec tsx
        child = spawn("pnpm", ["exec", "tsx", ...serverArgs], {
          env,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }

      child.stdout?.on("data", (chunk) => {
        const text = chunk.toString();
        serverLogs.push(text);
      });

      child.stderr?.on("data", (chunk) => {
        const text = chunk.toString();
        serverLogs.push(`[ERR] ${text}`);
      });

      child.on("error", (err) => {
        reject(
          new Error(
            `Server process error: ${err.message}\nLogs:\n${serverLogs.join("")}`,
          ),
        );
      });

      child.on("exit", (code) => {
        if (code !== null && code !== 0) {
          // Unexpected exit during launch
          reject(
            new Error(
              `Server exited prematurely with code ${code}\nLogs:\n${serverLogs.join("")}`,
            ),
          );
        }
      });

      // Poll /api/health
      const start = Date.now();
      const pollInterval = setInterval(async () => {
        if (Date.now() - start > 20000) {
          clearInterval(pollInterval);
          reject(
            new Error(
              `Timeout waiting for server at ${origin}/api/health\nLogs:\n${serverLogs.join("")}`,
            ),
          );
          return;
        }

        try {
          const res = await fetch(`${origin}/api/health`);
          if (res.ok) {
            clearInterval(pollInterval);
            resolve();
          }
        } catch {
          // not listening yet
        }
      }, 100);
    });
  };

  const stopProcess = async (): Promise<void> => {
    if (!child) return;
    const proc = child;
    child = null;

    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      proc.once("exit", done);

      try {
        proc.kill("SIGTERM");
      } catch {
        done();
      }

      // Hard-kill fallback if it doesn't exit promptly
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore
        }
        done();
      }, 2500);
    });

    // Small delay to let socket/file descriptors release
    await new Promise((r) => setTimeout(r, 200));
  };

  // Initial startup
  await spawnServerProcess();

  return {
    port,
    origin,
    dbPath,
    getLogs: () => serverLogs.join(""),
    restart: async () => {
      await stopProcess();
      await spawnServerProcess();
    },
    stop: async () => {
      await stopProcess();
    },
    cleanup: async () => {
      await stopProcess();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}
