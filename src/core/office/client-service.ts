import type { Guard } from "../access/guard";
import type { AuditRecorder } from "../audit/recorders";
import { isValidCorporateNumber } from "../intake/corporate-number";
import type { Actor } from "../model/actor";
import { conflict, invalidInput, invalidState, notFound } from "../model/errors";
import { CLIENT_STATUSES, type Client, type ClientStatus, type Id } from "../model/types";
import type { IdGenerator } from "../ports/id-generator";
import type { Repository } from "../ports/repository";

export interface ClientInput {
  code: string;
  corporateName: string;
  corporateNumber: string | null;
}

export interface ClientUpdate {
  corporateName: string;
  corporateNumber: string | null;
  status: ClientStatus;
}

const CODE = /^[A-Za-z0-9]{1,32}$/;
export const MAX_CORPORATE_NAME_LENGTH = 100;
const CLIENT_TARGET = "client";

/** Allowed status changes (instructions.md 6.5). Closed is final. */
const TRANSITIONS: Readonly<Record<ClientStatus, readonly ClientStatus[]>> = {
  Active: ["Active", "Archived"],
  Archived: ["Archived", "Active", "Closed"],
  Closed: ["Closed"],
};

export interface ClientServiceDeps {
  repository: Pick<Repository, "clients">;
  guard: Guard;
  audit: AuditRecorder;
  ids: IdGenerator;
}

/**
 * Client master data: code, corporate name, corporate number and status. There is deliberately
 * no field for a representative's name, an address or a phone number (instructions.md 1.4).
 */
export class ClientService {
  constructor(private readonly deps: ClientServiceDeps) {}

  async register(actor: Actor, input: ClientInput): Promise<Client> {
    await this.deps.guard.require(actor, "staff.operate", { type: CLIENT_TARGET, id: "new" });
    this.validate(input.corporateName, input.corporateNumber);
    if (!CODE.test(input.code)) {
      throw invalidInput("code");
    }
    const client: Client = { id: this.deps.ids.newId(), ...input, status: "Active", version: 1 };
    if (!(await this.deps.repository.clients.insert(client))) {
      throw conflict("client_code_taken");
    }
    await this.deps.audit.record(actor, "client.register", CLIENT_TARGET, client.id);
    return client;
  }

  /** Edits a client. The code never changes because display names and file routing depend on it. */
  async update(actor: Actor, clientId: Id, input: ClientUpdate, expectedVersion: number): Promise<Client> {
    await this.deps.guard.require(actor, "staff.operate", { type: CLIENT_TARGET, id: clientId });
    const current = await this.deps.repository.clients.findById(clientId);
    if (current === null) {
      throw notFound("client");
    }
    this.validate(input.corporateName, input.corporateNumber);
    if (!CLIENT_STATUSES.includes(input.status)) {
      throw invalidInput("status");
    }
    if (!TRANSITIONS[current.status].includes(input.status)) {
      throw invalidState("client_status_transition");
    }
    if (input.status === "Closed" && current.status !== "Closed") {
      await this.deps.guard.require(actor, "client.close", { type: CLIENT_TARGET, id: clientId });
    }
    const updated: Client = { ...current, ...input, version: expectedVersion + 1 };
    if (!(await this.deps.repository.clients.update(updated, expectedVersion))) {
      throw conflict("stale");
    }
    await this.deps.audit.record(actor, current.status === input.status ? "client.update" : `client.status.${input.status}`, CLIENT_TARGET, clientId);
    return updated;
  }

  private validate(corporateName: string, corporateNumber: string | null): void {
    if (corporateName.trim() === "" || corporateName.length > MAX_CORPORATE_NAME_LENGTH) {
      throw invalidInput("corporate_name");
    }
    if (corporateNumber !== null && !isValidCorporateNumber(corporateNumber)) {
      throw invalidInput("corporate_number");
    }
  }
}
