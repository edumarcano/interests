import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseServerConfig } from "./config.js";
import { createServer } from "./createServer.js";
import { runMigrations } from "./persistence/sqlite/migrations.js";
import { openDatabase } from "./persistence/sqlite/openDatabase.js";
import { SqliteLobbyRepository } from "./persistence/sqlite/SqliteLobbyRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const config = parseServerConfig(process.env);
  const db = openDatabase({ dbPath: config.dbPath });

  const migrationsDir = path.resolve(__dirname, "../migrations");
  runMigrations(db, migrationsDir);

  const repository = new SqliteLobbyRepository(db);

  const server = createServer({
    config,
    repository,
    onClose: () => {
      db.close();
    },
  });

  await server.fastify.listen({ host: config.host, port: config.port });
  console.log(`Server listening on http://${config.host}:${config.port}`);

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
