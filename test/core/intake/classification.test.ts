import { beforeEach, describe, expect, it } from "vitest";
import { ClassificationService, CLASSIFIER_BATCH_SIZE } from "../../../src/core/intake/classification-service";
import { classifierTitle, isFixedModelName } from "../../../src/core/intake/classifier-input";
import { ClassifierError, type ClassifierPort, type ClassifierRequest, type ClassifierResponse } from "../../../src/core/ports/classifier";
import { docRule, fileRecord, memberActor, staffActor } from "../../support/builders";
import { intakeKit, type IntakeKit } from "../../support/intake-kit";

const staff = staffActor();
const KEY = "tsk-user-secret-key";
const options = {
  arrivalNumberPattern: "[0-9]{17,18}",
  clientCodes: ["C0031", "C0142"],
  vocabulary: ["Standard remuneration decision notice", "HYOJUN", "kettei", "hyojun-hoshu", "資格取得確認通知書", "2026 summary"],
};

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
  it("keeps only words of the office's document types and rules, without identifiers", () => {
    expect(classifierTitle("C0031_202611240912345678_hyojun-hoshu_kettei(2026)_123456.pdf", options)).toBe("hyojun hoshu kettei 2026");
    expect(classifierTitle("folder/C0142 Decision NOTICE 20261124.PDF", options)).toBe("decision notice");
    expect(classifierTitle("12345_notice.pdf", options)).toBe("notice");
  });

  it("drops every word that is not in the vocabulary, such as a personal name", () => {
    expect(classifierTitle("Taro Yamada_kettei_notice.pdf", options)).toBe("kettei notice");
    expect(classifierTitle("山田太郎_資格取得確認通知書.pdf", options)).toBe("資格取得確認通知書");
    expect(classifierTitle("山田太郎資格取得確認通知書(控).pdf", options)).toBe("資格取得確認通知書");
    expect(classifierTitle("ｋｅｔｔｅｉ＿山田.pdf", options)).toBe("kettei");
  });

  it("matches alphanumeric words as whole words only", () => {
    expect(classifierTitle("ketteiko_noticeboard.pdf", options)).toBe("");
    expect(classifierTitle("xC0142yz_kettei.pdf", options)).toBe("kettei");
  });

  it("returns an empty title when no vocabulary word is left", () => {
    expect(classifierTitle("202611240912345678.zip", options)).toBe("");
    expect(classifierTitle("C0031_20261124.pdf", options)).toBe("");
    expect(classifierTitle("Taro Yamada.pdf", options)).toBe("");
    expect(classifierTitle("notice.pdf", { ...options, vocabulary: [] })).toBe("");
  });

  it("never keeps an identifier, even when the vocabulary names it", () => {
    const withIdentifiers = { ...options, vocabulary: ["C0031", "20261124", "notice"] };
    expect(classifierTitle("C0031_20261124_notice.pdf", withIdentifiers)).toBe("notice");
  });

  it("limits the length to whole words and keeps as many as fit", () => {
    const title = classifierTitle(`${"notice ".repeat(100)}.pdf`, options);
    expect(title).toBe(Array.from({ length: 17 }, () => "notice").join(" "));
    expect(title).toHaveLength(118);
  });

  it("drops a word that would pass the length limit instead of cutting it", () => {
    const longWord = "a".repeat(100);
    const withLongWord = { ...options, vocabulary: [longWord, "notice", "kettei"] };
    const title = classifierTitle(`${longWord}_notice_notice_kettei.pdf`, withLongWord);
    expect(title).toBe(`${longWord} notice notice`);
    expect(title).toHaveLength(114);
  });

  it("splits vocabulary phrases at any punctuation, so each word of a label can match", () => {
    const japanese = { ...options, vocabulary: ["算定基礎届・月額変更届", "賞与支払届、資格喪失届", "「離職票」/【労働保険】"] };
    expect(classifierTitle("算定基礎届.pdf", japanese)).toBe("算定基礎届");
    expect(classifierTitle("月額変更届_山田.pdf", japanese)).toBe("月額変更届");
    expect(classifierTitle("資格喪失届・賞与支払届.pdf", japanese)).toBe("資格喪失届 賞与支払届");
    expect(classifierTitle("離職票_労働保険.pdf", japanese)).toBe("離職票 労働保険");
    const latin = { ...options, vocabulary: ["Notice, decision", "Payroll/Bonus", "Tax & pension: summary"] };
    expect(classifierTitle("notice.pdf", latin)).toBe("notice");
    expect(classifierTitle("decision_bonus.pdf", latin)).toBe("decision bonus");
    expect(classifierTitle("Taro Yamada payroll tax pension summary.pdf", latin)).toBe("payroll tax pension summary");
  });

  it("keeps a long vowel mark inside a vocabulary word", () => {
    expect(classifierTitle("山田_タイムカード.pdf", { ...options, vocabulary: ["タイムカード"] })).toBe("タイムカード");
  });

  it("removes client codes in any letter case and inside a longer word", () => {
    expect(classifierTitle("c0031_notice.pdf", options)).toBe("notice");
    expect(classifierTitle("C0031notice.pdf", options)).toBe("notice");
  });
});

