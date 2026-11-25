// Each development role signs in through the sign-in screen and reaches its own area, and only that.
import { DEMO_CLIENT, expect, test } from "./support.mjs";

test("the owner lands on the dashboard and reaches the audit log", async ({ sessions }) => {
  const page = await sessions.as("owner");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await page.goto("/office/audit");
  await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
});

test("staff land on the dashboard and do not reach the audit log", async ({ sessions }) => {
  const page = await sessions.as("staff");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await page.goto("/office/audit");
  await expect(page.getByRole("heading", { name: "No access yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit log" })).toHaveCount(0);
});

test("a client member lands in the company's area and reaches neither the office nor another company", async ({ sessions }) => {
  const page = await sessions.as("member");
  await expect(page.getByRole("heading", { name: /^New documents/ })).toBeVisible();
  const company = page.getByRole("combobox", { name: "Company" });
  await expect(company).toHaveValue(DEMO_CLIENT.id);
  await expect(company.locator("option:checked")).toHaveText(DEMO_CLIENT.name);
  await page.goto("/office/dashboard");
  await expect(page.getByRole("heading", { name: "No access yet" })).toBeVisible();
  await page.goto("/client/another-client/home");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("signing out ends the session", async ({ sessions }) => {
  const page = await sessions.as("owner");
  const [loggedOut] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/auth/logout"),
    page.getByRole("button", { name: "Sign out" }).click(),
  ]);
  expect(loggedOut.status()).toBe(200);
  // The server no longer knows the browser, and the start page sends it to Sign in.
  const session = await page.request.get("/api/session");
  expect(await session.json()).toEqual({ me: null });
  await page.goto("/");
  await page.waitForURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("signing out in the office goes to Sign in, not to the no-access page", async ({ sessions }) => {
  const page = await sessions.as("staff");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/sign-in\?return=%2Foffice%2Fdashboard$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No access yet" })).toHaveCount(0);
});

test("signing out in the client area goes to Sign in, not to the not-found page", async ({ sessions }) => {
  const page = await sessions.as("member");
  await page.waitForURL(new RegExp(`/client/${DEMO_CLIENT.id}/home$`));
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(new RegExp(`/sign-in\\?return=%2Fclient%2F${DEMO_CLIENT.id}%2Fhome$`));
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
});
