function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** PKCE S256 challenge of a verifier. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Only same-site paths are accepted as a place to return to after sign-in. */
export function safeReturnPath(value: string | undefined): string {
  if (value === undefined || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.startsWith("/api/")) {
    return "/";
  }
  return value;
}
