import type { Intent } from "../types";

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, pair: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dozen: 12,
};

export interface IntentItem {
  quantity: number;
  name: string;
}

const BUDGET_RE = /(?:\$\s*|\b(?:under|below|max(?:imum)?|less than|up to|within|budget(?: of)?|i have|i've got|spend)\s+\$?)(\d+(?:\.\d+)?)/gi;
const VERB_RE = /^(?:please\s+)?(?:can you\s+)?(?:buy|get|order|grab|purchase|add|i want|i need|find)\s+(?:me\s+)?/i;

/** Normalize messy typing: collapse whitespace, smart quotes, stray separators. */
export function cleanRequest(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s*([,;])\s*/g, "$1 ")
    .replace(/([,;]\s*)+$/g, "")
    .trim();
}

/**
 * "buy 2 mugs, a bag of granola and one cold brew under $50"
 *   → [{2, "mugs"}, {1, "bag of granola"}, {1, "cold brew"}]
 * Items are split on commas, semicolons, "and" between items, and new lines.
 */
export function parseItems(text: string): IntentItem[] {
  const body = cleanRequest(text).replace(BUDGET_RE, " ").replace(/\b(?:for|at|with)\s*$/i, "");
  const parts = body
    .split(/\s*(?:[,;\n]|\band\b|&)\s*/i)
    .map((s) => s.replace(VERB_RE, "").replace(/\b(?:each|total|please|thanks?)\b/gi, "").trim())
    .filter((s) => s.length > 0);
  return parts.map((raw) => {
    const part = raw.replace(/^(?:a|an)\s+(dozen|pair)\b/i, "$1");
    const m = part.match(/^(\d+|[a-z]+)\s*(?:x\s+|×\s*)?(.*)$/i);
    if (m) {
      const tok = m[1].toLowerCase();
      const n = /^\d+$/.test(tok) ? Number.parseInt(tok, 10) : WORDS[tok];
      if (n && m[2].trim()) return { quantity: Math.min(n, 999), name: m[2].replace(/^(?:of\s+)/i, "").trim() };
    }
    return { quantity: 1, name: part };
  });
}

const OPEN_ENDED = /\b(anything|something|whatever|surprise me|any item|any product|you choose|your choice|up to you|a gift|gift ideas?)\b/i;

/**
 * "I have $30, buy anything under that": the shopper gave a budget, not a product.
 * True when the request names no specific item (or only open-ended words like "anything").
 */
export function isOpenEnded(text: string): boolean {
  const t = cleanRequest(text);
  if (!t) return true;
  if (OPEN_ENDED.test(t)) return true;
  const items = parseItems(t).filter(
    (i) => !/^(it|that|this|these|them|one|stuff|things?)$/i.test(i.name) && !/^(i have|i've got|here is|here's|with)\b/i.test(i.name),
  );
  return items.length === 0;
}

/** The request sent to the assistant: an empty box with a budget becomes "anything under $X". */
export function requestText(text: string, budget: number | null): string {
  const t = cleanRequest(text);
  if (!t && budget != null) return `Buy anything under $${budget}`;
  return t;
}

/**
 * Display-side twin of backend intent.parse_intent: the budget field wins, then "$25" / "under 25"
 * in the text. With several comma-separated items, quantity is the total number of units.
 */
export function parseIntent(text: string, budgetField: string | number | null | undefined): Intent {
  let budget: number | null = null;
  const fieldNum = typeof budgetField === "number" ? budgetField : Number.parseFloat(String(budgetField ?? ""));
  if (Number.isFinite(fieldNum) && fieldNum > 0) budget = fieldNum;
  if (budget == null) {
    const m = [...cleanRequest(text).matchAll(BUDGET_RE)][0];
    if (m) budget = Number.parseFloat(m[1]);
  }
  const items = isOpenEnded(text) ? [] : parseItems(text);
  const quantity = items.length ? items.reduce((n, i) => n + i.quantity, 0) : 1;
  return { text: cleanRequest(text), budget, quantity: Math.max(1, quantity) };
}
