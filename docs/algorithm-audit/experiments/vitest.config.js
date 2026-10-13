// Runs the benchmark with the app's own module resolution ("@/…" → src/). Not part of `npm test`:
// the runner is named runBenchmark.js (no ".test."), so the project's test run never picks it up.
//   npx vitest run --config docs/algorithm-audit/experiments/vitest.config.js
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export default defineConfig({
  root,
  resolve: { alias: { "@": path.join(root, "src") } },
  test: {
    environment: "node",
    include: ["docs/algorithm-audit/experiments/runBenchmark.js"],
    testTimeout: 6 * 60 * 60 * 1000,
    hookTimeout: 6 * 60 * 60 * 1000,
  },
});
