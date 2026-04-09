import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["packages/server/vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@openconclave/shared": path.resolve(__dirname, "packages/shared/src"),
      "@openconclave/shared/src": path.resolve(__dirname, "packages/shared/src"),
      "@openconclave/shared/src/": path.resolve(__dirname, "packages/shared/src/"),
    },
  },
});
