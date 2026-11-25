import {
  ClassifierError, type ClassifierPort, type ClassifierRequest, type ClassifierResponse,
} from "../../core/ports/classifier";

/** The only host this adapter ever calls. */
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

interface JevAnswer {
  choice?: unknown;
  confidence?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * TypeSafe Jev, Choice questions. One call carries every item as its own question over a shared
 * state. The key is used for the one request and never stored, logged or echoed in an error.
 */
export class JevClassifier implements ClassifierPort {
  constructor(private readonly fetcher: typeof fetch) {}

  async choose(request: ClassifierRequest): Promise<ClassifierResponse> {
    const questionOf = new Map(request.items.map((item, index) => [`q${index}`, item]));
    const optionOf = new Map(request.choices.map((choice, index) => [`t${index}`, choice]));
    const body = {
      model: request.model,
      state: { documents: [...questionOf].map(([key, item]) => ({ key, title: item.text })) },
      questions: Object.fromEntries(
        [...questionOf.keys()].map((key) => [
          key,
          {
            type: "choice",
            instructions: `Which document type does the title of the document with key "${key}" name?`,
            criteria: Object.fromEntries([...optionOf].map(([option, choice]) => [option, choice.label])),
          },
        ]),
      ),
    };
    let response: Response;
    try {
      response = await this.fetcher(JEV_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${request.credential}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ClassifierError("network_failure");
    }
    if (!response.ok) {
      throw new ClassifierError(await this.errorCode(response));
    }
    const parsed: unknown = await response.json().catch(() => null);
    if (!isRecord(parsed) || typeof parsed.model !== "string" || !isRecord(parsed.answers)) {
      throw new ClassifierError("invalid_response");
    }
    const answers = [];
    for (const [key, item] of questionOf) {
      const answer = parsed.answers[key] as JevAnswer | undefined;
      const choice = typeof answer?.choice === "string" ? optionOf.get(answer.choice) : undefined;
      if (choice === undefined || typeof answer?.confidence !== "number") {
        throw new ClassifierError("invalid_response");
      }
      answers.push({ itemId: item.id, choiceId: choice.id, confidence: answer.confidence });
    }
    return { model: parsed.model, answers };
  }

  private async errorCode(response: Response): Promise<ClassifierError["code"]> {
    if (response.status === 401 || response.status === 403) {
      return "authentication_failed";
    }
    if (response.status === 429) {
      return "limit_reached";
    }
    if (response.status === 404) {
      return "unsupported_model";
    }
    if (response.status === 400 || response.status === 422) {
      const text = await response.text().catch(() => "");
      return /model/i.test(text) ? "unsupported_model" : "invalid_response";
    }
    return "network_failure";
  }
}
