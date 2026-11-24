import type { Clock } from "../../core/ports/clock";
import type { IdGenerator } from "../../core/ports/id-generator";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Identifiers and tokens from the platform's cryptographic random source. */
export class CryptoIdGenerator implements IdGenerator {
  newId(): string {
    return crypto.randomUUID();
  }

  randomToken(bytes: number): string {
    const buffer = crypto.getRandomValues(new Uint8Array(bytes));
    const binary = String.fromCharCode(...buffer);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }
}
