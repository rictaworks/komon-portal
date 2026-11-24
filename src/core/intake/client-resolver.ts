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
  evidence: KeyEvidence[];
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
    const { matchedCase, evidence } = await this.lookUp(keys);
    const allEvidence: KeyEvidence[] = hint === null ? evidence : [...evidence, { kind: "StaffSelected", clientId: hint.id }];

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
      if (hint !== null && hint.id !== decisive.clientId) {
        return this.review("HintMismatch", allEvidence);
      }
      return this.accept(decisive.clientId, decisive.kind as ResolutionMethod, matchedCase, keys, allEvidence);
    }
    // f: the client chosen at intake
    if (hint !== null) {
      return this.accept(hint.id, "StaffSelected", null, keys, allEvidence);
    }
    // g: nothing to go on
    return this.review("NoKey", allEvidence);
  }

  private async lookUp(keys: ExtractedKeys): Promise<Lookups> {
    const evidence: KeyEvidence[] = [];
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
      }
    }
    return { matchedCase, evidence };
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
      unmatchedArrivalNumber: linkedCase === null && onlyArrival !== undefined ? onlyArrival : null,
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
