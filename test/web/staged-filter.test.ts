import { describe, expect, it } from "vitest";
import { stagedFilesPath, UNCLASSIFIED } from "../../src/app/web/pages/office/staged-filter";

describe("staged documents request", () => {
  it("lists every staged outbound document when nothing is chosen", () => {
    expect(stagedFilesPath({ clientId: "", docType: "" })).toBe("/api/office/files?direction=Outbound&states=Staged&limit=200");
  });

  it("asks the server for one client and one document type", () => {
    expect(stagedFilesPath({ clientId: "client-1", docType: "type-1" })).toBe("/api/office/files?direction=Outbound&states=Staged&limit=200&clientId=client-1&docTypeId=type-1");
  });

  it("asks the server for the documents with no type, instead of picking them out of the listed page", () => {
    expect(stagedFilesPath({ clientId: "", docType: UNCLASSIFIED })).toBe("/api/office/files?direction=Outbound&states=Staged&limit=200&untyped=true");
    expect(stagedFilesPath({ clientId: "client-1", docType: UNCLASSIFIED })).toBe("/api/office/files?direction=Outbound&states=Staged&limit=200&clientId=client-1&untyped=true");
  });
});
