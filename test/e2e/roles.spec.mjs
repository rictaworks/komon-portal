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
  await expect(page.getByText(DEMO_CLIENT.name).first()).toBeVisible();
  await page.goto("/office/dashboard");
  await expect(page.getByRole("heading", { name: "No access yet" })).toBeVisible();
  await page.goto("/client/another-client/home");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("signing out ends the session", async ({ sessions }) => {
  const page = await sessions.as("owner");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/sign-in/);
  await page.goto("/office/dashboard");
  await page.waitForURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
