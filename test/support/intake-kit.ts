import { CaseService } from "../../src/core/cases/case-service";
import { FileWriter } from "../../src/core/intake/file-writer";
import { IntakeService, type AutoPublisher } from "../../src/core/intake/intake-service";
import { ReviewService } from "../../src/core/intake/review-service";
import { caseType, client, coreKit, docRule, docType, user, type CoreKit } from "./builders";
import { MemoryFileStore } from "./memory-file-store";
import { MemoryRepository } from "./memory-repository";

export class RecordingAutoPublisher implements AutoPublisher {
  asked: string[] = [];
  answer = false;

  async autoPublishIfEligible(fileId: string): Promise<boolean> {
    this.asked.push(fileId);
    return this.answer;
  }
}

export interface IntakeKit extends CoreKit {
  repo: MemoryRepository;
  store: MemoryFileStore;
  writer: FileWriter;
  cases: CaseService;
  autoPublisher: RecordingAutoPublisher;
  intake: IntakeService;
  review: ReviewService;
}

/** Core services over in-memory ports, with two active clients, one archived client and basic master data. */
export function intakeKit(): IntakeKit {
  const repo = new MemoryRepository();
  repo.clientRows.push(
    client({ id: "c1", code: "C0031" }),
    client({ id: "c2", code: "C0142" }),
    client({ id: "c3", code: "C0207", status: "Archived" }),
  );
  repo.userRows.push(user({ id: "u-staff", officeRole: "Staff", officeStatus: "Active" }));
  repo.caseTypeRows.push(caseType({ id: "t1", kind: "Procedure" }), caseType({ id: "t2", kind: "Payroll", label: "Payroll" }));
  repo.docTypeRows.push(
    docType({ id: "d1", shortCode: "SHAHO" }),
    docType({ id: "d2", shortCode: "KOYOU", label: "Employment insurance notice" }),
    docType({ id: "d3", shortCode: "KYUYO", label: "Payroll material", direction: "Inbound" }),
  );
  repo.ruleRows.push(docRule({ id: "r1", docTypeId: "d1", keyword: "shaho" }), docRule({ id: "r2", docTypeId: "d2", keyword: "koyou" }));
  const kit = coreKit(repo);
  const store = new MemoryFileStore();
  const writer = new FileWriter(repo, kit.clock);
  const cases = new CaseService({ repository: repo, ...kit });
  const autoPublisher = new RecordingAutoPublisher();
  const intake = new IntakeService({ repository: repo, store, writer, cases, autoPublisher, ...kit });
  const review = new ReviewService({ repository: repo, writer, cases, ...kit });
  return { ...kit, repo, store, writer, cases, autoPublisher, intake, review };
}
