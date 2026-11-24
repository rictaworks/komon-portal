import { describe, expect, it } from "vitest";
import { decideByRules } from "../../../src/core/intake/doc-type-decider";
import { docRule, docType } from "../../support/builders";

const types = [
  docType({ id: "d1", shortCode: "SHAHO", direction: "Outbound" }),
  docType({ id: "d2", shortCode: "KOYOU", direction: "Both" }),
  docType({ id: "d3", shortCode: "KYUYO", direction: "Inbound" }),
];
const rules = [
  docRule({ id: "r1", docTypeId: "d1", keyword: "Hyojun" }),
  docRule({ id: "r2", docTypeId: "d1", keyword: "kettei" }),
  docRule({ id: "r3", docTypeId: "d2", keyword: "koyou" }),
  docRule({ id: "r4", docTypeId: "d3", keyword: "kyuyo" }),
];

describe("decideByRules", () => {
  it("picks the single type whose keyword appears in the title", () => {
    expect(decideByRules("C0031_hyojun_notice", "Outbound", types, rules)).toEqual({ docTypeId: "d1", source: "Rule" });
  });

  it("treats several keywords of the same type as one match", () => {
    expect(decideByRules("HYOJUN-KETTEI", "Outbound", types, rules)).toEqual({ docTypeId: "d1", source: "Rule" });
  });

  it("leaves the file unclassified when keywords of several types match", () => {
    expect(decideByRules("hyojun_koyou", "Outbound", types, rules)).toEqual({ docTypeId: null, source: null });
  });

  it("leaves the file unclassified when nothing matches", () => {
    expect(decideByRules("misc", "Outbound", types, rules)).toEqual({ docTypeId: null, source: null });
  });

  it("only considers types of the file's direction", () => {
    expect(decideByRules("kyuyo", "Outbound", types, rules)).toEqual({ docTypeId: null, source: null });
    expect(decideByRules("kyuyo", "Inbound", types, rules)).toEqual({ docTypeId: "d3", source: "Rule" });
    expect(decideByRules("koyou", "Inbound", types, rules)).toEqual({ docTypeId: "d2", source: "Rule" });
  });

  it("matches full-width and half-width forms alike", () => {
    const wide = String.fromCharCode(0xff28, 0xff39, 0xff2f, 0xff2a, 0xff35, 0xff2e);
    expect(decideByRules(wide, "Outbound", types, rules)).toEqual({ docTypeId: "d1", source: "Rule" });
  });
});
