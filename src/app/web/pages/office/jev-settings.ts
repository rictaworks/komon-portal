const KEY_STORAGE = "komon.jev.key";
const MODEL_STORAGE = "komon.jev.model";
const MODEL_NAME = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const ALIAS_SUFFIXES = ["-latest", "-preview"];

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

/** Only fixed versions are accepted: an alias would move to another model without notice. */
export function isFixedModelName(model: string): boolean {
  return MODEL_NAME.test(model) && !ALIAS_SUFFIXES.some((suffix) => model.endsWith(suffix));
}
