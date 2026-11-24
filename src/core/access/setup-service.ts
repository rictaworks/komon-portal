import type { AuditRecorder } from "../audit/recorders";
import { invalidInput, invalidState } from "../model/errors";
import type { User } from "../model/types";
import type { Repository } from "../ports/repository";
import type { AccessPolicy } from "./access-policy";
import { ActorLoader } from "./actor-loader";
import { secretsEqual } from "./secret-compare";

const USER_TARGET = "user";
export const MIN_SETUP_TOKEN_LENGTH = 24;

export interface SetupServiceDeps {
  repository: Repository;
  policy: AccessPolicy;
  audit: AuditRecorder;
  /** Initial setup token from the environment. Undefined or too short means setup is closed. */
  setupToken: string | undefined;
}

/** First-time setup: the first signed-in user who presents the setup token becomes Owner. */
export class SetupService {
  private readonly actors: ActorLoader;

  constructor(private readonly deps: SetupServiceDeps) {
    this.actors = new ActorLoader(deps.repository);
  }

  /** Setup is open only while no Owner exists and a token is configured. */
  async isOpen(): Promise<boolean> {
    return this.tokenConfigured() && (await this.deps.repository.users.countActiveOwners()) === 0;
  }

  async claimOwner(user: User, presentedToken: string): Promise<User> {
    const actor = await this.actors.load(user);
    const matches = this.deps.setupToken !== undefined && (await secretsEqual(presentedToken, this.deps.setupToken));
    if (!(await this.isOpen()) || !matches) {
      await this.deps.audit.record(actor, "setup.claim_owner", USER_TARGET, user.id, "denied");
      throw invalidInput("setup_token");
    }
    if (!this.deps.policy.canJoin(actor, "Office")) {
      throw invalidState("not_eligible");
    }
    const owner: User = { ...user, officeRole: "Owner", officeStatus: "Active" };
    if (!(await this.deps.repository.users.transitionOffice(owner, user.officeStatus))) {
      throw invalidState("not_eligible");
    }
    await this.deps.audit.record(actor, "setup.claim_owner", USER_TARGET, user.id);
    return owner;
  }

  private tokenConfigured(): boolean {
    return this.deps.setupToken !== undefined && this.deps.setupToken.length >= MIN_SETUP_TOKEN_LENGTH;
  }
}
