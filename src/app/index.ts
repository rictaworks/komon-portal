import { createApp } from "./api/app";
import type { AppEnv } from "./env";
import { runDailyMaintenance } from "./scheduled";

export default {
  fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Response | Promise<Response> {
    return createApp().fetch(request, env, ctx);
  },
  scheduled(_controller: ScheduledController, env: AppEnv, ctx: ExecutionContext): void {
    ctx.waitUntil(runDailyMaintenance(env));
  },
} satisfies ExportedHandler<AppEnv>;
