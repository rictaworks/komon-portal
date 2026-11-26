import { beforeEach, describe, expect, it } from "vitest";
import type { IntakeJev } from "../../../src/core/intake/classification-service";
import { ClassifierError, type ClassifierPort, type ClassifierRequest, type ClassifierResponse } from "../../../src/core/ports/classifier";
import { staffActor } from "../../support/builders";
import { intakeKit, type IntakeKit } from "../../support/intake-kit";
import { PDF, text } from "./fixtures";

const staff = staffActor();
const KEY = "tsk-user-secret-key";
const JEV: IntakeJev = { model: "jev-1.13.0", credential: KEY };
/** A name whose words are in the vocabulary (the label of d2) and that no keyword rule matches. */
const OPEN_NAME = "C0142_Employment insurance notice_Taro Yamada.pdf";

class ScriptedClassifier implements ClassifierPort {
  requests: ClassifierRequest[] = [];
  choiceId = "d2";
  confidence = 0.97;
  error: ClassifierError | null = null;

  async choose(request: ClassifierRequest): Promise<ClassifierResponse> {
    this.requests.push(request);
    if (this.error !== null) {
      throw this.error;
    }
    return { model: "jev-1.13.0", answers: request.items.map((item) => ({ itemId: item.id, choiceId: this.choiceId, confidence: this.confidence })) };
  }
}

function pdf(marker: string): Uint8Array {
  return new Uint8Array([...PDF, ...text(marker)]);
}

describe("IntakeService: Jev at acceptance (instructions.md 1.6.1 principle 5, 1.6.2 step 6)", () => {
  let kit: IntakeKit;
  let classifier: ScriptedClassifier;

  beforeEach(() => {
    classifier = new ScriptedClassifier();
    kit = intakeKit(classifier);
  });

  async function accept(fileName: string, jev: IntakeJev | null = JEV, bytes = pdf(fileName)) {
    const batch = await kit.intake.openBatch(staff, null);
    return kit.intake.accept(staff, batch.id, { fileName, bytes }, jev);
  }

  it("keeps the rule decision and never asks Jev when a rule decides the type", async () => {
    classifier.choiceId = "d1";
    const result = await accept("C0142_koyou_Employment insurance notice.pdf");
    expect(result.outcome === "stored" && result.file).toMatchObject({ docTypeId: "d2", typeSource: "Rule", jevModel: null, jevConfidence: null });
    expect(classifier.requests).toEqual([]);
  });

  it("lets Jev set the type when the rules miss and the browser holds a key, and records the source as Jev", async () => {
    const result = await accept(OPEN_NAME);
    expect(result.outcome).toBe("stored");
    if (result.outcome !== "stored") return;
    expect(result.file).toMatchObject({
      docTypeId: "d2", typeSource: "Jev", jevModel: "jev-1.13.0", jevConfidence: 0.97, jevCandidateDocTypeId: null, state: "Staged",
    });
    expect(result.file.displayName).toBe("C0142_KOYOU_20261124_01");
    expect(kit.repo.fileRows[0]).toMatchObject({ docTypeId: "d2", typeSource: "Jev" });
    expect(kit.repo.auditRows.map((row) => row.action)).toEqual(expect.arrayContaining(["file.accept", "file.classify"]));
    expect(kit.repo.metricRows.find((row) => row.name === "jev.classified")).toMatchObject({ clientId: "c2" });
  });

  it("sends only the title words and the key to Jev, one item for this file", async () => {
    await accept(OPEN_NAME);
    expect(classifier.requests).toHaveLength(1);
    expect(classifier.requests[0]).toMatchObject({ model: "jev-1.13.0", credential: KEY, items: [{ text: "employment insurance notice" }] });
  });

  it("makes the file visible to automatic publishing with its type already set", async () => {
    let typeSeenByPublisher: string | null | undefined;
    kit.autoPublisher.autoPublishIfEligible = async (fileId: string) => {
      typeSeenByPublisher = kit.repo.fileRows.find((row) => row.id === fileId)?.docTypeId;
      return false;
    };
    await accept(OPEN_NAME);
    expect(typeSeenByPublisher).toBe("d2");
  });

  it("sets no type below the office threshold and keeps the answer as a candidate", async () => {
    classifier.confidence = 0.5;
    const result = await accept(OPEN_NAME);
    expect(result.outcome === "stored" && result.file).toMatchObject({
      docTypeId: null, typeSource: null, jevModel: "jev-1.13.0", jevConfidence: 0.5, jevCandidateDocTypeId: "d2", state: "Staged",
    });
  });

  it("compares the confidence with the threshold of the office, accepting a value equal to it", async () => {
    kit.repo.setting.jevThreshold = 0.98;
    await accept(OPEN_NAME, JEV, pdf("below"));
    expect(kit.repo.fileRows[0]).toMatchObject({ docTypeId: null, typeSource: null, jevConfidence: 0.97 });

    kit.repo.setting.jevThreshold = 0.97;
    const equal = await accept("C0142_Employment insurance notice_Hanako Sato.pdf", JEV, pdf("equal"));
    expect(equal.outcome === "stored" && equal.file).toMatchObject({ docTypeId: "d2", typeSource: "Jev" });
  });

  it("stays untyped without a key and makes no call", async () => {
    const result = await accept(OPEN_NAME, null);
    expect(result.outcome === "stored" && result.file).toMatchObject({ docTypeId: null, typeSource: null, jevModel: null, jevConfidence: null });
    expect(classifier.requests).toEqual([]);
  });

  it("stays untyped without a call when the file name has no usable word", async () => {
    const result = await accept("C0142_20261124.pdf");
    expect(result.outcome === "stored" && result.file).toMatchObject({ docTypeId: null, typeSource: null });
    expect(classifier.requests).toEqual([]);
  });

  it("refuses an alias model before anything is stored", async () => {
    await expect(accept(OPEN_NAME, { model: "jev-latest", credential: KEY })).rejects.toThrow("invalid_input: model");
    await expect(accept(OPEN_NAME, { model: "jev-1.13.0", credential: "" })).rejects.toThrow("invalid_input: credential");
    expect(kit.repo.fileRows).toEqual([]);
    expect([...kit.store.objects.keys()]).toEqual([]);
    expect(classifier.requests).toEqual([]);
  });

  it("stores nothing when the provider fails, so the upload is refused as a whole", async () => {
    classifier.error = new ClassifierError("network_failure");
    await expect(accept(OPEN_NAME)).rejects.toThrow("classifier: network_failure");
    expect(kit.repo.fileRows).toEqual([]);
    expect([...kit.store.objects.keys()]).toEqual([]);
  });

  it("stores nothing when the provider names an unknown type", async () => {
    classifier.choiceId = "d3";
    await expect(accept(OPEN_NAME)).rejects.toThrow("classifier: invalid_response");
    expect(kit.repo.fileRows).toEqual([]);
  });

  it("never stores or logs the key, the original name or the personal words", async () => {
    await accept(OPEN_NAME);
    const persisted = JSON.stringify([kit.repo.fileRows, kit.repo.batchRows, kit.repo.auditRows, kit.repo.metricRows, [...kit.store.objects.keys()]]);
    expect(persisted).not.toContain(KEY);
    expect(persisted).not.toContain("Taro");
    expect(persisted).not.toContain("Yamada");
  });
});
