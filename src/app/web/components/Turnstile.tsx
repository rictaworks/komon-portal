import { useEffect, useRef } from "react";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "turnstile-script";

interface TurnstileApi {
  render(element: HTMLElement, options: { sitekey: string; callback(token: string): void; "expired-callback"(): void; "error-callback"(): void }): string;
  remove(widgetId: string): void;
}

function turnstileApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (turnstileApi() !== undefined) {
      resolve();
      return;
    }
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Turnstile script failed to load")));
    if (existing === null) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export interface TurnstileProps {
  siteKey: string;
  /** Receives the token, or null when it expired or the check failed. */
  onToken(token: string | null): void;
}

/** Cloudflare Turnstile widget for the public forms. */
export function Turnstile({ siteKey, onToken }: TurnstileProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    void loadScript()
      .then(() => {
        const api = turnstileApi();
        if (cancelled || api === undefined || container.current === null) {
          return;
        }
        widgetId = api.render(container.current, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (widgetId !== null) {
        turnstileApi()?.remove(widgetId);
      }
    };
  }, [siteKey, onToken]);

  return <div ref={container} />;
}
