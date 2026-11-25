import type { PurgeReport } from "../core/intake/trash-service";
import { systemActor } from "../core/model/actor";
import { buildServices, type AdapterOverrides, type Services } from "./api/composition";
import type { AppEnv } from "./env";

export interface MaintenanceReport {
  purge: PurgeReport;
  expiredInvitations: number;
  removedSessions: number;
  /** Cases recorded in this run as having entered the retrieval warning period. */
  retrievalWarnings: number;
}

/** A case whose retrieval deadline came within the warning period (or passed) while nothing had arrived. */
export const RETRIEVAL_WARNED_EVENT = "case.retrieval_warned";
/** One per run of the daily job: what it did, as counts, and which steps failed. */
export const MAINTENANCE_FINISHED_EVENT = "maintenance.finished";

const CASE_PAGE_SIZE = 200;

/**
 * Records, once per submission of a case, that the submitted case reached the retrieval warning
 * period. The level is otherwise only computed when a screen is read, so without this event nothing
 * would show later how many cases were warned about and what became of them. A case submitted again
 * on another date has a new deadline and is recorded again when that one comes near.
 * `progress.recorded` is raised after each event written, so a failure part-way still leaves the true count.
 */
async function recordRetrievalWarnings(services: Services, progress: { recorded: number }): Promise<void> {
  const setting = await services.repository.settings.get();
  for (let offset = 0; ; offset += CASE_PAGE_SIZE) {
    const page = await services.repository.cases.list({ states: ["Submitted"] }, { limit: CASE_PAGE_SIZE, offset });
    for (const record of page) {
      const level = services.deadlines.retrievalLevel(record, setting).level;
      if (record.submittedOn === null || (level !== "warning" && level !== "expired")) {
        continue;
      }
      if (!(await services.repository.metrics.hasCaseEvent(RETRIEVAL_WARNED_EVENT, record.id, record.submittedOn))) {
        await services.metrics.record(systemActor(), RETRIEVAL_WARNED_EVENT, record.clientId, { caseId: record.id, submittedOn: record.submittedOn, level });
        progress.recorded += 1;
      }
    }
    if (page.length < CASE_PAGE_SIZE) {
      return;
    }
  }
}

/**
 * Daily maintenance: erase files that spent 30 days in the trash, mark expired invitations,
 * remove ended sessions and record the cases that reached the retrieval warning period. Each step
 * runs even if an earlier one failed; a failure is reported at the end. The outcome of the run is
 * stored as a measurement event, so the developer's summary can show when the job last ran.
 */
export async function runDailyMaintenance(env: AppEnv, overrides: AdapterOverrides = {}): Promise<MaintenanceReport> {
  const services = buildServices(env, overrides);
  const failures: string[] = [];
  const step = async <T>(name: string, initial: T, work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      failures.push(name);
      console.error(JSON.stringify({ event: "maintenance_step_failed", step: name, name: error instanceof Error ? error.name : "unknown" }));
      return initial;
    }
  };
  const warnings = { recorded: 0 };
  const purge =  await step("purge", { purged: 0, skipped: 0, failed: 0 }, () => services.trash.purgeExpired(systemActor()));
  const expiredInvitations = await step("invitations", 0, () => services.repository.invitations.expireBefore(services.clock.now()));
  const removedSessions = await step("sessions", 0, () => services.sessions.removeExpired());
  await step("retrieval_warnings", undefined, () => recordRetrievalWarnings(services, warnings));
  const report: MaintenanceReport = { purge, expiredInvitations, removedSessions, retrievalWarnings: warnings.recorded };
  if (report.purge.failed > 0) {
    failures.push("purge_files");
  }
  console.info(JSON.stringify({ event: "maintenance_finished", ...report }));
  const failedSteps = failures.join(",");
  await step("record", undefined, () =>
    services.metrics.record(systemActor(), MAINTENANCE_FINISHED_EVENT, null, {
      result: failures.length > 0 ? "failed" : "ok",
      failedSteps,
      purged: report.purge.purged,
      purgeSkipped: report.purge.skipped,
      purgeFailed: report.purge.failed,
      expiredInvitations: report.expiredInvitations,
      removedSessions: report.removedSessions,
      retrievalWarnings: report.retrievalWarnings,
    }),
  );
  if (failures.length > 0) {
    throw new Error(`maintenance finished with failures: ${failures.join(", ")}`);
  }
  return report;
}
