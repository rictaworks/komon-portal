import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { D1Repository } from "../../src/app/adapters/d1/d1-repository";
import { R2FileStore } from "../../src/app/adapters/r2-file-store";
import { CryptoIdGenerator } from "../../src/app/adapters/system-clock";
import { AccessPolicy } from "../../src/core/access/access-policy";
import { Guard } from "../../src/core/access/guard";
import { AuditRecorder, MetricRecorder } from "../../src/core/audit/recorders";
import { CaseService } from "../../src/core/cases/case-service";
import { FileWriter } from "../../src/core/intake/file-writer";
import { IntakeService } from "../../src/core/intake/intake-service";
import { ReviewService } from "../../src/core/intake/review-service";
import { SubmissionService } from "../../src/core/intake/submission-service";
import { TrashService } from "../../src/core/intake/trash-service";
import { systemActor } from "../../src/core/model/actor";
import { PublishService } from "../../src/core/publish/publish-service";
import { ViewService } from "../../src/core/publish/view-service";
import { caseType, client, docRule, docType, FixedClock, memberActor, staffActor, user } from "../support/builders";
import { migrate } from "../support/d1";
import { RecordingNotifier } from "../support/intake-kit";

const ARRIVAL = "202611240912345678";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7 flow");

describe("core services on D1 and R2", () => {
  const clock = new FixedClock();
  const ids = new CryptoIdGenerator();
  const notifier = new RecordingNotifier();
  let repository: D1Repository;
  let store: R2FileStore;
  let intake: IntakeService;
  let review: ReviewService;
  let publish: PublishService;
  let view: ViewService;
  let submissions: SubmissionService;
  let trash: TrashService;
  let cases: CaseService;
  const staff = staffActor("Staff", "flow-staff");
  const member = memberActor(["flow-c1"], "flow-member");

  beforeAll(async () => {
    repository = new D1Repository(await migrate());
    store = new R2FileStore(env.FILES);
    const audit = new AuditRecorder(repository.audit, clock, ids);
    const metrics = new MetricRecorder(repository.metrics, clock, ids);
    const guard = new Guard(new AccessPolicy(), audit);
    const writer = new FileWriter(repository, clock);
    const shared = { repository, store, guard, audit, metrics, ids, clock, writer };
    cases = new CaseService(shared);
    publish = new PublishService({ ...shared, cases, notifier });
    intake = new IntakeService({ ...shared, cases, autoPublisher: publish });
    review = new ReviewService({ ...shared, cases });
    view = new ViewService({ ...shared, cases });
    submissions = new SubmissionService({ ...shared, cases });
    trash = new TrashService({ ...shared, cases });

    await repository.users.insert(user({ id: "flow-staff", googleSub: "flow-s", officeRole: "Staff", officeStatus: "Active" }));
    await repository.users.insert(user({ id: "flow-member", googleSub: "flow-m" }));
    await repository.users.insert(user({ id: "flow-outsider", googleSub: "flow-o" }));
    await repository.clients.insert(client({ id: "flow-c1", code: "F0031" }));
    await repository.clients.insert(client({ id: "flow-c2", code: "F0142" }));
    await repository.caseTypes.insert(caseType({ id: "flow-t1", kind: "Procedure" }));
    await repository.caseTypes.insert(caseType({ id: "flow-t2", kind: "Payroll", label: "Payroll" }));
    await repository.docTypes.insert(docType({ id: "flow-d1", shortCode: "FSHAHO" }));
    await repository.docTypes.insert(docType({ id: "flow-d3", shortCode: "FKYUYO", direction: "Inbound", caseTypeId: "flow-t2" }));
    await repository.docTypes.insertRule(docRule({ id: "flow-r1", docTypeId: "flow-d1", keyword: "shaho" }));
  });

  it("carries a document from intake to receipt, withdrawal and erasure", async () => {
    const registered = await cases.register(staff, {
      clientId: "flow-c1", caseTypeId: "flow-t1", targetMonth: "2026-11", referenceCode: "SHAHO-2611-01", assigneeId: "flow-staff", dueOn: "2026-11-30",
    });
    await cases.markSubmitted(staff, registered.id, { submittedOn: "2026-11-20", arrivalNumbers: [ARRIVAL] }, 1);

    const batch = await intake.openBatch(staff, null);
    const accepted = await intake.accept(staff, batch.id, { fileName: `${ARRIVAL}_shaho.pdf`, bytes: PDF_BYTES });
    expect(accepted.outcome).toBe("stored");
    if (accepted.outcome !== "stored") return;
    expect(accepted.file).toMatchObject({
      state: "Staged", clientId: "flow-c1", caseId: registered.id, resolutionMethod: "ArrivalNumber", docTypeId: "flow-d1",
      displayName: "F0031_FSHAHO_20261124_01",
    });
    expect((await repository.cases.findById(registered.id))?.state).toBe("DocumentReceived");

    const again = await intake.accept(staff, batch.id, { fileName: "F0031_copy.pdf", bytes: PDF_BYTES });
    expect(again).toMatchObject({ outcome: "duplicate", existingFileId: accepted.file.id });

    const elsewhere = await intake.accept(staff, batch.id, { fileName: "F0142_copy.pdf", bytes: PDF_BYTES });
    expect(elsewhere.outcome === "stored" && elsewhere.file).toMatchObject({ state: "NeedsReview", reviewReason: "DuplicateAcrossClients", clientId: null });
    if (elsewhere.outcome !== "stored") return;
    expect(elsewhere.file.reviewDetail).toEqual([{ kind: "ClientCode", clientId: "flow-c2" }, { kind: "ExistingCopy", clientId: "flow-c1" }]);
    await expect(review.assign(staff, elsewhere.file.id, { clientId: "flow-c1", caseId: null, confirmed: true }, 1)).rejects.toThrow("conflict: duplicate_content");

    await expect(view.open(member, accepted.file.id, "view")).rejects.toThrow("not_found: file");
    expect(await publish.publish(staff, [{ fileId: accepted.file.id, version: 1 }])).toEqual([{ fileId: accepted.file.id, outcome: "published", clientId: "flow-c1" }]);
    expect(notifier.notified).toEqual(["flow-c1"]);

    const opened = await view.open(member, accepted.file.id, "download");
    expect(opened.downloadName).toBe("F0031_FSHAHO_20261124_01.pdf");
    expect(new Uint8Array(await new Response(opened.body.body).arrayBuffer())).toEqual(PDF_BYTES);
    await view.open(member, accepted.file.id, "view");
    expect(await repository.receipts.listByFile(accepted.file.id)).toHaveLength(1);
    expect((await repository.cases.findById(registered.id))?.state).toBe("Confirmed");
    await expect(view.open(memberActor(["flow-c2"], "flow-outsider"), accepted.file.id, "view")).rejects.toThrow("not_found: file");

    const withdrawn = await publish.withdraw(staff, accepted.file.id, { reason: "WrongFile", next: "Trashed" }, 2);
    expect(withdrawn).toMatchObject({ state: "Trashed", incidentFlag: true });
    await expect(view.open(member, accepted.file.id, "download")).rejects.toThrow("not_found: file");
    expect((await repository.cases.findById(registered.id))?.state).toBe("Submitted");

    expect(await trash.purgeExpired(systemActor())).toEqual({ purged: 0, skipped: 0, failed: 0 });
    clock.advanceDays(31);
    expect(await trash.purgeExpired(systemActor())).toEqual({ purged: 1, skipped: 0, failed: 0 });
    expect(await repository.files.findById(accepted.file.id)).toBeNull();
    expect(await store.get(accepted.file.r2Key)).toBeNull();
    const purges = (await repository.audit.list({ limit: 100, offset: 0 })).filter((entry) => entry.action === "file.purge");
    expect(purges).toEqual([expect.objectContaining({ targetId: accepted.file.id, actorUserId: null, result: "ok" })]);
  });

  it("stores a client submission and links the open payroll case", async () => {
    const payroll = await cases.register(staff, {
      clientId: "flow-c1", caseTypeId: "flow-t2", targetMonth: "2026-12", referenceCode: "KYUYO-2612-01", assigneeId: null, dueOn: null,
    });
    const result = await submissions.submit(member, { clientId: "flow-c1", docTypeId: "flow-d3", targetMonth: "2026-12" }, { fileName: "payroll.csv", bytes: new TextEncoder().encode("a,b\n1,2\n") });
    expect(result.outcome === "stored" && result.file).toMatchObject({ state: "Submitted", caseId: payroll.id, format: "csv" });
    expect((await repository.cases.findById(payroll.id))?.state).toBe("MaterialsReceived");
    if (result.outcome !== "stored") return;
    expect((await view.open(staff, result.file.id, "view")).file.state).toBe("Acknowledged");
  });
});

describe("R2FileStore", () => {
  it("stores, reads and deletes a body and reports a missing key as null", async () => {
    const store = new R2FileStore(env.FILES);
    await store.put("files/r2-test", new Uint8Array([1, 2, 3]));
    const stored = await store.get("files/r2-test");
    expect(stored?.sizeBytes).toBe(3);
    expect(stored === null ? [] : [...new Uint8Array(await new Response(stored.body).arrayBuffer())]).toEqual([1, 2, 3]);
    await store.delete("files/r2-test");
    expect(await store.get("files/r2-test")).toBeNull();
    await expect(store.delete("files/r2-test")).resolves.toBeUndefined();
  });
});
