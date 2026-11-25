// Playwright settings for the end-to-end run. Started by test/e2e/run.mjs (npm run test:e2e), which
// starts the local Worker first and passes its address and the directory of this run.
import { defineConfig, devices } from "@playwright/test";

/**
 * @param {string} name
 * @returns {string}
 */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Start the end-to-end tests with: npm run test:e2e`);
  }
  return value;
}

const inCi = process.env.CI !== undefined && process.env.CI !== "";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  // Every run has its own new directory, so nothing from an earlier run is ever cleaned away.
  outputDir: required("E2E_OUTPUT_DIR"),
  // One local Worker and one database serve the whole run: the tests run one after another.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // Generous: the local Worker may share the machine with other work.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: inCi ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: required("E2E_BASE_URL"),
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
