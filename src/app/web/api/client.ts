/** Error answered by the API: a stable code and an optional detail code. Never display text. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string | null,
  ) {
    super(`${status} ${code}${detail === null ? "" : ` ${detail}`}`);
    this.name = "ApiError";
  }
}

export const CSRF_HEADER = "X-CSRF-Token";
const NETWORK_ERROR = "network_error";
const BAD_RESPONSE = "bad_response";

export interface RequestOptions {
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

/** Thin client for the JSON API. Sends the CSRF token on every state-changing request. */
export class ApiClient {
  private csrfToken: string | null = null;

  constructor(private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}

  setCsrfToken(token: string | null): void {
    this.csrfToken = token;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path, {});
  }

  post<T>(path: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<T> {
    return this.request<T>("POST", path, { body, headers });
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, { body });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body });
  }

  delete<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>("DELETE", path, { body });
  }

  upload<T>(path: string, form: FormData): Promise<T> {
    return this.request<T>("POST", path, { form });
  }

  private async request<T>(method: string, path: string, options: RequestOptions): Promise<T> {
    const headers = new Headers(options.headers);
    if (method !== "GET" && this.csrfToken !== null) {
      headers.set(CSRF_HEADER, this.csrfToken);
    }
    let body: BodyInit | null = null;
    if (options.form !== undefined) {
      body = options.form;
    } else if (options.body !== undefined && method !== "GET") {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }
    let response: Response;
    try {
      response = await this.fetcher(path, { method, headers, body, credentials: "same-origin" });
    } catch {
      throw new ApiError(0, NETWORK_ERROR, null);
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new ApiError(response.status, BAD_RESPONSE, null);
    }
    if (!response.ok) {
      const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
      throw new ApiError(response.status, typeof record.error === "string" ? record.error : BAD_RESPONSE, typeof record.detail === "string" ? record.detail : null);
    }
    return parsed as T;
  }
}

/** URL of a file body. The Worker checks permission on every request to it. */
export function fileContentUrl(fileId: string, mode: "view" | "download"): string {
  return `/api/files/${encodeURIComponent(fileId)}/content?mode=${mode}`;
}
