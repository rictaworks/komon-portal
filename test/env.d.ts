import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env {
      ENVIRONMENT: string;
      DB: D1Database;
      FILES: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
