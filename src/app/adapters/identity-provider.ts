/** What the application keeps from a sign-in: the opaque subject and the display name. No email address. */
export interface Identity {
  sub: string;
  displayName: string;
}

export interface AuthorizationRequest {
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}

export interface CodeExchange {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  expectedNonce: string;
}

export class IdentityError extends Error {
  constructor(detail: string) {
    super(`identity: ${detail}`);
    this.name = "IdentityError";
  }
}

/** Sign-in provider (OpenID Connect). */
export interface IdentityProvider {
  authorizationUrl(request: AuthorizationRequest): string;
  /** Exchanges the authorization code and returns the verified identity. Throws IdentityError. */
  exchange(exchange: CodeExchange): Promise<Identity>;
}

/** Decides whether a request to a public form comes from a person (Turnstile). */
export interface HumanVerifier {
  verify(token: string): Promise<boolean>;
}
