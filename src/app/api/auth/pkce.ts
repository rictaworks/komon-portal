function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** PKCE S256 challenge of a verifier. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

const RETURN_PATH_LIMIT = 512;
const ORIGIN_PLACEHOLDER = "https://return-path.invalid";
/** Printable ASCII without spaces: browsers strip tabs and newlines, so they are refused outright. */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/**
 * Only same-site paths are accepted as a place to return to after sign-in. The value is normalised
 * first, so a path such as "/./api/x" cannot slip past the API prefix check.
 */
export function safeReturnPath(value: string | undefined): string {
  if (value === undefined || value.length > RETURN_PATH_LIMIT || !PRINTABLE_ASCII.test(value)) {
    return "/";
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  const url = new URL(value, ORIGIN_PLACEHOLDER);
  if (url.origin !== ORIGIN_PLACEHOLDER || url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return "/";
  }
  return `${url.pathname}${url.search}`;
}
