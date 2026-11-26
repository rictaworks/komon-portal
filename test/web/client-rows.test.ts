import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/app/web/api/client";
import type { ClientCase, ClientDocument, Submission } from "../../src/app/web/api/client-types";
import { Pager } from "../../src/app/web/components/Pager";
import { englishTranslator, I18nContext } from "../../src/app/web/i18n";
import { IndividualNumberNotice } from "../../src/app/web/components/Notice";
import { CaseRow, ChosenFiles, DocumentCard, NewDocumentsHeading, SendResults, SubmissionCard, UnreadRow } from "../../src/app/web/pages/client/ClientRows";

function ignore(): void {
  // The markup test never presses a button.
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(I18nContext.Provider, { value: englishTranslator() }, createElement(MemoryRouter, null, element)));
}

/** Text of the markup with tags removed, so that wording is checked apart from structure. */
function textOf(html: string): string {
  return html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Every badge in the markup: its tone, whether it carries an icon, and its word. */
function badges(html: string): Array<{ tone: string; icon: boolean; word: string }> {
  return [...html.matchAll(/<span class="badge badge--(\w+)">([\s\S]*?)<\/span>/g)].map((match) => ({
    tone: match[1] ?? "",
    icon: /^<svg[^>]*aria-hidden="true"/.test(match[2] ?? ""),
    word: textOf(match[2] ?? ""),
  }));
}

function document(overrides: Partial<ClientDocument> = {}): ClientDocument {
  return {
    id: "f1", displayName: "C0031_KYUYO_20261120_01", format: "pdf", sizeBytes: 2048, docType: { id: "d1", shortCode: "KYUYO", label: "Payroll statement" },
    targetMonth: "2026-11", publishedAt: "2026-11-20T03:00:00.000Z", opened: false, ...overrides,
  };
}

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "s1", displayName: "C0031_KYUYOZAI_20261124_01", format: "csv", sizeBytes: 100, docType: { id: "d2", shortCode: "KYUYOZAI", label: "Payroll material" },
    targetMonth: "2026-11", state: "Submitted", submittedAt: "2026-11-24T03:00:00.000Z", acknowledgedAt: null, canCancel: true, version: 1, ...overrides,
  };
}

describe("client home rows", () => {
  it("heads the page with the new documents and their count", () => {
    const html = render(createElement(NewDocumentsHeading, { count: 12 }));
    expect(html).toMatch(/^<h1[^>]*>New documents <span class="count">12<\/span><\/h1>$/);
  });

  it("shows an unread document with its type, target month in words, publication day and a New badge", () => {
    const html = render(createElement(UnreadRow, { clientId: "c1", document: document() }));
    expect(textOf(html)).toBe("Payroll statement November 2026, published 20 Nov 2026 New");
    expect(html).toContain('href="/client/c1/documents"');
    expect(badges(html)).toEqual([{ tone: "staged", icon: true, word: "New" }]);
  });

  it("shows a case with its kind, target month in words and a state badge", () => {
    const record: ClientCase = { id: "k1", kind: "Procedure", typeLabel: "Social insurance", targetMonth: "2026-11", state: "DocumentReceived" };
    const html = render(createElement(CaseRow, { record }));
    expect(textOf(html)).toBe("Social insurance Procedure, November 2026 Document received");
    expect(badges(html)).toEqual([{ tone: "staged", icon: true, word: "Document received" }]);
  });

  it("gives every case state a badge with a word and an icon", () => {
    for (const state of ["Open", "Submitted", "MaterialsReceived", "DocumentReceived", "Delivered", "Confirmed", "Closed", "Cancelled"]) {
      const found = badges(render(createElement(CaseRow, { record: { id: "k1", kind: "Payroll", typeLabel: "Payroll", targetMonth: "2026-10", state } })));
      expect([state, found.length, found[0]?.icon, (found[0]?.word ?? "") !== ""]).toEqual([state, 1, true, true]);
    }
  });
});

describe("client document card", () => {
  it("shows the type, the target month in words, the publication day, the file name and whether it was opened", () => {
    const fresh = render(createElement(DocumentCard, { document: document(), busy: false, onOpen: ignore }));
    expect(textOf(fresh)).toBe("Payroll statement November 2026, published 20 Nov 2026 C0031_KYUYO_20261120_01 New View Download");
    expect(badges(fresh)).toEqual([{ tone: "staged", icon: true, word: "New" }]);
    const seen = render(createElement(DocumentCard, { document: document({ opened: true }), busy: false, onOpen: ignore }));
    expect(badges(seen)).toEqual([{ tone: "neutral", icon: true, word: "Opened" }]);
  });

  it("opens through buttons with an icon each, never through a plain link", () => {
    const html = render(createElement(DocumentCard, { document: document(), busy: false, onOpen: ignore }));
    expect(html).not.toContain("<a ");
    expect([...html.matchAll(/<button type="button"[^>]*><svg[^>]*aria-hidden="true"/g)]).toHaveLength(2);
  });

  it("says so when a document has no type or no target month", () => {
    const html = render(createElement(DocumentCard, { document: document({ docType: null, targetMonth: null }), busy: false, onOpen: ignore }));
    expect(textOf(html)).toBe("Document No target month, published 20 Nov 2026 C0031_KYUYO_20261120_01 New View Download");
  });
});

