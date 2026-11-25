import { describe, expect, it } from "vitest";
import { JEV_ENDPOINT, JevClassifier } from "../../src/app/adapters/jev-classifier";

const KEY = "tsk-user-secret-key";
const request = {
  model: "jev-1.13.0",
  credential: KEY,
  items: [{ id: "f1", text: "hyojun kettei" }, { id: "f2", text: "koyou shikaku" }],
  choices: [{ id: "d1", label: "Social insurance notice" }, { id: "d2", label: "Employment insurance notice" }],
};

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function classifier(respond: () => Response | Promise<Response>, calls: Call[] = []): JevClassifier {
  return new JevClassifier((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return respond();
  }) as typeof fetch);
}

function ok(answers: Record<string, unknown>, model = "jev-1.13.0"): Response {
  return new Response(JSON.stringify({ model, answers, usage: { input_tokens: 10, output_tokens: 0 } }));
}

describe("JevClassifier", () => {
  it("sends one call with a Choice question per item and maps the answers back", async () => {
    const calls: Call[] = [];
    const response = await classifier(
      () => ok({ q0: { type: "choice", choice: "t0", confidence: 0.97 }, q1: { type: "choice", choice: "t1", confidence: 0.55 } }),
      calls,
    ).choose(request);
    expect(response).toEqual({
      model: "jev-1.13.0",
      answers: [{ itemId: "f1", choiceId: "d1", confidence: 0.97 }, { itemId: "f2", choiceId: "d2", confidence: 0.55 }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(JEV_ENDPOINT);
    expect(calls[0]?.url.startsWith("https://api.typesafe.ai/")).toBe(true);
    expect(calls[0]?.headers).toEqual({ Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });
    expect(calls[0]?.body).toMatchObject({
      model: "jev-1.13.0",
      state: { documents: [{ key: "q0", title: "hyojun kettei" }, { key: "q1", title: "koyou shikaku" }] },
      questions: {
        q0: { type: "choice", criteria: { t0: "Social insurance notice", t1: "Employment insurance notice" } },
        q1: { type: "choice" },
      },
    });
    expect(JSON.stringify(calls[0]?.body)).not.toContain(KEY);
    expect(JSON.stringify(calls[0]?.body)).not.toContain("f1");
  });

  it("reports the model name the provider answered with", async () => {
    const response = await classifier(() => ok({ q0: { choice: "t0", confidence: 1 }, q1: { choice: "t0", confidence: 1 } }, "jev-1.13.1")).choose(request);
    expect(response.model).toBe("jev-1.13.1");
  });

  it.each([
    [401, "", "authentication_failed"],
    [403, "", "authentication_failed"],
    [429, "", "limit_reached"],
    [404, "", "unsupported_model"],
    [422, '{"detail":[{"loc":["body","model"],"msg":"unknown model"}]}', "unsupported_model"],
    [400, '{"detail":"max_tokens_exceeded"}', "invalid_response"],
    [500, "", "network_failure"],
    [529, "", "network_failure"],
  ] as const)("maps HTTP %i to %s without retrying", async (status, body, code) => {
    const calls: Call[] = [];
    await expect(classifier(() => new Response(body, { status }), calls).choose(request)).rejects.toThrow(`classifier: ${code}`);
    expect(calls).toHaveLength(1);
  });

  it("maps a network error to network_failure and never leaks the key", async () => {
    const failing = classifier(() => {
      throw new TypeError(`fetch failed for key ${KEY}`);
    });
    const error = await failing.choose(request).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("classifier: network_failure");
    expect(JSON.stringify(error)).not.toContain(KEY);
  });

  it.each([
    ["a body that is not JSON", () => new Response("<html>")],
    ["a missing answer", () => ok({ q0: { choice: "t0", confidence: 0.9 } })],
    ["an unknown option", () => ok({ q0: { choice: "t9", confidence: 0.9 }, q1: { choice: "t0", confidence: 0.9 } })],
    ["a confidence that is not a number", () => ok({ q0: { choice: "t0", confidence: "high" }, q1: { choice: "t0", confidence: 0.9 } })],
    ["a missing model", () => new Response(JSON.stringify({ answers: {} }))],
  ])("rejects %s", async (_name, respond) => {
    await expect(classifier(respond).choose(request)).rejects.toThrow("classifier: invalid_response");
  });
});
