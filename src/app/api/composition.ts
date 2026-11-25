import { AccessPolicy } from "../../core/access/access-policy";
import { ActorLoader } from "../../core/access/actor-loader";
import { Guard } from "../../core/access/guard";
import { InvitationService } from "../../core/access/invitation-service";
import { SetupService } from "../../core/access/setup-service";
import { AuditRecorder, MetricRecorder } from "../../core/audit/recorders";
import { CaseService } from "../../core/cases/case-service";
import { DeadlineCalculator } from "../../core/cases/deadline-calculator";
import { ClassificationService } from "../../core/intake/classification-service";
import { FileWriter } from "../../core/intake/file-writer";
import { IntakeService } from "../../core/intake/intake-service";
import { ReviewService } from "../../core/intake/review-service";
import { SubmissionService } from "../../core/intake/submission-service";
import { TrashService } from "../../core/intake/trash-service";
import { ClientService } from "../../core/office/client-service";
import { SettingsService } from "../../core/office/settings-service";
import type { ClassifierPort } from "../../core/ports/classifier";
import type { Clock } from "../../core/ports/clock";
import type { FileStore } from "../../core/ports/file-store";
import type { IdGenerator } from "../../core/ports/id-generator";
import type { Notifier } from "../../core/ports/notifier";
import { PublishService } from "../../core/publish/publish-service";
import { ViewService } from "../../core/publish/view-service";
import { DashboardQueries } from "../adapters/d1/dashboard-queries";
import { D1Repository } from "../adapters/d1/d1-repository";
import { GoogleOidc } from "../adapters/google-oidc";
import { JevClassifier } from "../adapters/jev-classifier";
import type { HumanVerifier, IdentityProvider } from "../adapters/identity-provider";
import { PushSubscriptionStore } from "../adapters/push-subscription-store";
import { R2FileStore } from "../adapters/r2-file-store";
import { SessionStore } from "../adapters/session-store";
import { CryptoIdGenerator, SystemClock } from "../adapters/system-clock";
import { TurnstileVerifier } from "../adapters/turnstile";
import { WebPushNotifier } from "../adapters/web-push-notifier";
import { loadConfig, type AppConfig } from "../config/app-config";
import type { AppEnv } from "../env";

/** Adapters that tests and later issues can replace. */
export interface AdapterOverrides {
  clock?: Clock | undefined;
  ids?: IdGenerator | undefined;
  identity?: IdentityProvider | undefined;
  humans?: HumanVerifier | undefined;
  notifier?: Notifier | undefined;
  store?: FileStore | undefined;
  fetcher?: typeof fetch | undefined;
  classifier?: ClassifierPort | undefined;
}

export interface Services {
  config: AppConfig;
  repository: D1Repository;
  store: FileStore;
  clock: Clock;
  ids: IdGenerator;
  policy: AccessPolicy;
  guard: Guard;
  audit: AuditRecorder;
  metrics: MetricRecorder;
  actors: ActorLoader;
  sessions: SessionStore;
  /** Null when Google sign-in is not configured. */
  identity: IdentityProvider | null;
  /** Null when Turnstile is not configured. */
  humans: HumanVerifier | null;
  deadlines: DeadlineCalculator;
  cases: CaseService;
  intake: IntakeService;
  review: ReviewService;
  publish: PublishService;
  view: ViewService;
  submissions: SubmissionService;
  trash: TrashService;
  invitations: InvitationService;
  setup: SetupService;
  clients: ClientService;
  settings: SettingsService;
  dashboard: DashboardQueries;
  classification: ClassificationService;
  pushSubscriptions: PushSubscriptionStore;
  /** Whether browser notifications can be sent (VAPID keys and subject are configured). */
  pushConfigured: boolean;
}

/** Used when Web Push is not configured: publishing works without any notification channel. */
class SilentNotifier implements Notifier {
  async notifyNewDocument(): Promise<void> {
    return undefined;
  }
}

function identityProvider(config: AppConfig, fetcher: typeof fetch): IdentityProvider | null {
  if (config.googleClientId === undefined || config.googleClientSecret === undefined) {
    return null;
  }
  return new GoogleOidc({ clientId: config.googleClientId, clientSecret: config.googleClientSecret, fetcher });
}

function humanVerifier(config: AppConfig, fetcher: typeof fetch): HumanVerifier | null {
  return config.turnstileSecretKey === undefined ? null : new TurnstileVerifier({ secretKey: config.turnstileSecretKey, fetcher });
}

/** Wires adapters to the Domain Core for one request. */
export function buildServices(env: AppEnv, overrides: AdapterOverrides = {}): Services {
  const config = loadConfig(env);
  const fetcher = overrides.fetcher ?? ((input, init) => fetch(input, init));
  const clock = overrides.clock ?? new SystemClock();
  const ids = overrides.ids ?? new CryptoIdGenerator();
  const repository = new D1Repository(env.DB);
  const store = overrides.store ?? new R2FileStore(env.FILES);
  const policy = new AccessPolicy();
  const audit = new AuditRecorder(repository.audit, clock, ids);
  const metrics = new MetricRecorder(repository.metrics, clock, ids);
  const guard = new Guard(policy, audit);
  const writer = new FileWriter(repository, clock);
  const shared = { repository, store, guard, audit, metrics, ids, clock, writer, policy };
  const cases = new CaseService(shared);
  const pushSubscriptions = new PushSubscriptionStore(env.DB);
  const vapid =
    config.vapidPublicKey !== undefined && config.vapidPrivateKey !== undefined && config.vapidSubject !== undefined
      ? { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey, subject: config.vapidSubject }
      : null;
  const notifier = overrides.notifier ?? (vapid === null ? new SilentNotifier() : new WebPushNotifier(pushSubscriptions, vapid, fetcher, clock));
  const publish = new PublishService({ ...shared, cases, notifier });
  return {
    config, repository, store, clock, ids, policy, guard, audit, metrics,
    actors: new ActorLoader(repository),
    sessions: new SessionStore(env.DB, clock, ids),
    identity: overrides.identity ?? identityProvider(config, fetcher),
    humans: overrides.humans ?? humanVerifier(config, fetcher),
    deadlines: new DeadlineCalculator(clock),
    cases,
    publish,
    intake: new IntakeService({ ...shared, cases, autoPublisher: publish }),
    review: new ReviewService({ ...shared, cases }),
    view: new ViewService({ ...shared, cases }),
    submissions: new SubmissionService({ ...shared, cases }),
    trash: new TrashService({ ...shared, cases }),
    invitations: new InvitationService(shared),
    clients: new ClientService(shared),
    settings: new SettingsService(shared),
    dashboard: new DashboardQueries(env.DB),
    pushSubscriptions,
    pushConfigured: vapid !== null,
    classification: new ClassificationService({ ...shared, classifier: overrides.classifier ?? new JevClassifier(fetcher) }),
    setup: new SetupService({ repository, policy, audit, setupToken: config.setupToken }),
  };
}
