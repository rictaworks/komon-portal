const KEY_STORAGE = "komon.jev.key";
const MODEL_STORAGE = "komon.jev.model";
/** A fixed version such as jev-1.13.0. Aliases (jev-latest, jev-preview) and bare names do not match. */
const MODEL_NAME = /^[a-z][a-z0-9]*-\d+(?:\.\d+)+$/;

export interface JevSettings {
  key: string;
  model: string;
}

/** The Jev key and model live in this browser only. They are never saved on the server. */
export function loadJevSettings(): JevSettings {
  return { key: window.localStorage.getItem(KEY_STORAGE) ?? "", model: window.localStorage.getItem(MODEL_STORAGE) ?? "" };
}

export function saveJevSettings(settings: JevSettings): void {
  window.localStorage.setItem(KEY_STORAGE, settings.key);
  window.localStorage.setItem(MODEL_STORAGE, settings.model);
}

export function removeJevSettings(): void {
  window.localStorage.removeItem(KEY_STORAGE);
  window.localStorage.removeItem(MODEL_STORAGE);
}

/**
 * Adds the Jev model to an upload form and returns the header that carries the key. Both are sent only when this
 * browser holds a key, so an upload without one asks Jev for nothing and stays untyped when the rules miss.
 */
export function attachJev(form: FormData, settings: JevSettings): Record<string, string> | undefined {
  if (settings.key === "") {
    return undefined;
  }
  form.set("model", settings.model);
  return { "X-Jev-Key": settings.key };
}

/** Only fixed versions are accepted: an alias would move to another model without notice. */
export function isFixedModelName(model: string): boolean {
  return model.length <= 64 && MODEL_NAME.test(model);
}
