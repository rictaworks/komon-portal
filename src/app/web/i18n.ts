import { createContext, useContext } from "react";
import en from "../../locales/en.json";

export type MessageTree = { [key: string]: string | MessageTree };
export type Translator = (key: string, params?: Record<string, string | number>) => string;

function find(messages: MessageTree, key: string): string | undefined {
  let node: string | MessageTree | undefined = messages;
  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }
  return typeof node === "string" ? node : undefined;
}

/** Whether the language pack has a message for this key. */
export function hasMessage(messages: MessageTree, key: string): boolean {
  return find(messages, key) !== undefined;
}

/** Creates a translator over one language pack. Missing keys and parameters are errors, never silent fallbacks. */
export function createTranslator(messages: MessageTree): Translator {
  return (key, params = {}) => {
    const message = find(messages, key);
    if (message === undefined) {
      throw new Error(`Missing message: ${key}`);
    }
    return message.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const value = params[name];
      if (value === undefined) {
        throw new Error(`Missing parameter ${name} for message ${key}`);
      }
      return String(value);
    });
  };
}

/** The bundled English pack. Further packs can be added beside it without touching the screens. */
export function englishMessages(): MessageTree {
  return en;
}

export function englishTranslator(): Translator {
  return createTranslator(en);
}

export const I18nContext = createContext<Translator | null>(null);

export function useT(): Translator {
  const translator = useContext(I18nContext);
  if (translator === null) {
    throw new Error("I18nContext is missing");
  }
  return translator;
}
