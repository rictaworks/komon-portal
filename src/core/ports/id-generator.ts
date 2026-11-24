export interface IdGenerator {
  /** New unique identifier for a record. */
  newId(): string;
  /** URL-safe random token with at least `bytes` bytes of entropy. */
  randomToken(bytes: number): string;
}
