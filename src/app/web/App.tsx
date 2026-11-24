import type { Translator } from "./i18n";

export function App({ t }: { t: Translator }) {
  return (
    <main>
      <h1>{t("app.name")}</h1>
      <p>{t("app.tagline")}</p>
    </main>
  );
}
