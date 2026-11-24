import { describe, expect, it } from "vitest";
import { deriveCaseState } from "../../../src/core/cases/case-state";
import type { CaseFileSummary } from "../../../src/core/ports/repository";

const none: CaseFileSummary = { outbound: 0, published: 0, publishedAndOpened: 0, inbound: 0 };

describe("deriveCaseState", () => {
  it("is Open without a submission date and Submitted with one", () => {
    expect(deriveCaseState({ state: "Open", submittedOn: null }, "Procedure", none)).toBe("Open");
    expect(deriveCaseState({ state: "Open", submittedOn: "2026-11-01" }, "Procedure", none)).toBe("Submitted");
  });

  it("is MaterialsReceived when a client submission is linked to a payroll case", () => {
    expect(deriveCaseState({ state: "Open", submittedOn: null }, "Payroll", { ...none, inbound: 1 })).toBe("MaterialsReceived");
    expect(deriveCaseState({ state: "Open", submittedOn: null }, "Procedure", { ...none, inbound: 1 })).toBe("Open");
  });

  it("advances with the linked documents", () => {
    const record = { state: "Submitted" as const, submittedOn: "2026-11-01" };
    expect(deriveCaseState(record, "Procedure", { ...none, outbound: 1 })).toBe("DocumentReceived");
    expect(deriveCaseState(record, "Procedure", { ...none, outbound: 2, published: 1 })).toBe("Delivered");
    expect(deriveCaseState(record, "Procedure", { ...none, outbound: 2, published: 1, publishedAndOpened: 1 })).toBe("Confirmed");
    expect(deriveCaseState({ state: "MaterialsReceived", submittedOn: null }, "Payroll", { ...none, outbound: 1, inbound: 1 })).toBe("DocumentReceived");
  });

  it("falls back when published documents are all withdrawn", () => {
    expect(deriveCaseState({ state: "Confirmed", submittedOn: "2026-11-01" }, "Procedure", { ...none, outbound: 1 })).toBe("DocumentReceived");
    expect(deriveCaseState({ state: "Delivered", submittedOn: null }, "Procedure", { ...none, outbound: 1 })).toBe("DocumentReceived");
  });

  it("falls back to Submitted or Open when no document is left", () => {
    expect(deriveCaseState({ state: "DocumentReceived", submittedOn: "2026-11-01" }, "Procedure", none)).toBe("Submitted");
    expect(deriveCaseState({ state: "DocumentReceived", submittedOn: null }, "Procedure", none)).toBe("Open");
  });

  it("never leaves Closed or Cancelled", () => {
    const busy = { outbound: 1, published: 1, publishedAndOpened: 1, inbound: 1 };
    expect(deriveCaseState({ state: "Closed", submittedOn: null }, "Payroll", busy)).toBe("Closed");
    expect(deriveCaseState({ state: "Cancelled", submittedOn: "2026-11-01" }, "Procedure", busy)).toBe("Cancelled");
  });
});
