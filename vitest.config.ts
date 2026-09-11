import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    pool: "forks",
    forks: {
      singleFork: true,
    },
    fileParallelism: false,
  },
});
