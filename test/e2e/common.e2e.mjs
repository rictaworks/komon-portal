// Browser check of the shell and the common screens against the local development server.
// Run: npm run dev (in another terminal), then npm run test:e2e
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8787";
const SHOTS = process.env.E2E_SCREENSHOTS ?? "test-results/e2e";
const failures = [];

/** Waits for something to appear; a page that is still loading is not a failure. */
async function appears(locator) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

function check(name, condition, detail = "") {
  console.info(`${condition ? "ok  " : "FAIL"} ${name}${condition || detail === "" ? "" : ` (${detail})`}`);
  if (!condition) {
    failures.push(name);
  }
}

async function run() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("dialog", (dialog) => {
    failures.push(`native dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });

  const response = await page.goto(`${BASE}/`);
  await page.waitForURL("**/sign-in**");
  check("an anonymous visitor is sent to Sign in", page.url().includes("/sign-in"));
  check("the title comes from the language pack", (await page.title()) === "Komon Portal");
  const csp = response?.headers()["content-security-policy"] ?? "";
  check("pages carry the Content-Security-Policy", csp.includes("frame-ancestors 'none'") && !csp.includes("unsafe-inline"));
  check("the privacy note is shown", await appears(page.getByText("Your email address is not requested or stored.")));
  check("the development sign-in is offered in development", await appears(page.getByRole("button", { name: "Test Owner" })));
  await page.screenshot({ path: `${SHOTS}/sign-in-desktop.png`, fullPage: true });

  await page.goto(`${BASE}/notices`);
  check("Open-source notices show the licence and the Jev terms", (await appears(page.getByText("MIT License"))) && (await appears(page.getByRole("heading", { name: "Jev classifier (bring your own key)" }))));
  await page.goto(`${BASE}/no-such-page`);
  check("an unknown address shows the not-found page", await appears(page.getByRole("heading", { name: "Page not found" })));

  await page.goto(`${BASE}/redeem#sample-code-123`);
  check("Use an invitation asks for sign-in first", await appears(page.getByText("Sign in with Google first.")));
  check("the code is removed from the address bar", !page.url().includes("sample-code-123"));

  await page.goto(`${BASE}/sign-in`);
  await page.getByRole("button", { name: "Test Client Member" }).click();
  await page.waitForURL("**/client/**");
  check("a client member lands in the client area", page.url().includes("/client/dev-client/"));
  await page.goto(`${BASE}/redeem`);
  await page.waitForSelector("#invitation-code");
  check("the invitation form shows the code typed earlier in this tab", (await page.inputValue("#invitation-code")) === "sample-code-123");
  check("the submit button stays disabled until the human check passes", await page.getByRole("button", { name: "Use invitation" }).isDisabled());
  await page.screenshot({ path: `${SHOTS}/redeem-desktop.png`, fullPage: true });

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await phone.newPage();
  await mobile.goto(`${BASE}/sign-in`);
  await mobile.waitForSelector("text=Sign in");
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("Sign in fits a phone without sideways scrolling", overflow <= 0, `overflow ${overflow}px`);
  await mobile.screenshot({ path: `${SHOTS}/sign-in-phone.png`, fullPage: true });

  check("no errors were logged in the browser console", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
  if (failures.length > 0) {
    throw new Error(`${failures.length} check(s) failed: ${failures.join("; ")}`);
  }
}

await run();
