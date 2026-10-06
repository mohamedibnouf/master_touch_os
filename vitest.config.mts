import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Load .env.local before test collection (Vitest sets NODE_ENV=test, which
// would otherwise skip .env.local in @next/env).
{
  const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
  const env = process.env as Record<string, string | undefined>;
  const prior = env.NODE_ENV;
  env.NODE_ENV = "development";
  loadEnvConfig(projectRoot);
  env.NODE_ENV = prior ?? "test";
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/live/**/*.test.ts"],
    setupFiles: ["./tests/setup-env.ts"],
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "./src"),
      "server-only": path.resolve(projectRoot, "./node_modules/server-only/empty.js"),
    },
  },
});
