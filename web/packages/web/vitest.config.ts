// Minimal vitest setup: pure-logic tests only (node env, no plugins, no DOM).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
