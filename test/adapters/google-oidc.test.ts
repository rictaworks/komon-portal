import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { GoogleOidc } from "../../src/app/adapters/google-oidc";
import { TurnstileVerifier } from "../../src/app/adapters/turnstile";

const CLIENT_ID = "client-id.apps.googleusercontent.com";
const exchange = { code: "code-1", codeVerifier: "verifier-1", redirectUri: "https://portal.test/api/auth/callback", expectedNonce: "nonce-1" };

describe("GoogleOidc", () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let otherKeys: Awaited<ReturnType<typeof generateKeyPair>>;
  let jwks: { keys: unknown[] };
  const requests: { url: string; body: string }[] = [];

  beforeAll(async () => {
    keys = await generateKeyPair("RS256");
    otherKeys = await generateKeyPair("RS256");
    jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] };
  });

  async function token(claims: Record<string, unknown>, signer = keys.privateKey): Promise<string> {
    return new SignJWT({ nonce: "nonce-1", name: "K. Tanabe", email: "should-be-ignored@example.com", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer((claims.iss as string | undefined) ?? "https://accounts.google.com")
      .setAudience((claims.aud as string | undefined) ?? CLIENT_ID)
      .setSubject((claims.sub as string | undefined) ?? "google-sub-1")
      .setIssuedAt()
      .setExpirationTime((claims.exp as number | undefined) ?? "5m")
      .sign(signer);
  }

  function provider(idToken: string | null, tokenStatus = 200): GoogleOidc {
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: String(init?.body ?? "") });
      if (url.includes("/token")) {
        return new Response(JSON.stringify(idToken === null ? {} : { id_token: idToken }), { status: tokenStatus });
      }
      return new Response(JSON.stringify(jwks));
    }) as typeof fetch;
    return new GoogleOidc({ clientId: CLIENT_ID, clientSecret: "client-secret", fetcher });
  }

  it("asks for openid and profile only, with PKCE", () => {
    const url = new URL(provider(null).authorizationUrl({ redirectUri: exchange.redirectUri, state: "s", nonce: "n", codeChallenge: "c" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("openid profile");
    expect(url.searchParams.get("scope")).not.toContain("email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("returns only the subject and the display name of a verified token", async () => {
    requests.length = 0;
    const identity = await provider(await token({})).exchange(exchange);
    expect(identity).toEqual({ sub: "google-sub-1", displayName: "K. Tanabe" });
    expect(requests[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(requests[0]?.body).toContain("code_verifier=verifier-1");
    expect(requests[0]?.body).toContain("grant_type=authorization_code");
  });

  it.each([
    ["another audience", { aud: "someone-else" }, "id_token_invalid"],
    ["another issuer", { iss: "https://evil.example" }, "id_token_invalid"],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 600 }, "id_token_invalid"],
    ["another nonce", { nonce: "replayed" }, "nonce_mismatch"],
  ])("rejects %s", async (_name, claims, detail) => {
    await expect(provider(await token(claims)).exchange(exchange)).rejects.toThrow(`identity: ${detail}`);
  });

  it("rejects a token signed with another key, a failed exchange and a missing token", async () => {
    await expect(provider(await token({}, otherKeys.privateKey)).exchange(exchange)).rejects.toThrow("identity: id_token_invalid");
    await expect(provider("x", 400).exchange(exchange)).rejects.toThrow("identity: code_exchange_failed");
    await expect(provider(null).exchange(exchange)).rejects.toThrow("identity: id_token_missing");
    await expect(provider("not-a-jwt").exchange(exchange)).rejects.toThrow("identity: id_token_invalid");
  });
});

describe("TurnstileVerifier", () => {
  function verifier(success: boolean, status = 200, seen: string[] = []): TurnstileVerifier {
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ success }), { status });
    }) as typeof fetch;
    return new TurnstileVerifier({ secretKey: "secret", fetcher });
  }

  it("passes and fails with the provider's answer and sends no IP address", async () => {
    const seen: string[] = [];
    expect(await verifier(true, 200, seen).verify("token-1")).toBe(true);
    expect(await verifier(false).verify("token-1")).toBe(false);
    expect(seen).toEqual(["secret=secret&response=token-1"]);
  });

  it("fails an empty token without calling the provider and reports an outage as an error", async () => {
    const seen: string[] = [];
    expect(await verifier(true, 200, seen).verify("")).toBe(false);
    expect(seen).toEqual([]);
    await expect(verifier(true, 500).verify("token-1")).rejects.toThrow("Turnstile verification is unavailable");
  });
});
