import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { englishTranslator } from "./i18n";

function mount(): void {
  const container = document.getElementById("root");
  if (container === null) {
    throw new Error("Root element is missing");
  }
  const t = englishTranslator();
  document.title = t("app.name");
  createRoot(container).render(
    <StrictMode>
      <App t={t} />
    </StrictMode>,
  );
}

mount();
