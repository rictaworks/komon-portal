import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { OIDC } from "../config/app-config";
import { IdentityError, type AuthorizationRequest, type CodeExchange, type Identity, type IdentityProvider } from "./identity-provider";

export interface GoogleOidcOptions {
  clientId: string;
  clientSecret: string;
  fetcher: typeof fetch;
}

/** Google sign-in with scope `openid profile`. The email scope is never requested. */
export class GoogleOidc implements IdentityProvider {
  constructor(private readonly options: GoogleOidcOptions) {}

  authorizationUrl(request: AuthorizationRequest): string {
    const url = new URL(OIDC.authorizationEndpoint);
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: request.redirectUri,
      response_type: "code",
      scope: OIDC.scope,
      state: request.state,
      nonce: request.nonce,
      code_challenge: request.codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return url.toString();
  }

  async exchange(exchange: CodeExchange): Promise<Identity> {
    const idToken = await this.requestIdToken(exchange);
    const keys = await this.fetchKeys();
    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(idToken, createLocalJWKSet(keys), {
        issuer: [...OIDC.issuers],
        audience: this.options.clientId,
      });
      payload = verified.payload;
    } catch {
      throw new IdentityError("id_token_invalid");
    }
    if (payload.nonce !== exchange.expectedNonce) {
      throw new IdentityError("nonce_mismatch");
    }
    if (typeof payload.sub !== "string" || payload.sub === "") {
      throw new IdentityError("subject_missing");
    }
    if (typeof payload.name !== "string" || payload.name.trim() === "") {
      throw new IdentityError("name_missing");
    }
    return { sub: payload.sub, displayName: payload.name };
  }

  private async requestIdToken(exchange: CodeExchange): Promise<string> {
    const response = await this.options.fetcher(OIDC.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: exchange.code,
        code_verifier: exchange.codeVerifier,
        redirect_uri: exchange.redirectUri,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
      }).toString(),
    });
    if (!response.ok) {
      throw new IdentityError("code_exchange_failed");
    }
    const body: unknown = await response.json();
    const idToken = typeof body === "object" && body !== null ? (body as Record<string, unknown>).id_token : undefined;
    if (typeof idToken !== "string") {
      throw new IdentityError("id_token_missing");
    }
    return idToken;
  }

  private async fetchKeys(): Promise<JSONWebKeySet> {
    const response = await this.options.fetcher(OIDC.jwksUri);
    if (!response.ok) {
      throw new IdentityError("keys_unavailable");
    }
    return (await response.json()) as JSONWebKeySet;
  }
}
