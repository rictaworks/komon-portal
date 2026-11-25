import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

/** The request header that Cloudflare Access sets on every request it lets through. */
export const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";

export interface AccessConfig {
  /** The Access team domain, for example example.cloudflareaccess.com. */
  teamDomain: string;
  /** The application audience tag of the Access application. */
  audience: string;
}

/** Keys published by Access for the team. Fetched once per team domain and cached by the library. */
export function remoteAccessKeys(teamDomain: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
}

/**
 * Verifies the Access assertion of a request and returns its subject. The email address is never read,
 * stored or logged. Anything that does not verify is refused.
 */
export async function verifyAccess(token: string, config: AccessConfig, keys: JWTVerifyGetKey): Promise<string> {
  const { payload } = await jwtVerify(token, keys, {
    issuer: `https://${config.teamDomain}`,
    audience: config.audience,
    algorithms: ["RS256", "ES256"],
  });
  if (typeof payload.sub !== "string" || payload.sub === "") {
    throw new errors.JWTClaimValidationFailed("the assertion has no subject", payload, "sub", "check_failed");
  }
  return payload.sub;
}

/** The settings the admin Worker needs. Missing values are an explicit configuration error, never a default. */
export function accessConfigOf(env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }): AccessConfig {
  if (env.ACCESS_TEAM_DOMAIN === undefined || env.ACCESS_TEAM_DOMAIN === "" || env.ACCESS_AUD === undefined || env.ACCESS_AUD === "") {
    throw new AdminConfigError();
  }
  return { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD };
}

export class AdminConfigError extends Error {
  constructor() {
    super("ACCESS_TEAM_DOMAIN and ACCESS_AUD must be set");
    this.name = "AdminConfigError";
  }
}
