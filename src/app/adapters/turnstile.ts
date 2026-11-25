import { TURNSTILE_VERIFY_URL } from "../config/app-config";
import type { HumanVerifier } from "./identity-provider";

export interface TurnstileOptions {
  secretKey: string;
  fetcher: typeof fetch;
}

/** Cloudflare Turnstile verification. The visitor's IP address is not sent or stored. */
export class TurnstileVerifier implements HumanVerifier {
  constructor(private readonly options: TurnstileOptions) {}

  async verify(token: string): Promise<boolean> {
    if (token === "") {
      return false;
    }
    const response = await this.options.fetcher(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: this.options.secretKey, response: token }).toString(),
    });
    if (!response.ok) {
      throw new Error("Turnstile verification is unavailable");
    }
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && (body as Record<string, unknown>).success === true;
  }
}
