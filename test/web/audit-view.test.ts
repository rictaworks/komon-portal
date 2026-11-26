import { describe, expect, it } from "vitest";
import { auditActorLabelKey, auditListPath } from "../../src/app/web/pages/office/audit-view";
import en from "../../src/locales/en.json";

describe("auditActorLabelKey", () => {
  it("does not show a refused request from nobody as the system's doing", () => {
    expect(auditActorLabelKey({ actorUserId: null, targetType: "request" })).toBe("office.audit.anonymous");
  });

  it("names the system for what the system did", () => {
    expect(auditActorLabelKey({ actorUserId: null, targetType: "case" })).toBe("office.audit.system");
    expect(auditActorLabelKey({ actorUserId: null, targetType: "file" })).toBe("office.audit.system");
  });

  it("uses two different words", () => {
    expect(en.office.audit.anonymous).not.toBe(en.office.audit.system);
  });
});

describe("auditListPath", () => {
  it("requests one entry more than a page, from the given offset", () => {
    expect(auditListPath({ clientId: null, offset: 0, pageSize: 50 })).toBe("/api/office/audit?limit=51&offset=0");
    expect(auditListPath({ clientId: null, offset: 100, pageSize: 50 })).toBe("/api/office/audit?limit=51&offset=100");
  });

  it("names the client when the list is narrowed to one", () => {
    expect(auditListPath({ clientId: "c-42", offset: 50, pageSize: 50 })).toBe("/api/office/audit?limit=51&offset=50&clientId=c-42");
  });
});
