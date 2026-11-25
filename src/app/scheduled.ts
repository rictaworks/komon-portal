import type { PurgeReport } from "../core/intake/trash-service";
import { systemActor } from "../core/model/actor";
import { buildServices, type AdapterOverrides } from "./api/composition";
import type { AppEnv } from "./env";

export interface MaintenanceReport {
  purge: PurgeReport;
  expiredInvitations: number;
  removedSessions: number;
}

/**
 * Daily maintenance: erase files that spent 30 days in the trash, mark expired invitations and
 * remove ended sessions. Each step runs even if an earlier one failed; a failure is reported at the end.
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
  const report: MaintenanceReport = {
    purge: await step("purge", { purged: 0, skipped: 0, failed: 0 }, () => services.trash.purgeExpired(systemActor())),
    expiredInvitations: await step("invitations", 0, () => services.repository.invitations.expireBefore(services.clock.now())),
    removedSessions: await step("sessions", 0, () => services.sessions.removeExpired()),
  };
  console.info(JSON.stringify({ event: "maintenance_finished", ...report }));
  if (failures.length > 0 || report.purge.failed > 0) {
    throw new Error(`maintenance finished with failures: ${[...failures, ...(report.purge.failed > 0 ? ["purge_files"] : [])].join(", ")}`);
  }
  return report;
}
