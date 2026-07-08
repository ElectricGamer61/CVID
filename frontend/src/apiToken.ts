// Opt-in API token. When the backend has CVIDEO_API_TOKEN set, it requires this token on
// every /api/* request. We keep it in localStorage and attach it to every /api fetch via a
// one-time fetch patch. When no token is stored (the default), this is a transparent
// passthrough — nothing changes for solo/local use.
const KEY = "cvideo_api_token";

export const getApiToken = (): string => {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
};

export const setApiToken = (t: string): void => {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* localStorage unavailable — ignore */
  }
};

let patched = false;

/** Wrap window.fetch once so every same-origin /api call carries the stored token. */
export function installApiTokenFetch(): void {
  if (patched || typeof window === "undefined" || !window.fetch) return;
  patched = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const tok = getApiToken();
    if (tok) {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url && url.includes("/api/")) {
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        );
        headers.set("X-API-Token", tok);
        init = { ...init, headers };
      }
    }
    return orig(input as RequestInfo, init);
  };
}
