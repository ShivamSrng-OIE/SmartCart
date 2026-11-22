import { API_BASE } from "../config";

/**
 * One id per browser session (per tab, until it is closed). The backend keeps marketplace reputation per session,
 * so every visit starts from the original ratings and watches them fall as its own checks catch listings.
 */
const KEY = "tote.session";
export const SESSION_HEADER = "X-Tote-Session";

function fresh(): string {
  const c = globalThis.crypto;
  return c && "randomUUID" in c ? c.randomUUID() : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function sessionId(): string {
  try {
    const have = sessionStorage.getItem(KEY);
    if (have) return have;
    const id = fresh();
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    return (memo ??= fresh()); // storage blocked (private mode): one id for this page load
  }
}
let memo: string | undefined;

/** Is this request for our API (not Shopify, not a photo on another host)? */
export function isApiRequest(url: string, origin = globalThis.location?.origin ?? ""): boolean {
  const base = API_BASE || origin;
  const abs = url.startsWith("/") ? `${origin}${url}` : url;
  return abs.startsWith(`${base}/api/`);
}

/** Send the session id with every call to our API, wherever in the app the call is made. */
export function installSessionHeader(): void {
  const w = window as Window & { __toteSession?: boolean };
  if (w.__toteSession) return;
  w.__toteSession = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!isApiRequest(url)) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(SESSION_HEADER, sessionId());
    return original(input, { ...init, headers });
  };
}
