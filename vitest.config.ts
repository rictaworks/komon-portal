import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
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
          cloudflareTest(async () => ({
            miniflare: {
              compatibilityDate: "2026-08-01",
              d1Databases: ["DB"],
              bindings: {
                ENVIRONMENT: "development",
                TEST_MIGRATIONS: await readD1Migrations("src/app/migrations"),
              },
            },
          })),
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
