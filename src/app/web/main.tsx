import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/800.css";
import { config as fontAwesomeConfig } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { englishTranslator, I18nContext } from "./i18n";
import { Loading, StartupError } from "./pages/common/Status";
import { SessionProvider } from "./session";
import "./styles/app.css";

function mount(): void {
  const container = document.getElementById("root");
  if (container === null) {
    throw new Error("Root element is missing");
  }
  // The stylesheet is bundled as a file; nothing may be injected inline under the Content Security Policy.
  fontAwesomeConfig.autoAddCss = false;
  const t = englishTranslator();
  document.title = t("app.name");
  createRoot(container).render(
    <StrictMode>
      <I18nContext.Provider value={t}>
        <SessionProvider loading={<Loading />} failed={(error) => <StartupError error={error} />}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SessionProvider>
      </I18nContext.Provider>
    </StrictMode>,
  );
}

mount();
