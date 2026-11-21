import type { Intent } from "../types";

const WORDS: Record<string, number> = { one: 1, a: 1, an: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, dozen: 12 };

/** Display-side twin of backend intent.parse_intent: the budget field wins, then "$25" / "under 25" in text. */
export function parseIntent(text: string, budgetField: string | number | null | undefined): Intent {
  let budget: number | null = null;
  const fieldNum = typeof budgetField === "number" ? budgetField : Number.parseFloat(String(budgetField ?? ""));
  if (Number.isFinite(fieldNum) && fieldNum > 0) budget = fieldNum;
  const stripped = text.replace(/(\$\s*|\bunder\s+\$?)(\d+(?:\.\d+)?)/gi, (_m, _p, n) => {
    if (budget == null) budget = Number.parseFloat(n);
    return " ";
  });
  let quantity = 1;
  const m = stripped.match(/\b(\d+|one|two|three|four|five|six|ten|dozen|single)\b/i);
  if (m) {
    const tok = m[1].toLowerCase();
    quantity = /^\d+$/.test(tok) ? Number.parseInt(tok, 10) : (WORDS[tok] ?? 1);
  }
  return { text, budget, quantity };
}