describe("isFixedModelName", () => {
  it.each(["jev-1.13.0", "jev-1.14.0"])("accepts the fixed version %s", (model) => {
    expect(isFixedModelName(model)).toBe(true);
  });

  it.each(["jev-latest", "jev-preview", "jev-1.13-latest", "jev", "", "JEV-1.13.0", "jev 1.13", "../jev", "x".repeat(65)])("rejects %s", (model) => {
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

  function request(items = [{ fileId: "f1", fileName: "C0031_social insurance notice.pdf" }], model = "jev-1.13.0") {
    return { model, credential: KEY, items };
  }

  it("writes nothing when a later batch fails, so every file stays as it was", async () => {
    kit.repo.fileRows = Array.from({ length: CLASSIFIER_BATCH_SIZE + 5 }, (_unused, index) =>
      fileRecord({ id: `h${index}`, sha256: String(index + 500).padStart(64, "0"), displayName: `C0031_UNCLASSIFIED_20261124_${String(index + 10)}` }),
    );
    const items = kit.repo.fileRows.map((row) => ({ fileId: row.id, fileName: "notice.pdf" }));
    let calls = 0;
    classifier.respond = (request) => {
      calls += 1;
      if (calls === 2) {
        throw new ClassifierError("limit_reached");
      }
      return { model: "jev-1.13.0", answers: request.items.map((item) => ({ itemId: item.id, choiceId: "d1", confidence: 0.97 })) };
    };
    await expect(service.classify(staff, { model: "jev-1.13.0", credential: KEY, items })).rejects.toThrow("classifier: limit_reached");
    expect(kit.repo.fileRows.every((row) => row.docTypeId === null)).toBe(true);
  });

  it("writes nothing when one answer in a late batch is invalid", async () => {
    kit.repo.fileRows = Array.from({ length: CLASSIFIER_BATCH_SIZE + 2 }, (_unused, index) =>
      fileRecord({ id: `k${index}`, sha256: String(index + 900).padStart(64, "0"), displayName: `C0031_UNCLASSIFIED_20261124_${String(index + 10)}` }),
    );
    const items = kit.repo.fileRows.map((row) => ({ fileId: row.id, fileName: "notice.pdf" }));
    classifier.respond = (request) => ({
      model: "jev-1.13.0",
      answers: request.items.map((item, index) => ({ itemId: item.id, choiceId: "d1", confidence: index === request.items.length - 1 ? 1.5 : 0.97 })),
    });
    await expect(service.classify(staff, { model: "jev-1.13.0", credential: KEY, items })).rejects.toThrow("classifier: invalid_response");
    expect(kit.repo.fileRows.every((row) => row.docTypeId === null)).toBe(true);
  });

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
    await service.classify(staff, request([{ fileId: "f1", fileName: "C0031_202611240912345678_shaho notice hyojun_1234567.pdf" }]));
    expect(classifier.requests).toHaveLength(1);
    expect(classifier.requests[0]).toMatchObject({ model: "jev-1.13.0", credential: KEY, items: [{ id: "f1", text: "shaho notice" }] });
    expect(classifier.requests[0]?.choices.map((choice) => choice.id)).toEqual(["d1", "d2"]);
  });

  it("does not let a personal name in a file name reach the classifier request", async () => {
    await service.classify(staff, request([
      { fileId: "f1", fileName: "Taro Yamada_SHAHO_social insurance notice.pdf" },
      { fileId: "f2", fileName: "山田太郎_koyou_資格取得確認通知書.pdf" },
    ]));
    expect(classifier.requests).toHaveLength(1);
    expect(classifier.requests[0]?.items).toEqual([
      { id: "f1", text: "shaho social insurance notice" },
      { id: "f2", text: "koyou" },
    ]);
    const sent = JSON.stringify(classifier.requests);
    for (const word of ["Taro", "taro", "Yamada", "yamada", "山田", "太郎", "資格取得"]) {
      expect(sent).not.toContain(word);
    }
  });

  it("takes the vocabulary from labels, short codes and keyword rules of every document type", async () => {
    kit.repo.ruleRows.push(docRule({ id: "r3", docTypeId: "d1", keyword: "資格取得" }));
    await service.classify(staff, request([{ fileId: "f1", fileName: "山田太郎_資格取得確認通知書_KYUYO_payroll.pdf" }]));
    expect(classifier.requests[0]?.items).toEqual([{ id: "f1", text: "資格取得 kyuyo payroll" }]);
  });

  it("skips a file whose name holds no word of the office's types and rules, and sends nothing", async () => {
    const report = await service.classify(staff, request([{ fileId: "f1", fileName: "Taro Yamada_hyojun kettei.pdf" }]));
    expect(report).toEqual({ model: null, results: [{ fileId: "f1", outcome: "skipped", reason: "no_title" }] });
    expect(classifier.requests).toEqual([]);
    expect(kit.repo.fileRows[0]).toMatchObject({ docTypeId: null, version: 1 });
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
    await service.classify(staff, request([{ fileId: "f1", fileName: "C0031_shaho Taro Yamada.pdf" }]));
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
