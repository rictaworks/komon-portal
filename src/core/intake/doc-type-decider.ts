import type { DocRule, DocType, FileDirection, Id, TypeSource } from "../model/types";

export interface TypeDecision {
  docTypeId: Id | null;
  source: TypeSource | null;
}

const UNDECIDED: TypeDecision = { docTypeId: null, source: null };

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

function appliesTo(docType: DocType, direction: FileDirection): boolean {
  return docType.direction === "Both" || docType.direction === direction;
}

/**
 * Decides the document type from the keyword rules. Exactly one matching type decides it;
 * matches for several types, or none, leave the file unclassified.
 */
export function decideByRules(
  titleText: string,
  direction: FileDirection,
  docTypes: readonly DocType[],
  rules: readonly DocRule[],
): TypeDecision {
  const title = normalize(titleText);
  const eligible = new Set(docTypes.filter((docType) => appliesTo(docType, direction)).map((docType) => docType.id));
  const matched = new Set(
    rules
      .filter((rule) => eligible.has(rule.docTypeId) && rule.keyword.length > 0 && title.includes(normalize(rule.keyword)))
      .map((rule) => rule.docTypeId),
  );
  const [only] = [...matched];
  return matched.size === 1 && only !== undefined ? { docTypeId: only, source: "Rule" } : { ...UNDECIDED };
}
