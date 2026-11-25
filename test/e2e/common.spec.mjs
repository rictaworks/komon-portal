// The shell and the common screens, as a visitor who is not signed in and as a client member.
import { DEMO_CLIENT, expect, test } from "./support.mjs";

test("an anonymous visitor is sent to Sign in, with the security headers and the development sign-in", async ({ sessions }) => {
  const page = await sessions.anonymous();
  const response = await page.goto("/");
  await page.waitForURL(/\/sign-in/);
  await expect(page).toHaveTitle("Komon Portal");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe-inline");
  await expect(page.getByText("Your email address is not requested or stored.")).toBeVisible();
  for (const name of ["Test Owner", "Test Staff", "Test Client Member"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
});

test("the open-source notices and the not-found page are public", async ({ sessions }) => {
  const page = await sessions.anonymous();
  await page.goto("/notices");
  await expect(page.getByText("MIT License").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Jev classifier (bring your own key)" })).toBeVisible();
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("an invitation code leaves the address bar and is kept for the form after sign-in", async ({ sessions }) => {
  const page = await sessions.anonymous();
  await page.goto("/redeem#sample-code-123");
  await expect(page.getByText("Sign in with Google first.")).toBeVisible();
  expect(page.url()).not.toContain("sample-code-123");

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Test Client Member", exact: true }).click();
  await page.waitForURL(new RegExp(`/client/${DEMO_CLIENT.id}/`));
  await page.goto("/redeem");
  await expect(page.getByLabel("Invitation code")).toHaveValue("sample-code-123");
  // The run configures no human check, so the form says so and cannot be sent.
  await expect(page.getByText("The human check is not configured on this installation, so this form cannot be used.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use invitation" })).toBeDisabled();
});

test("Sign in fits a phone without sideways scrolling", async ({ sessions }) => {
  const page = await sessions.anonymous({ viewport: { width: 390, height: 844 } });
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
