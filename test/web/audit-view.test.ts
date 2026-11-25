import { describe, expect, it } from "vitest";
import { auditActorLabelKey } from "../../src/app/web/pages/office/audit-view";
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
