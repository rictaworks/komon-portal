import { beforeEach, describe, expect, it } from "vitest";
import { ClassificationService, CLASSIFIER_BATCH_SIZE } from "../../../src/core/intake/classification-service";
import { classifierTitle, isFixedModelName } from "../../../src/core/intake/classifier-input";
import { ClassifierError, type ClassifierPort, type ClassifierRequest, type ClassifierResponse } from "../../../src/core/ports/classifier";
import { fileRecord, memberActor, staffActor } from "../../support/builders";
import { intakeKit, type IntakeKit } from "../../support/intake-kit";

const staff = staffActor();
const KEY = "tsk-user-secret-key";
const options = { arrivalNumberPattern: "[0-9]{17,18}", clientCodes: ["C0031", "C0142"] };

class StubClassifier implements ClassifierPort {
  requests: ClassifierRequest[] = [];
  confidence = 0.97;
  choiceId = "d1";
  model = "jev-1.13.0";
  error: ClassifierError | null = null;
  respond: ((request: ClassifierRequest) => ClassifierResponse) | null = null;

  async choose(request: ClassifierRequest): Promise<ClassifierResponse> {
    this.requests.push(request);
    if (this.error !== null) {
      throw this.error;
    }
    if (this.respond !== null) {
      return this.respond(request);
    }
    return { model: this.model, answers: request.items.map((item) => ({ itemId: item.id, choiceId: this.choiceId, confidence: this.confidence })) };
  }
}

describe("classifierTitle", () => {
  it("keeps the form name and removes arrival numbers, client codes and long digit runs", () => {
    expect(classifierTitle("C0031_202611240912345678_hyojun-hoshu_kettei(2026)_123456.pdf", options)).toBe("hyojun hoshu kettei 2026");
    expect(classifierTitle("folder/C0142 notice 20261124.PDF", options)).toBe("notice");
    expect(classifierTitle("12345_notice.pdf", options)).toBe("12345 notice");
  });

  it("returns an empty title when nothing but identifiers is left", () => {
    expect(classifierTitle("202611240912345678.zip", options)).toBe("");
    expect(classifierTitle("C0031_20261124.pdf", options)).toBe("");
  });

  it("limits the length", () => {
    expect(classifierTitle(`${"a".repeat(500)}.pdf`, options).length).toBe(120);
  });
});

describe("isFixedModelName", () => {
  it.each(["jev-1.13.0", "jev-1.14.0"])("accepts the fixed version %s", (model) => {
    expect(isFixedModelName(model)).toBe(true);
  });

  it.each(["jev-latest", "jev-preview", "", "JEV-1.13.0", "jev 1.13", "../jev", "x".repeat(65)])("rejects %s", (model) => {
    expect(isFixedModelName(model)).toBe(false);
  });
});

