import { notFound } from "../model/errors";
import type { CaseRecord, Client, Id, KeyEvidence, ResolutionMethod, ReviewReason } from "../model/types";
import type { Repository } from "../ports/repository";
import type { ExtractedKeys } from "./key-extractor";

export interface Resolution {
  clientId: Id | null;
  caseId: Id | null;
  method: ResolutionMethod | null;
  reviewReason: ReviewReason | null;
  unmatchedArrivalNumber: string | null;
  evidence: KeyEvidence[];
}

interface Lookups {
  matchedCase: CaseRecord | null;
  /** Clues that each point to exactly one client, in priority order. */
  evidence: KeyEvidence[];
  /** Client sets of corporate numbers registered to several clients. They decide nothing but can contradict. */
  sharedNumberClients: Id[][];
}

type ResolverRepository = Pick<Repository, "cases" | "clients">;

/**
 * Decides the destination client from exact identifiers or the staff's explicit choice only.
 * It never consults AI, and it stops whenever two clues disagree (instructions.md 1.6.2 step 5).
 */
export class ClientResolver {
  private readonly repository: ResolverRepository;

  constructor(repository: ResolverRepository) {
    this.repository = repository;
  }

  async resolve(keys: ExtractedKeys, hintClientId: Id | null): Promise<Resolution> {
    const hint = hintClientId === null ? null : await this.requireClient(hintClientId);
    const { matchedCase, evidence, sharedNumberClients } = await this.lookUp(keys);
    const allEvidence: KeyEvidence[] = [
      ...evidence,
      ...sharedNumberClients.flat().map((clientId) => ({ kind: "CorporateNumber" as const, clientId })),
      ...(hint === null ? [] : [{ kind: "StaffSelected" as const, clientId: hint.id }]),
    ];
    const contradictsShared = (clientId: Id): boolean => sharedNumberClients.some((clients) => !clients.includes(clientId));

    // a: identifiers that point to different clients
    if (new Set(evidence.map((item) => item.clientId)).size > 1) {
      return this.review("ConflictingKeys", allEvidence);
    }
    // b: more than one distinct arrival number
    if (keys.arrivalNumbers.length > 1) {
      return this.review("MultipleArrivalNumbers", allEvidence);
    }
    // c to e: the first identifier in priority order
    const decisive = evidence[0];
    if (decisive !== undefined) {
      if (contradictsShared(decisive.clientId)) {
        return this.review("ConflictingKeys", allEvidence);
      }
      if (hint !== null && hint.id !== decisive.clientId) {
        return this.review("HintMismatch", allEvidence);
      }
      return this.accept(decisive.clientId, decisive.kind as ResolutionMethod, matchedCase, keys, allEvidence);
    }
    // f: the client chosen at intake
    if (hint !== null) {
      if (contradictsShared(hint.id)) {
        return this.review("HintMismatch", allEvidence);
      }
      return this.accept(hint.id, "StaffSelected", null, keys, allEvidence);
    }
    // g: nothing to go on
    return this.review("NoKey", allEvidence);
  }

  private async lookUp(keys: ExtractedKeys): Promise<Lookups> {
    const evidence: KeyEvidence[] = [];
    const sharedNumberClients: Id[][] = [];
    let matchedCase: CaseRecord | null = null;
    for (const arrivalNumber of keys.arrivalNumbers) {
      const found = await this.repository.cases.findByArrivalNumber(arrivalNumber);
      if (found !== null) {
        matchedCase = matchedCase ?? found;
        evidence.push({ kind: "ArrivalNumber", clientId: found.clientId });
      }
    }
    for (const code of keys.clientCodes) {
      const found = await this.repository.clients.findByCode(code);
      if (found !== null) {
        evidence.push({ kind: "ClientCode", clientId: found.id });
      }
    }
    for (const corporateNumber of keys.corporateNumbers) {
      const found = await this.repository.clients.findByCorporateNumber(corporateNumber);
      const only = found[0];
      if (found.length === 1 && only !== undefined) {
        evidence.push({ kind: "CorporateNumber", clientId: only.id });
      } else if (found.length > 1) {
        sharedNumberClients.push(found.map((client) => client.id));
      }
    }
    return { matchedCase, evidence, sharedNumberClients };
  }

  private async accept(
    clientId: Id,
    method: ResolutionMethod,
    matchedCase: CaseRecord | null,
    keys: ExtractedKeys,
    evidence: KeyEvidence[],
  ): Promise<Resolution> {
    const client = await this.requireClient(clientId);
    if (client.status !== "Active") {
      return this.review("ClientNotActive", evidence);
    }
    const linkedCase = method === "ArrivalNumber" ? matchedCase : null;
    if (linkedCase !== null && linkedCase.state === "Cancelled") {
      return this.review("CaseCancelled", evidence);
    }
    const [onlyArrival] = keys.arrivalNumbers;
    return {
      clientId,
      caseId: linkedCase?.id ?? null,
      method,
      reviewReason: null,
      // Only a staff-chosen destination prompts registering a case for an unknown arrival number (1.6.2 step 5).
      unmatchedArrivalNumber: method === "StaffSelected" && onlyArrival !== undefined ? onlyArrival : null,
      evidence,
    };
  }

  private review(reason: ReviewReason, evidence: KeyEvidence[]): Resolution {
    return { clientId: null, caseId: null, method: null, reviewReason: reason, unmatchedArrivalNumber: null, evidence };
  }

  private async requireClient(id: Id): Promise<Client> {
    const client = await this.repository.clients.findById(id);
    if (client === null) {
      throw notFound("client");
    }
    return client;
  }
}
