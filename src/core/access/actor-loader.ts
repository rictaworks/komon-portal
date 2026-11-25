import type { ActorMembership, UserActor } from "../model/actor";
import type { User } from "../model/types";
import type { Repository } from "../ports/repository";

type LoaderRepository = Pick<Repository, "memberships" | "clients">;

/** Builds the actor that AccessPolicy judges, from the stored user and memberships. */
export class ActorLoader {
  constructor(private readonly repository: LoaderRepository) {}

  async load(user: User): Promise<UserActor> {
    const memberships: ActorMembership[] = [];
    for (const membership of await this.repository.memberships.listByUser(user.id)) {
      const client = await this.repository.clients.findById(membership.clientId);
      if (client !== null) {
        memberships.push({ clientId: client.id, status: membership.status, clientStatus: client.status });
      }
    }
    return { kind: "user", userId: user.id, officeRole: user.officeRole, officeStatus: user.officeStatus, memberships };
  }
}
