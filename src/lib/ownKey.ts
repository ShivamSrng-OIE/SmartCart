/**
 * The visitor's own model key (OpenRouter or Gemini). It stays in this browser: in this tab only, or on this
 * device if they ask to remember it. It is sent only to this app's own API, with their own requests, and the
 * server never stores it. With OpenRouter only free models are used.
 */
export type OwnProvider = "openrouter" | "gemini";

export interface OwnKey {
  provider: OwnProvider;
  key: string;
  remember: boolean;
}

const KEY = "tote.ownKey";
const EVENT = "tote:own-key";
export const KEY_HEADERS: Record<OwnProvider, string> = { openrouter: "X-LLM-OpenRouter-Key", gemini: "X-LLM-Gemini-Key" };

export const PROVIDER_INFO: Record<OwnProvider, { name: string; getUrl: string; hint: string; looksLike: RegExp }> = {
  openrouter: {
    name: "OpenRouter",
    getUrl: "https://openrouter.ai/settings/keys",
    hint: "Free to create. Only free models are used, so it costs nothing.",
    looksLike: /^sk-or-[A-Za-z0-9_-]{10,}$/,
  },
  gemini: {
    name: "Google Gemini",
    getUrl: "https://aistudio.google.com/apikey",
    hint: "Free to create in Google AI Studio. Fastest checks. Free-tier limits apply.",
    looksLike: /^[A-Za-z0-9_.-]{20,}$/,
  },
};

function read(store: Storage | undefined): OwnKey | null {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as OwnKey;
    return v && (v.provider === "openrouter" || v.provider === "gemini") && typeof v.key === "string" && v.key ? v : null;
  } catch {
    return null;
  }
}

export function getOwnKey(): OwnKey | null {
  return read(globalThis.sessionStorage) ?? read(globalThis.localStorage);
}

export function setOwnKey(v: OwnKey | null): void {
  try {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
    if (v) (v.remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify({ ...v, key: v.key.trim() }));
  } catch {
    /* storage blocked: the key just isn't kept */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function onOwnKeyChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  const storage = (e: StorageEvent) => e.key === KEY && fn();
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", storage);
  };
}

/** The headers that carry the key on a request to our API (none if no key is set). */
export function ownKeyHeaders(v: OwnKey | null = getOwnKey()): Record<string, string> {
  return v ? { [KEY_HEADERS[v.provider]]: v.key.trim(), "X-LLM-Provider": v.provider } : {};
}

/** "sk-or-…a1b2": enough to recognise a key without showing it. */
export function maskKey(key: string): string {
  const k = key.trim();
  return k.length <= 8 ? "••••" : `${k.slice(0, 6)}…${k.slice(-4)}`;
}
