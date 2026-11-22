/**
 * Where the shopper is: drives Shop MCP `context.address_country`, `context.currency` and the
 * `ships_to` filter, so prices, currency and availability are real for that country.
 * Detected from the browser on first visit, then remembered.
 */
import { useSyncExternalStore } from "react";

export interface Country {
  code: string;
  name: string;
  currency: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { code: "US", name: "United States", currency: "USD", flag: "🇺🇸" },
  { code: "CA", name: "Canada", currency: "CAD", flag: "🇨🇦" },
  { code: "GB", name: "United Kingdom", currency: "GBP", flag: "🇬🇧" },
  { code: "AU", name: "Australia", currency: "AUD", flag: "🇦🇺" },
  { code: "IN", name: "India", currency: "INR", flag: "🇮🇳" },
  { code: "DE", name: "Germany", currency: "EUR", flag: "🇩🇪" },
  { code: "FR", name: "France", currency: "EUR", flag: "🇫🇷" },
  { code: "NL", name: "Netherlands", currency: "EUR", flag: "🇳🇱" },
  { code: "IE", name: "Ireland", currency: "EUR", flag: "🇮🇪" },
  { code: "JP", name: "Japan", currency: "JPY", flag: "🇯🇵" },
  { code: "NZ", name: "New Zealand", currency: "NZD", flag: "🇳🇿" },
  { code: "SG", name: "Singapore", currency: "SGD", flag: "🇸🇬" },
];

const KEY = "carttrap.country";

function detect(): Country {
  try {
    const saved = localStorage.getItem(KEY);
    const hit = COUNTRIES.find((c) => c.code === saved);
    if (hit) return hit;
  } catch {
    /* private mode */
  }
  const langs = typeof navigator !== "undefined" ? [navigator.language, ...(navigator.languages ?? [])] : [];
  for (const l of langs) {
    const region = l?.split("-")[1]?.toUpperCase();
    const hit = COUNTRIES.find((c) => c.code === region);
    if (hit) return hit;
  }
  return COUNTRIES[0];
}

let current: Country = detect();
const listeners = new Set<() => void>();

export const getCountry = () => current;

export function setCountry(code: string) {
  const next = COUNTRIES.find((c) => c.code === code);
  if (!next || next.code === current.code) return;
  current = next;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

export function useCountry(): Country {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
