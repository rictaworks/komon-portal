import { beforeEach, describe, expect, it } from "vitest";
import { ClientResolver } from "../../../src/core/intake/client-resolver";
import type { ExtractedKeys } from "../../../src/core/intake/key-extractor";
import { caseRecord, caseType, client } from "../../support/builders";
import { MemoryRepository } from "../../support/memory-repository";
import { CORPORATE_NUMBER } from "./fixtures";

const A1 = "202611240912345678";
const A2 = "202611250912345678";
const UNKNOWN = "202601010000000000";

function keys(partial: Partial<ExtractedKeys> = {}): ExtractedKeys {
  return { arrivalNumbers: [], clientCodes: [], corporateNumbers: [], ...partial };
}

describe("ClientResolver", () => {
  let repo: MemoryRepository;
  let resolver: ClientResolver;

  beforeEach(async () => {
    repo = new MemoryRepository();
    repo.clientRows.push(
      client({ id: "c1", code: "C0031" }),
      client({ id: "c2", code: "C0142", corporateNumber: CORPORATE_NUMBER }),
      client({ id: "c3", code: "C0207", status: "Archived" }),
    );
    repo.caseTypeRows.push(caseType());
    repo.caseRows.push(caseRecord({ id: "k1", clientId: "c1" }), caseRecord({ id: "k2", clientId: "c2" }));
    repo.arrivalRows.push({ id: "a1", caseId: "k1", arrivalNumber: A1 }, { id: "a2", caseId: "k2", arrivalNumber: A2 });
    resolver = new ClientResolver(repo);
  });

  it("a: sends conflicting keys to review", async () => {
    const result = await resolver.resolve(keys({ arrivalNumbers: [A1], clientCodes: ["C0142"] }), null);
    expect(result).toMatchObject({ clientId: null, caseId: null, method: null, reviewReason: "ConflictingKeys" });
    expect(result.evidence).toEqual([
      { kind: "ArrivalNumber", clientId: "c1" },
      { kind: "ClientCode", clientId: "c2" },
    ]);
  });

  it("a: treats a code and a corporate number of different clients as a conflict", async () => {
    const result = await resolver.resolve(keys({ clientCodes: ["C0031"], corporateNumbers: [CORPORATE_NUMBER] }), null);
    expect(result.reviewReason).toBe("ConflictingKeys");
  });

  it("a: evaluates conflict before multiple arrival numbers", async () => {
    const result = await resolver.resolve(keys({ arrivalNumbers: [A1, A2] }), null);
    expect(result.reviewReason).toBe("ConflictingKeys");
  });

  it("b: sends two different arrival numbers to review even when only one is registered", async () => {
    const result = await resolver.resolve(keys({ arrivalNumbers: [A1, UNKNOWN] }), null);
    expect(result).toMatchObject({ clientId: null, reviewReason: "MultipleArrivalNumbers" });
  });

  it("c: resolves by arrival number to the client and case", async () => {
    const result = await resolver.resolve(keys({ arrivalNumbers: [A1], clientCodes: ["C0031"] }), null);
    expect(result).toEqual({
      clientId: "c1", caseId: "k1", method: "ArrivalNumber", reviewReason: null, unmatchedArrivalNumber: null,
      evidence: [
        { kind: "ArrivalNumber", clientId: "c1" },
        { kind: "ClientCode", clientId: "c1" },
      ],
    });
  });

  it("d: resolves by client code", async () => {
    const result = await resolver.resolve(keys({ clientCodes: ["C0142"], corporateNumbers: [CORPORATE_NUMBER] }), null);
    expect(result).toMatchObject({ clientId: "c2", caseId: null, method: "ClientCode", reviewReason: null });
  });

  it("e: resolves by a corporate number that matches exactly one client", async () => {
    const result = await resolver.resolve(keys({ corporateNumbers: [CORPORATE_NUMBER] }), null);
    expect(result).toMatchObject({ clientId: "c2", method: "CorporateNumber", reviewReason: null });
  });

  it("e: ignores a corporate number shared by two clients", async () => {
    repo.clientRows.push(client({ id: "c4", code: "C0300", corporateNumber: CORPORATE_NUMBER }));
    const result = await resolver.resolve(keys({ corporateNumbers: [CORPORATE_NUMBER] }), null);
    expect(result).toMatchObject({ clientId: null, reviewReason: "NoKey" });
    expect(result.evidence).toEqual([{ kind: "CorporateNumber", clientId: "c2" }, { kind: "CorporateNumber", clientId: "c4" }]);
  });

  it("stops when a shared corporate number excludes the client another clue decided", async () => {
    repo.clientRows.push(client({ id: "c4", code: "C0300", corporateNumber: CORPORATE_NUMBER }));
    const byCode = await resolver.resolve(keys({ clientCodes: ["C0031"], corporateNumbers: [CORPORATE_NUMBER] }), null);
    expect(byCode).toMatchObject({ clientId: null, reviewReason: "ConflictingKeys" });
    const byArrival = await resolver.resolve(keys({ arrivalNumbers: [A1], corporateNumbers: [CORPORATE_NUMBER] }), null);
    expect(byArrival).toMatchObject({ clientId: null, reviewReason: "ConflictingKeys" });
    const byHint = await resolver.resolve(keys({ corporateNumbers: [CORPORATE_NUMBER] }), "c1");
    expect(byHint).toMatchObject({ clientId: null, reviewReason: "HintMismatch" });
  });

  it("accepts a shared corporate number that includes the decided client", async () => {
    repo.clientRows.push(client({ id: "c4", code: "C0300", corporateNumber: CORPORATE_NUMBER }));
    expect(await resolver.resolve(keys({ clientCodes: ["C0142"], corporateNumbers: [CORPORATE_NUMBER] }), null)).toMatchObject({ clientId: "c2", method: "ClientCode" });
    expect(await resolver.resolve(keys({ corporateNumbers: [CORPORATE_NUMBER] }), "c4")).toMatchObject({ clientId: "c4", method: "StaffSelected" });
  });

  it("does not flag an unregistered arrival number when a client code decided", async () => {
    const result = await resolver.resolve(keys({ arrivalNumbers: [UNKNOWN], clientCodes: ["C0031"] }), null);
    expect(result).toMatchObject({ clientId: "c1", method: "ClientCode", caseId: null, unmatchedArrivalNumber: null });
  });

  it("post: stops for an archived client reached by arrival number or corporate number", async () => {
    repo.clientRows[0] = client({ id: "c1", code: "C0031", status: "Archived" });
    repo.clientRows[1] = client({ id: "c2", code: "C0142", corporateNumber: CORPORATE_NUMBER, status: "Closed" });
    expect(await resolver.resolve(keys({ arrivalNumbers: [A1] }), null)).toMatchObject({ clientId: null, reviewReason: "ClientNotActive" });
    expect(await resolver.resolve(keys({ corporateNumbers: [CORPORATE_NUMBER] }), null)).toMatchObject({ clientId: null, reviewReason: "ClientNotActive" });
  });

  it("f: resolves by the client chosen at intake", async () => {
    const result = await resolver.resolve(keys(), "c1");
    expect(result).toMatchObject({ clientId: "c1", caseId: null, method: "StaffSelected", reviewReason: null, unmatchedArrivalNumber: null });
  });

  it("f: keeps an unregistered arrival number so that a case can be registered", async () => {
    const result = await resolver.resolve(keys({ arrivalNumbers: [UNKNOWN] }), "c1");
    expect(result).toMatchObject({ clientId: "c1", caseId: null, method: "StaffSelected", unmatchedArrivalNumber: UNKNOWN });
  });

  it("g: sends a file without any key to review", async () => {
    expect(await resolver.resolve(keys(), null)).toMatchObject({ clientId: null, reviewReason: "NoKey" });
    expect(await resolver.resolve(keys({ arrivalNumbers: [UNKNOWN] }), null)).toMatchObject({ clientId: null, reviewReason: "NoKey" });
  });

  it("post: reports a mismatch between the keys and the chosen client", async () => {
    for (const partial of [{ arrivalNumbers: [A1] }, { clientCodes: ["C0031"] }]) {
      const result = await resolver.resolve(keys(partial), "c2");
      expect(result).toMatchObject({ clientId: null, caseId: null, method: null, reviewReason: "HintMismatch" });
      expect(result.evidence).toContainEqual({ kind: "StaffSelected", clientId: "c2" });
    }
    const byNumber = await resolver.resolve(keys({ corporateNumbers: [CORPORATE_NUMBER] }), "c1");
    expect(byNumber.reviewReason).toBe("HintMismatch");
  });

  it("post: accepts a chosen client that agrees with the keys", async () => {
    const result = await resolver.resolve(keys({ arrivalNumbers: [A1] }), "c1");
    expect(result).toMatchObject({ clientId: "c1", caseId: "k1", method: "ArrivalNumber", reviewReason: null });
  });

  it("post: sends files of a client that is not Active to review", async () => {
    expect(await resolver.resolve(keys({ clientCodes: ["C0207"] }), null)).toMatchObject({ clientId: null, reviewReason: "ClientNotActive" });
    expect(await resolver.resolve(keys(), "c3")).toMatchObject({ clientId: null, reviewReason: "ClientNotActive" });
  });

  it("post: sends files of a cancelled case to review", async () => {
    repo.caseRows[0] = caseRecord({ id: "k1", clientId: "c1", state: "Cancelled" });
    const result = await resolver.resolve(keys({ arrivalNumbers: [A1] }), null);
    expect(result).toMatchObject({ clientId: null, caseId: null, reviewReason: "CaseCancelled" });
  });

  it("rejects an unknown chosen client", async () => {
    await expect(resolver.resolve(keys(), "missing")).rejects.toThrow("not_found: client");
  });
});
