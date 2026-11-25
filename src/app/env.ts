/** Bindings, variables and secrets available to the user-facing Worker. */
export interface AppEnv {
  /** "development" or "production". */
  ENVIRONMENT: string;
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Initial setup token. Invalid once an Owner exists. */
  SETUP_TOKEN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** Operator contact for push services, for example mailto:info@example.com. */
  VAPID_SUBJECT?: string;
}
