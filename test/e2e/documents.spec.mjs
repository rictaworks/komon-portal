// The flow people use every day, each person in a separate browser session:
// the office takes a file in, reviews it and publishes it, the client member opens it,
// the client member sends files back, and the office sees them.
import { Buffer } from "node:buffer";
import { DEMO_CLIENT, expect, test } from "./support.mjs";

const OUTBOUND_TYPE = { label: "Payslip", shortCode: "PAY" };
const INBOUND_TYPE = { label: "Timesheet", shortCode: "TIME" };
const DEMO_LABEL = `${DEMO_CLIENT.code} ${DEMO_CLIENT.name}`;
// A name without a client code, a corporate number or an arrival number: the office has to decide the client.
const OFFICE_FILE = { name: "statement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% end-to-end document from the office\n%%EOF\n") };
const CLIENT_FILES = [
  { name: "hours.csv", mimeType: "text/csv", buffer: Buffer.from("day,hours\n2026-10-01,8\n2026-10-02,7.5\n") },
  { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("Overtime on the second day was approved.\n") },
];

/**
 * @param {import("@playwright/test").Download} download
 * @returns {Promise<Buffer>}
 */
async function contentOf(download) {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of await download.createReadStream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

test("a document goes from intake through review and publishing to the client, and files come back", async ({ sessions }) => {
  // The first sign-in of the test client member creates the demo client the office works with.
  const member = await sessions.as("member");
  await expect(member.getByText("No new documents.")).toBeVisible();

  const owner = await sessions.as("owner");
  const staff = await sessions.as("staff");

  await test.step("the owner adds a document type for each direction", async () => {
    await owner.goto("/office/settings");
    const types = owner.getByRole("region", { name: "Document types" });
    for (const [type, direction] of /** @type {const} */ ([[OUTBOUND_TYPE, "Outbound (office to client)"], [INBOUND_TYPE, "Inbound (client to office)"]])) {
      await types.getByLabel("Label", { exact: true }).fill(type.label);
      await types.getByLabel("Short code", { exact: true }).fill(type.shortCode);
      await types.getByLabel("Direction", { exact: true }).selectOption({ label: direction });
      await types.getByRole("button", { name: "Add document type" }).click();
      await expect(types.getByRole("listitem").filter({ hasText: type.label }).filter({ hasText: direction })).toBeVisible();
    }
  });

  await test.step("staff take a file in, and it waits for review", async () => {
    await staff.goto("/office/intake");
    await staff.locator('input[type="file"][aria-label="Choose files"]').setInputFiles(OFFICE_FILE);
    await expect(staff.getByText("1 need review")).toBeVisible();
    await expect(staff.getByText("0 rejected")).toBeVisible();
    const row = staff.getByRole("row").filter({ hasText: "UNASSIGNED_UNCLASSIFIED_" });
    await expect(row.getByText("Needs review")).toBeVisible();
    await expect(row.getByText("No client could be identified")).toBeVisible();
    // The name the file was chosen by is never shown or stored.
    await expect(staff.getByText(OFFICE_FILE.name)).toHaveCount(0);
  });

  await test.step("staff review it: choose the client and the type, then stage it", async () => {
    await staff.getByRole("link", { name: "Go to review" }).click();
    await expect(staff.getByRole("heading", { name: "Review", level: 1 })).toBeVisible();
    const decision = staff.getByRole("region", { name: "Decision" });
    await expect(decision.getByText("No client chosen")).toBeVisible();
    await decision.getByRole("combobox", { name: "Client" }).fill(DEMO_CLIENT.code);
    await decision.getByRole("option", { name: DEMO_LABEL }).click();
    await expect(decision.getByText("Assigning to")).toBeVisible();
    await decision.getByLabel("Document type").selectOption({ label: `${OUTBOUND_TYPE.shortCode} ${OUTBOUND_TYPE.label}` });
    await decision.getByRole("button", { name: "Stage", exact: true }).click();
    await expect(staff.getByText("Nothing needs review.")).toBeVisible();
  });

  await test.step("the client member sees nothing before it is published", async () => {
    await member.goto(`/client/${DEMO_CLIENT.id}/documents`);
    await expect(member.getByText("No documents match.")).toBeVisible();
  });

  await test.step("the owner publishes it after confirming the client", async () => {
    await owner.goto("/office/staged");
    await owner.getByRole("checkbox", { name: `Select all for ${DEMO_CLIENT.code}` }).check();
    await expect(owner.getByRole("heading", { name: "1 document(s) selected" })).toBeVisible();
    await owner.getByRole("button", { name: "Publish to 1 client(s)" }).click();
    const dialog = owner.getByRole("dialog", { name: "Publish 1 document(s)?" });
    await expect(dialog.getByText(DEMO_CLIENT.name)).toBeVisible();
    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(owner.getByText(new RegExp(`^Published ${DEMO_CLIENT.code}_${OUTBOUND_TYPE.shortCode}_\\d{8}_\\d{2}\\.$`))).toBeVisible();
    await expect(owner.getByText("No staged documents.")).toBeVisible();
  });

  await test.step("the client member finds it as new and opens it", async () => {
    await member.goto(`/client/${DEMO_CLIENT.id}/home`);
    await expect(member.getByRole("heading", { name: "New documents 1" })).toBeVisible();
    await member.goto(`/client/${DEMO_CLIENT.id}/documents`);
    const card = member.getByRole("article").filter({ hasText: OUTBOUND_TYPE.label });
    await expect(card.getByText("New", { exact: true })).toBeVisible();
    // The screen asks for the file with a protected POST, which records the first view, and only then downloads it.
    const [opened, download] = await Promise.all([
      member.waitForResponse((response) => response.request().method() === "POST" && /\/api\/files\/[^/]+\/open$/.test(new URL(response.url()).pathname)),
      member.waitForEvent("download"),
      card.getByRole("button", { name: "Download" }).click(),
    ]);
    expect(opened.status()).toBe(200);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${DEMO_CLIENT.code}_${OUTBOUND_TYPE.shortCode}_\\d{8}_\\d{2}\\.pdf$`));
    expect((await contentOf(download)).equals(OFFICE_FILE.buffer)).toBe(true);
    await expect(card.getByText("Opened", { exact: true })).toBeVisible();
    await expect(card.getByText("New", { exact: true })).toHaveCount(0);
  });

  await test.step("the client member sends two files, each with its own result", async () => {
    await member.goto(`/client/${DEMO_CLIENT.id}/send`);
    await expect(member.getByText("Nothing sent yet.")).toBeVisible();
    const form = member.getByRole("form", { name: "Send files to the office" });
    await form.getByLabel("Type", { exact: true }).selectOption({ label: INBOUND_TYPE.label });
    await form.getByLabel("Target month").fill("2026-10");
    await form.locator('input[type="file"]').setInputFiles(CLIENT_FILES);
    await expect(form.getByRole("list", { name: "Chosen files" }).getByRole("listitem")).toHaveCount(CLIENT_FILES.length);
    await form.getByRole("button", { name: "Send to office" }).click();
    const results = member.getByRole("region", { name: "Results" });
    await expect(results.getByText("The file was sent to the office.")).toHaveCount(CLIENT_FILES.length);
    await expect(results.getByText("Not sent")).toHaveCount(0);
    const sent = member.getByRole("region", { name: "Sent files" });
    await expect(sent.getByRole("article").filter({ hasText: INBOUND_TYPE.label })).toHaveCount(CLIENT_FILES.length);
  });

  await test.step("the office sees the sent files on the dashboard and on the client's shelf", async () => {
    await owner.goto("/office/dashboard");
    const waiting = owner.locator("#submissions").getByRole("listitem").filter({ hasText: DEMO_LABEL });
    await expect(waiting).toHaveCount(CLIENT_FILES.length);
    await waiting.first().getByRole("link", { name: "Open shelf" }).click();
    await owner.waitForURL(new RegExp(`/office/shelf/${DEMO_CLIENT.id}\\?`));
    await expect(owner.getByRole("button", { name: "From client" })).toHaveAttribute("aria-pressed", "true");
    const received = owner.getByRole("region", { name: "From client" }).getByRole("row").filter({ hasText: INBOUND_TYPE.label });
    await expect(received).toHaveCount(CLIENT_FILES.length);
    await expect(received.first().getByText("Not opened by the office yet")).toBeVisible();

    await owner.getByRole("button", { name: "To client" }).click();
    const published = owner.getByRole("region", { name: "To client" }).getByRole("row").filter({ hasText: OUTBOUND_TYPE.label });
    await expect(published).toHaveCount(1);
    // The first view the client member's download recorded.
    await expect(published.getByText(/first opened/)).toBeVisible();
  });
});