describe("sent file card", () => {
  it("shows the type, the target month in words, when it was sent and a Sent badge, with the way to cancel", () => {
    const html = render(createElement(SubmissionCard, { submission: submission(), busy: false, onCancel: ignore }));
    expect(textOf(html)).toMatch(/^Payroll material November 2026, sent 24 Nov 2026, \d\d:\d\d C0031_KYUYOZAI_20261124_01 Sent Cancel this submission$/);
    expect(badges(html)).toEqual([{ tone: "staged", icon: true, word: "Sent" }]);
  });

  it("shows the office's confirmation as a badge and offers no cancelling after it", () => {
    const html = render(createElement(SubmissionCard, { submission: submission({ state: "Acknowledged", acknowledgedAt: "2026-11-25T03:00:00.000Z", canCancel: false }), busy: false, onCancel: ignore }));
    expect(badges(html)).toEqual([{ tone: "published", icon: true, word: "Confirmed by the office" }]);
    expect(html).not.toContain("<button");
    expect(textOf(html)).toMatch(/Confirmed by the office on 25 Nov 2026, \d\d:\d\d$/);
  });
});

describe("chosen files after a partial send", () => {
  it("shows a file that stays chosen under the same number as its result row", () => {
    // Files a, b, c were chosen as 1, 2, 3. b was rejected, so it stays chosen with its number.
    const english = englishTranslator();
    const chosen = render(createElement(ChosenFiles, { busy: false, onRemove: ignore, files: [{ key: "2", number: 2, size: 1024 }] }));
    const results = render(createElement(SendResults, {
      busy: false,
      onOpenExisting: ignore,
      rows: [
        { key: "1", position: 1, size: 2048, outcome: { outcome: "stored" } },
        { key: "2", position: 2, size: 1024, outcome: { outcome: "rejected", reason: "UnsupportedFormat" } },
        { key: "3", position: 3, size: 512, outcome: { outcome: "stored" } },
      ],
    }));
    expect(textOf(chosen)).toBe(`File 2 1.0 KB ${english("client.send.remove")}`);
    const rejected = [...results.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((match) => textOf(match[1] ?? ""))[1];
    expect(rejected?.startsWith("File 2 ")).toBe(true);
  });
});

describe("send results", () => {
  it("gives each file its own result with its position, its size and its reason", () => {
    const html = render(createElement(SendResults, {
      busy: false,
      onOpenExisting: ignore,
      rows: [
        { key: "1", position: 1, size: 2048, outcome: { outcome: "stored" } },
        { key: "2", position: 2, size: 1024, outcome: { outcome: "rejected", reason: "UnsupportedFormat" } },
        { key: "3", position: 3, size: 512, outcome: { outcome: "duplicate" } },
        { key: "4", position: 4, size: 4096, outcome: { outcome: "failed", error: new ApiError(0, "network_error", null) } },
      ],
    }));
    const english = englishTranslator();
    const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((match) => textOf(match[1] ?? ""));
    expect(items).toEqual([
      `File 1 2.0 KB ${english("client.send.storedReason")} ${english("client.send.result.stored")}`,
      `File 2 1.0 KB ${english("client.send.rejected", { reason: english("rejection.UnsupportedFormat") })} ${english("client.send.result.notSent")}`,
      `File 3 512 B ${english("client.send.duplicate")} ${english("client.send.result.notSent")}`,
      `File 4 4.0 KB ${english("errors.network_error._")} ${english("client.send.result.notSent")}`,
    ]);
    expect(badges(html).map((badge) => [badge.tone, badge.icon])).toEqual([["published", true], ["danger", true], ["neutral", true], ["danger", true]]);
  });

  it("names the existing copy of a duplicate and offers to open it when the member may open it", () => {
    const html = render(createElement(SendResults, {
      busy: false,
      onOpenExisting: ignore,
      rows: [{ key: "1", position: 2, size: 2048, outcome: { outcome: "duplicate", existingFileId: "f9", existingDisplayName: "C0031_KYUYO_20261120_01" } }],
    }));
    expect(textOf(html)).toContain("This content is already held for your company as C0031_KYUYO_20261120_01, so it was not sent again.");
    expect(html).toMatch(/<button type="button" class="button button--small"[^>]*><svg[\s\S]*?<\/svg>Open the existing copy<\/button>/);
  });

  it("names no file and offers no link when the member may not see the existing copy", () => {
    const html = render(createElement(SendResults, {
      busy: false,
      onOpenExisting: ignore,
      rows: [{ key: "1", position: 1, size: 2048, outcome: { outcome: "duplicate", existingFileId: null, existingDisplayName: null } }],
    }));
    expect(textOf(html)).toContain(englishTranslator()("client.send.duplicate"));
    expect(html).not.toContain("<button");
  });

  it("renders nothing before anything was sent", () => {
    expect(render(createElement(SendResults, { rows: [], busy: false, onOpenExisting: ignore }))).toBe("");
  });
});

describe("Individual Number notice", () => {
  it("reads as the mock asks", () => {
    expect(textOf(render(createElement(IndividualNumberNotice)))).toBe("Do not send documents that contain an Individual Number (My Number).");
  });
});

describe("Pager", () => {
  const pager = (page: number, hasMore: boolean): string => render(createElement(Pager, { page, hasMore, busy: false, onPage: ignore }));

  it("stays away when everything fits on one page", () => {
    expect(pager(0, false)).toBe("");
  });

  it("offers only the way forward on the first page and only the way back on the last", () => {
    expect(textOf(pager(0, true))).toBe("Previous Page 1 Next");
    expect(pager(0, true)).toMatch(/<button type="button" class="button" disabled="">.*Previous/);
    expect(pager(0, true)).not.toMatch(/disabled=""[^>]*>(?:<svg[\s\S]*?<\/svg>)?Next/);
    expect(textOf(pager(2, false))).toBe("Previous Page 3 Next");
    expect(pager(2, false)).toMatch(/disabled="">Next/);
  });
});
