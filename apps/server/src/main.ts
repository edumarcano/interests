import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseServerConfig } from "./config.js";
import { type CreateServerOptions, createServer } from "./createServer.js";
import { recoverActiveMatchesOnStartup } from "./match/startupRecovery.js";
import { runMigrations } from "./persistence/sqlite/migrations.js";
import { openDatabase } from "./persistence/sqlite/openDatabase.js";
import { SqliteLobbyRepository } from "./persistence/sqlite/SqliteLobbyRepository.js";
import { SqliteMatchRepository } from "./persistence/sqlite/SqliteMatchRepository.js";
import { discoverLanOrigins } from "./runtime/lanDiscovery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(
  options: Pick<CreateServerOptions, "matchSeedSource"> = {},
): Promise<void> {
  const config = parseServerConfig(process.env);

  if (!config.staticRoot) {
    const defaultWebDist = path.resolve(__dirname, "../../web/dist");
    if (fs.existsSync(defaultWebDist)) {
      config.staticRoot = defaultWebDist;
    }
  }

  const db = openDatabase({ dbPath: config.dbPath });

  const migrationsDir = path.resolve(__dirname, "../migrations");
  runMigrations(db, migrationsDir);

  const repository = new SqliteLobbyRepository(db);
  const matchRepository = new SqliteMatchRepository(db);

  recoverActiveMatchesOnStartup(matchRepository, repository);

  const server = createServer({
    ...options,
    config,
    repository,
    matchRepository,
    onClose: () => {
      db.close();
    },
  });

  await server.fastify.listen({ host: config.host, port: config.port });
  const lanOrigins = await discoverLanOrigins(config.port);
  console.log(`Server listening on http://${config.host}:${config.port}`);
  console.log(`Local origin: http://localhost:${config.port}`);
  for (const origin of lanOrigins) {
    console.log(`LAN origin:   ${origin}`);
  }

  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`Received ${signal}, shutting down...`);
    try {
      await server.close();
      console.log("Server shut down cleanly");
      process.exit(0);
    } catch (err) {
      console.error("Error during server shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((err) => {
    console.error("Server startup failed:", err);
    process.exit(1);
  });
}

export { main };
