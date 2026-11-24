import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 20000,
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["test/core/**/*.test.ts", "test/static/**/*.test.ts", "test/web/**/*.test.ts"],
        },
      },
      {
        plugins: [
          cloudflareTest({
            miniflare: {
              compatibilityDate: "2026-08-01",
              bindings: { ENVIRONMENT: "development" },
            },
          }),
        ],
        test: {
          name: "workers",
          include: [
            "test/api/**/*.test.ts",
            "test/adapters/**/*.test.ts",
            "test/migrations/**/*.test.ts",
            "test/admin/**/*.test.ts",
          ],
        },
      },
    ],
  },
});
