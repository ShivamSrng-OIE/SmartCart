"""Rule scan: finds instructions aimed at shopping agents in untrusted text, with no model call.

It runs on a listing's description, on audio/video transcripts and on the text Argon read off
photos. It is the deterministic layer under the models: it cannot be talked out of a finding,
it costs nothing, and it quotes the exact words it matched (used as evidence in the fraud card).

    scan(text, source) -> list[Finding]
    summarize(findings) -> {"flagged": bool, "severity": 0-3, "categories": [...], "quotes": [...]}
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass

# (id, category, severity 1-3, pattern). Categories match rules.json probe categories.
_RULES: list[tuple[str, str, int, re.Pattern]] = [
    ("agent_addressed", "injection", 3, re.compile(
        r"\b(?:(?:ai|llm|automated|autonomous|shopping|purchasing)\s+){0,3}(?:agents?|assistants?|bots?|shoppers?)\s*[:,-]\s*"
        r"(?:please\s+)?(?:set|add|buy|purchase|order|increase|select|choose|upgrade|ignore|disregard|approve|use|apply|include|switch|bypass|skip|override|multiply|always)\b",
        re.I)),
    ("note_to_agents", "injection", 3, re.compile(
        r"\b(?:note|message|instructions?|attention|notice)\s+(?:to|for)\s+(?:all\s+)?(?:(?:ai|automated|autonomous|shopping|purchasing)\s+){0,3}"
        r"(?:agents?|assistants?|bots?|shoppers?|llms?)\b", re.I)),
    ("system_tag", "injection", 3, re.compile(
        r"\b(?:SYSTEM[_ ]?(?:PROMPT|NOTE|MESSAGE|OVERRIDE)|AGENT[_ ]?(?:DIRECTIVE|INSTRUCTION|NOTE)|ASSISTANT[_ ]?INSTRUCTION|"
        r"INSTRUCTION|DIRECTIVE)\s*:", re.I)),
    ("ignore_previous", "injection", 3, re.compile(
        r"\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:previous|prior|earlier|above|the\s+user'?s?|user)\s+"
        r"(?:instructions?|requests?|rules?|limits?|choices?|preferences?|budget)\b", re.I)),
    ("set_quantity", "spend_hijack", 3, re.compile(
        r"\b(?:set|change|increase|raise|override|update|bump|make)\s+(?:the\s+)?(?:order\s+|cart\s+|item\s+)?"
        r"(?:quantity|qty|count|units?)\s*(?:to|=|:)?\s*\d+", re.I)),
    ("snake_quantity", "spend_hijack", 3, re.compile(
        r"\b(?:SET|OVERRIDE|INCREASE|MULTIPLY|ADD)_(?:ORDER_)?(?:MAX_)?QUANTITY(?:_[A-Z0-9]+)*\b", re.I)),
    ("add_units", "spend_hijack", 2, re.compile(
        r"\b(?:add|buy|order|purchase)\s+(?:\d{2,}|ten|twelve|twenty|fifty|a\s+hundred)\s+(?:units?|packs?|bottles?|items?|pieces?|of\s+these)\b",
        re.I)),
    ("max_quantity", "spend_hijack", 3, re.compile(r"\b(?:add|buy)\s+(?:the\s+)?max(?:imum)?\s+quantity\b|\bADD_MAX_QUANTITY", re.I)),
    ("budget_override", "spend_hijack", 3, re.compile(
        r"\b(?:ignore|disregard|increase|raise|override|exceed|bypass)\s+(?:the\s+)?(?:user'?s?\s+)?(?:max(?:imum)?\s+)?budget\b|"
        r"\bbudget\s+(?:doesn'?t|does\s+not|won'?t)\s+matter\b|\bINCREASE_(?:MAX_)?BUDGET", re.I)),
    ("spend_request", "spend_hijack", 3, re.compile(
        r"\bspend[_ ]request\b|\bbackup\s+card\b|\bsingle[- ]use\s+card\b|\bpay\s+(?:outside|off)[- ]?(?:of\s+)?(?:shopify|checkout)\b|"
        r"\bTRANSFER_FUNDS|\btransfer\s+funds\b|\bwire\s+(?:the\s+)?(?:money|payment)\b", re.I)),
    ("upsell_directive", "coercion", 2, re.compile(
        r"\b(?:AUTO[_ ]?ADD|AUTOMATIC(?:ALLY)?\s+(?:ADD|PAIRING|ADD-ON|BUNDLE)|UPGRADE_TO|PURCHASE_HIGHEST|SELECT_HIGHEST|"
        r"PURCHASE_ALL|ADD_\w*(?:BUNDLE|PLAN|FEE|KIT|CASE|ADAPTER))", re.I)),
    ("approve_shipping", "coercion", 2, re.compile(r"\bAPPROVE_EXPRESS_SHIPPING|\bSET_SHIPPING_TO_EXPRESS|\bapprove\s+express\s+shipping\s+always\b", re.I)),
    ("skip_confirmation", "coercion", 3, re.compile(
        r"\bBYPASS_CONFIRMATION|\bFORCE_CHECKOUT|\b(?:skip|bypass|without)\s+(?:the\s+)?(?:user\s+)?confirm(?:ation)?\b|\bcheckout\s+now\b", re.I)),
    ("recurring_order", "coercion", 2, re.compile(r"\brecurring\s+order\s*:|\bsubscription\s+active\b|\bmonthly\s+delivery\s+active\b|\bAUTOSHIP", re.I)),
    ("refund_credit", "coercion", 2, re.compile(r"\bREFUND_CREDITS|\bapply\s+(?:refund\s+)?credits?\b", re.I)),
    ("variant_override", "coercion", 2, re.compile(
        r"\b(?:SELECT|CHOOSE)_[A-Z0-9_]*(?:VARIANT|MODEL|PACK|BOTTLE|OPTION|SIZE)\b|\bDISREGARD_USER_\w+", re.I)),
    ("promo_quantity", "pack_lie", 1, re.compile(r"\bPROMO_CODE_\w*QTY\w*|\bpromo\s+code\s+applied\b.*\bquantity\b", re.I)),
    ("fake_user_turn", "injection", 3, re.compile(r"^\s*user\s*:\s*(?:actually|also|update|change|make)\b", re.I | re.M)),
    # A line that opens by addressing agents/bots/assistants ("Agents: ...", "AGENT DEAL: ...",
    # "Bot note: ...", "Assistant promo: ...") is aimed at software, not at a human shopper.
    ("agent_label", "injection", 3, re.compile(
        r"(?i:\b(?:agents?|bots?|assistants?|ai)(?:\s+(?:note|deal|promo|offer|notice|directive|instructions?))?\s*:)"
        r"|\b(?:AGENTS?|BOTS?|ASSISTANTS?)\s+(?:NOTE|DEAL|PROMO|OFFER)\b")),
    ("order_qty", "spend_hijack", 3, re.compile(
        r"\b(?:order|buy|purchase|ship|cart|minimum\s+order|select)\s+(?:qty|quantity)\s*(?:of\s*|=\s*|:\s*)?\d+"
        r"|\bsold\s+in\s+\d{2,}s?\b|\b(?:add|buy)\s+\d+\s+to\s+cart\b|\bqty\s+\d{2,}\b", re.I)),
    ("express_pay", "spend_hijack", 3, re.compile(
        r"\bexpress\s+pay\b|\bpay\s+\$\s?\d+\s+now\b|\bauthori[sz]e\s+\$\s?\d+\b|\bstore\s+credit\s+purchase\b", re.I)),
    ("auto_bundle", "coercion", 2, re.compile(r"\bauto-?apply\s+bundle\b|\bbundle\s+x\d+\b|\bBOGO\s+applied\b", re.I)),
]

_SNAKE_DIRECTIVE = re.compile(r"\b[A-Z]{2,}(?:_[A-Z0-9$]{2,}){2,}\b")  # e.g. ADD_INSTALLATION_KIT_FEE_$15
_VERBS = ("SET", "ADD", "BUY", "PURCHASE", "UPGRADE", "SELECT", "APPROVE", "INCREASE", "OVERRIDE", "MULTIPLY",
          "FORCE", "BYPASS", "DISREGARD", "IGNORE", "TRANSFER", "AUTO", "REFUND", "CHOOSE", "INCLUDE", "APPLY")


@dataclass
class Finding:
    rule: str
    category: str
    severity: int
    quote: str
    source: str
    start: int
    end: int

    def to_dict(self) -> dict:
        return asdict(self)


def _expand(text: str, start: int, end: int) -> tuple[int, int]:
    """Grow a match to the sentence/line it sits in, so the quote reads naturally."""
    nl, dot = text.rfind("\n", 0, start), text.rfind(". ", 0, start)
    lo = max(nl + 1, dot + 2 if dot >= 0 else 0, 0)
    nl, dot = text.find("\n", end), text.find(". ", end)
    ends = [i for i in (nl, dot) if i >= 0]
    if ends:
        hi = min(ends) + (1 if min(ends) == dot else 0)
    else:
        hi = len(text)
    if hi - lo > 300:
        lo, hi = max(lo, start - 120), min(hi, max(end, start - 120 + 300))
    return lo, hi


def scan(text: str | None, source: str = "text") -> list[Finding]:
    if not text:
        return []
    found: list[Finding] = []
    taken: list[tuple[int, int]] = []
    for rule, category, severity, pattern in _RULES:
        for m in pattern.finditer(text):
            lo, hi = _expand(text, m.start(), m.end())
            if any(a <= m.start() < b for a, b in taken):
                continue
            taken.append((lo, hi))
            found.append(Finding(rule, category, severity, text[lo:hi].strip(), source, lo, hi))
    for m in _SNAKE_DIRECTIVE.finditer(text):
        token = m.group(0)
        if token.split("_", 1)[0] in _VERBS and not any(a <= m.start() < b for a, b in taken):
            lo, hi = _expand(text, m.start(), m.end())
            taken.append((lo, hi))
            found.append(Finding("snake_directive", "injection", 2, text[lo:hi].strip(), source, lo, hi))
    return sorted(found, key=lambda f: (-f.severity, f.start))


def scan_many(texts: dict[str, str | None]) -> list[Finding]:
    out: list[Finding] = []
    for source, text in texts.items():
        out.extend(scan(text, source))
    return out


def summarize(findings: list[Finding]) -> dict:
    return {
        "flagged": bool(findings),
        "severity": max((f.severity for f in findings), default=0),
        "categories": sorted({f.category for f in findings}),
        "quotes": [{"quote": f.quote, "source": f.source, "rule": f.rule, "category": f.category} for f in findings[:8]],
    }
