import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const webDistDir = path.join(rootDir, "apps", "web", "dist");
const indexHtml = path.join(webDistDir, "index.html");

console.log("=== Interests Local Play Launcher ===");

if (!fs.existsSync(indexHtml)) {
  console.log(
    "Web client bundle not found. Building web client (`pnpm build:web`)...\n",
  );
  try {
    execSync("pnpm build:web", { cwd: rootDir, stdio: "inherit" });
  } catch (err) {
    console.error("Failed to build web client bundle.", err);
    process.exit(1);
  }
}

const host = process.env.INTERESTS_HOST || "0.0.0.0";
const port = process.env.INTERESTS_PORT || "3000";

console.log(`Starting server on ${host}:${port}...`);

const serverProc = spawn("pnpm", ["--filter", "@interests/server", "start"], {
  cwd: rootDir,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    INTERESTS_HOST: host,
    INTERESTS_PORT: port,
    INTERESTS_STATIC_ROOT: webDistDir,
  },
});

const cleanShutdown = (signal: string) => {
  console.log(`\nLauncher received ${signal}, terminating server...`);
  serverProc.kill("SIGINT");
};

process.on("SIGINT", () => cleanShutdown("SIGINT"));
process.on("SIGTERM", () => cleanShutdown("SIGINT"));

serverProc.on("close", (code) => {
  process.exit(code ?? 0);
});
