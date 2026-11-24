import en from "../../locales/en.json";

export type MessageTree = { [key: string]: string | MessageTree };
export type Translator = (key: string, params?: Record<string, string | number>) => string;

function lookup(messages: MessageTree, key: string): string {
  let node: string | MessageTree | undefined = messages;
  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }
  if (typeof node !== "string") {
    throw new Error(`Missing message: ${key}`);
  }
  return node;
}

/** Creates a translator over one language pack. Missing keys and parameters are errors, never silent fallbacks. */
export function createTranslator(messages: MessageTree): Translator {
  return (key, params = {}) =>
    lookup(messages, key).replace(/\{(\w+)\}/g, (_match, name: string) => {
      const value = params[name];
      if (value === undefined) {
        throw new Error(`Missing parameter ${name} for message ${key}`);
      }
      return String(value);
    });
}

/** Translator for the bundled English pack. */
export function englishTranslator(): Translator {
  return createTranslator(en);
}
