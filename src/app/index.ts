import { createApp } from "./api/app";
import type { AppEnv } from "./env";

export default {
  fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Response | Promise<Response> {
    return createApp().fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;
