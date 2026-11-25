// Shared pieces of the end-to-end tests: sessions for the development roles and a watch on every page.
import { expect, test as base } from "@playwright/test";

/** The ready-made client the development sign-in creates for the test client member. */
export const DEMO_CLIENT = { id: "dev-client", code: "DEMO01", name: "Demo Client" };

/** @typedef {"owner" | "staff" | "member"} Role */

/** @type {Readonly<Record<Role, { button: string; landing: RegExp }>>} */
const ROLES = {
  owner: { button: "Test Owner", landing: /\/office\/dashboard$/ },
  staff: { button: "Test Staff", landing: /\/office\/dashboard$/ },
  member: { button: "Test Client Member", landing: new RegExp(`/client/${DEMO_CLIENT.id}/home$`) },
};

/**
 * @typedef {object} Sessions
 * @property {(role: Role) => Promise<import("@playwright/test").Page>} as A new browser session signed in through the development sign-in.
 * @property {(options?: import("@playwright/test").BrowserContextOptions) => Promise<import("@playwright/test").Page>} anonymous A new browser session nobody is signed in to.
 */

/**
 * `sessions` opens separate browser sessions, one per person in a flow. Every page is watched: an
 * error in the browser console, an uncaught error or a native dialog fails the test that caused it.
 */
export const test = base.extend(
  /** @type {import("@playwright/test").Fixtures<{ sessions: Sessions }, {}, import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions, import("@playwright/test").PlaywrightWorkerArgs>} */ ({
    sessions: async ({ browser, contextOptions }, use) => {
      /** @type {import("@playwright/test").BrowserContext[]} */
      const contexts = [];
      /** @type {string[]} */
      const problems = [];

      /** @param {import("@playwright/test").BrowserContextOptions} options */
      const open = async (options) => {
        const context = await browser.newContext({ ...contextOptions, ...options });
        contexts.push(context);
        const page = await context.newPage();
        page.on("console", (message) => {
          if (message.type() === "error") {
            problems.push(`console error on ${page.url()}: ${message.text()}`);
          }
        });
        page.on("pageerror", (error) => problems.push(`uncaught error on ${page.url()}: ${error.message}`));
        page.on("dialog", (dialog) => {
          problems.push(`native dialog on ${page.url()}: ${dialog.message()}`);
          void dialog.dismiss();
        });
        return page;
      };

      await use({
        anonymous: (options = {}) => open(options),
        as: async (role) => {
          const page = await open({});
          await page.goto("/sign-in");
          await page.getByRole("button", { name: ROLES[role].button, exact: true }).click();
          await page.waitForURL(ROLES[role].landing);
          return page;
        },
      });

      for (const context of contexts) {
        await context.close();
      }
      expect(problems, "browser console errors, uncaught errors and native dialogs").toEqual([]);
    },
  }),
);

export { expect };