describe("ClassificationService", () => {
  let kit: IntakeKit;
  let classifier: StubClassifier;
  let service: ClassificationService;

  beforeEach(() => {
    kit = intakeKit();
    classifier = new StubClassifier();
    service = new ClassificationService({ repository: kit.repo, guard: kit.guard, audit: kit.audit, metrics: kit.metrics, writer: kit.writer, classifier });
    kit.repo.fileRows.push(
      fileRecord({ id: "f1", displayName: "C0031_UNCLASSIFIED_20261124_01" }),
      fileRecord({ id: "f2", sha256: "b".repeat(64), displayName: "C0031_UNCLASSIFIED_20261124_02" }),
    );
  });

  function request(items = [{ fileId: "f1", fileName: "C0031_hyojun kettei.pdf" }], model = "jev-1.13.0") {
    return { model, credential: KEY, items };
  }

  it("sets the type when confidence reaches the threshold and records model and confidence", async () => {
    const report = await service.classify(staff, request());
    expect(report).toEqual({ model: "jev-1.13.0", results: [{ fileId: "f1", outcome: "classified", docTypeId: "d1", confidence: 0.97 }] });
    expect(kit.repo.fileRows[0]).toMatchObject({
      docTypeId: "d1", typeSource: "Jev", jevModel: "jev-1.13.0", jevConfidence: 0.97, jevCandidateDocTypeId: null,
      displayName: "C0031_SHAHO_20261124_03", clientId: "c1", state: "Staged", version: 2,
    });
    expect(kit.repo.metricRows.at(-1)).toMatchObject({ name: "jev.classified", attributes: { fileId: "f1", model: "jev-1.13.0", confidence: 0.97, accepted: true } });
  });

  it.each([
    [0.9, "classified"],
    [0.8999, "below_threshold"],
  ] as const)("treats confidence %f at the default threshold as %s", async (confidence, outcome) => {
    classifier.confidence = confidence;
    expect((await service.classify(staff, request())).results[0]?.outcome).toBe(outcome);
  });

  it("leaves the file unclassified below the threshold and records the candidate", async () => {
    classifier.confidence = 0.6;
    const report = await service.classify(staff, request());
    expect(report.results).toEqual([{ fileId: "f1", outcome: "below_threshold", candidateDocTypeId: "d1", confidence: 0.6 }]);
    expect(kit.repo.fileRows[0]).toMatchObject({ docTypeId: null, typeSource: null, jevModel: "jev-1.13.0", jevConfidence: 0.6, jevCandidateDocTypeId: "d1", displayName: "C0031_UNCLASSIFIED_20261124_01" });
    expect(kit.repo.metricRows.at(-1)).toMatchObject({ attributes: { accepted: false } });
  });

  it("follows a raised threshold", async () => {
    kit.repo.setting = { ...kit.repo.setting, jevThreshold: 0.99 };
    expect((await service.classify(staff, request())).results[0]?.outcome).toBe("below_threshold");
  });

  it("sends only the sanitised title and the outbound type choices", async () => {
    await service.classify(staff, request([{ fileId: "f1", fileName: "C0031_202611240912345678_hyojun kettei_1234567.pdf" }]));
    expect(classifier.requests).toHaveLength(1);
    expect(classifier.requests[0]).toMatchObject({ model: "jev-1.13.0", credential: KEY, items: [{ id: "f1", text: "hyojun kettei" }] });
    expect(classifier.requests[0]?.choices.map((choice) => choice.id)).toEqual(["d1", "d2"]);
  });

  it("puts all files of one request into one call, 50 at most per call", async () => {
    kit.repo.fileRows = Array.from({ length: CLASSIFIER_BATCH_SIZE + 5 }, (_unused, index) =>
      fileRecord({ id: `g${index}`, sha256: String(index).padStart(64, "0"), displayName: `C0031_UNCLASSIFIED_20261124_${String(index + 10)}` }),
    );
    const items = kit.repo.fileRows.map((row) => ({ fileId: row.id, fileName: "notice.pdf" }));
    const report = await service.classify(staff, { model: "jev-1.13.0", credential: KEY, items });
    expect(classifier.requests.map((call) => call.items.length)).toEqual([50, 5]);
    expect(report.results).toHaveLength(55);
  });

  it("skips files that are missing, already typed, published or have no usable title, without calling the provider", async () => {
    kit.repo.fileRows.push(
      fileRecord({ id: "f3", docTypeId: "d2", typeSource: "Rule", sha256: "c".repeat(64), displayName: "x3" }),
      fileRecord({ id: "f4", state: "Published", publishedAt: new Date(), sha256: "d".repeat(64), displayName: "x4" }),
    );
    const report = await service.classify(staff, {
      model: "jev-1.13.0", credential: KEY,
      items: [
        { fileId: "missing", fileName: "a.pdf" },
        { fileId: "f3", fileName: "a.pdf" },
        { fileId: "f4", fileName: "a.pdf" },
        { fileId: "f2", fileName: "C0031_20261124.pdf" },
      ],
    });
    expect(report).toEqual({
      model: null,
      results: [
        { fileId: "missing", outcome: "skipped", reason: "not_found" },
        { fileId: "f3", outcome: "skipped", reason: "not_unclassified" },
        { fileId: "f4", outcome: "skipped", reason: "not_unclassified" },
        { fileId: "f2", outcome: "skipped", reason: "no_title" },
      ],
    });
    expect(classifier.requests).toEqual([]);
  });

  it.each(["authentication_failed", "unsupported_model", "limit_reached", "network_failure"] as const)(
    "stops on %s without a fallback and leaves the files and their routing untouched",
    async (code) => {
      classifier.error = new ClassifierError(code);
      await expect(service.classify(staff, request())).rejects.toThrow(`classifier: ${code}`);
      expect(classifier.requests).toHaveLength(1);
      expect(kit.repo.fileRows[0]).toMatchObject({ docTypeId: null, state: "Staged", clientId: "c1", version: 1 });
      expect((await kit.publish.publish(staff, [{ fileId: "f1", version: 1 }]))[0]?.outcome).toBe("published");
    },
  );

  it("rejects an answer that names an unknown type or an impossible confidence", async () => {
    classifier.choiceId = "d3";
    await expect(service.classify(staff, request())).rejects.toThrow("classifier: invalid_response");
    classifier.choiceId = "d1";
    classifier.confidence = 1.5;
    await expect(service.classify(staff, request())).rejects.toThrow("classifier: invalid_response");
    classifier.respond = () => ({ model: "jev-1.13.0", answers: [] });
    await expect(service.classify(staff, request())).rejects.toThrow("classifier: invalid_response");
    expect(kit.repo.fileRows[0]?.docTypeId).toBeNull();
  });

  it("rejects alias model names, a missing key and an empty request before any call", async () => {
    await expect(service.classify(staff, request(undefined, "jev-latest"))).rejects.toThrow("invalid_input: model");
    await expect(service.classify(staff, { model: "jev-1.13.0", credential: "", items: [{ fileId: "f1", fileName: "a.pdf" }] })).rejects.toThrow("invalid_input: credential");
    await expect(service.classify(staff, { model: "jev-1.13.0", credential: KEY, items: [] })).rejects.toThrow("invalid_input: items");
    await expect(service.classify(memberActor(), request())).rejects.toThrow("forbidden");
    expect(classifier.requests).toEqual([]);
  });

  it("never stores the key or the file name", async () => {
    await service.classify(staff, request([{ fileId: "f1", fileName: "C0031_hyojun Taro Yamada.pdf" }]));
    const persisted = JSON.stringify([kit.repo.fileRows, kit.repo.auditRows, kit.repo.metricRows]);
    expect(persisted).not.toContain(KEY);
    expect(persisted).not.toContain("Yamada");
  });

  it("never involves the classifier in deciding the client", async () => {
    await service.classify(staff, request());
    expect(JSON.stringify(classifier.requests)).not.toContain("c1");
    expect(JSON.stringify(classifier.requests)).not.toContain("C0031");
    expect(kit.repo.fileRows[0]).toMatchObject({ clientId: "c1", resolutionMethod: "StaffSelected" });
  });
});
