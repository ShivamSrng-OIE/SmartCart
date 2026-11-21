# API notes (verified call shapes)

Record each external call shape here once it's checked. Code keeps every real call behind one
private function so the rest of the app never depends on SDK details.

## Decisions API (firewall, `FIREWALL_BACKEND=decisions`)

**Status: NOT WIRED.** `backend/firewall_decisions.py::_call_decisions` raises
`NotImplementedError`, so the `decisions` backend currently **fails closed** (every check is
`hard_block_quarantine` with `Verdict.error` set). Fill it in after reading the official docs.

What the installed SDK says (`google-genai` 3.6.1, read from `google/genai/_gaos/decisions.py`
and `google/genai/_gaos/types/decisions/*`, **not yet confirmed against the docs or a live call**):

```python
resp = await client.aio.decisions.create(
    model="models/<id>",                 # "models/{model}" format
    input=[                              # shared prefix, evaluated once for all questions
        {"type": "text", "text": "..."},
        {"type": "image", "data": "<base64>", "mime_type": "image/png", "resolution": "ultra_high"},
        {"type": "audio", "data": "<base64>", "mime_type": "audio/wav"},
        {"type": "document", "data": "<base64>", "mime_type": "application/pdf"},
        {"type": "video", "data": "<base64>", "mime_type": "video/mp4"},
    ],
    questions={                          # keyed by our own ids
        "<probe_id>": {"type": "noul", "instructions": "...",
                       "criteria": {"true_description": "...", "false_description": "..."}},
        "firewall_action": {"type": "choice", "instructions": "...",
                            "criteria": {"approve_checkout": "...", "escalate_to_neon_swap": "...",
                                         "hard_block_quarantine": "..."}},     # 2-255 options
        "attack_severity": {"type": "score", "instructions": "...",
                            "criteria": ["0: ...", "1: ...", "2: ...", "3: ..."]},  # index = level
    },
    timeout=1.5,                         # seconds
)
```

Response (`CreateDecisionResponse`):

```jsonc
{ "answers": {
    "<probe_id>":      {"type": "noul",   "noul": 0.97, "confidence": 0.97},          // noul = P(true), in [0.01, 0.99]
    "firewall_action": {"type": "choice", "choice": "hard_block_quarantine", "confidence": 0.9,
                        "probabilities": {"approve_checkout": 0.02, "...": 0.0}},
    "attack_severity": {"type": "score",  "score": 2.7, "confidence": 0.8,            // score = expected level
                        "probabilities": {"0": 0.0, "1": 0.1, "2": 0.1, "3": 0.8}, "legend": {"0": "..."}}
  },
  "prompt_feedback": {"block_reason": "safety", "block_reason_message": "..."},       // set => no answers
  "usage": {} }
```

How we map it (`_parse_decisions_response`):
- probe p = `answers[id].noul`; `fired` = p ≥ the probe's threshold for the tier.
- `Verdict.action_probs` = `answers.firewall_action.probabilities` (all three actions required).
- `Verdict.severity` = `answers.attack_severity.score` rounded half-up (2.5 → 3).
- Fail closed if: `prompt_feedback.block_reason` is set, any sent question has no answer, a
  probability is missing, non-numeric or outside [0, 1], or the score is outside [0, 3].

To check when the docs arrive: the method name and `model` format, whether `resolution` is
accepted on image blocks, whether `timeout` is in seconds, the score/choice answer fields, and
the per-call question limit (we send up to 52).

## Gemini generate_content (firewall `json_llm` fallback and Argon perception)

**Status: written against `google-genai` 3.6.1, not yet run against the live API** (no key in
the build container).

```python
resp = await client.aio.models.generate_content(
    model=MODELS[...],
    contents=[types.Part.from_bytes(data=..., mime_type=...,
                                    media_resolution=types.PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH),
              "prompt text"],
    config=types.GenerateContentConfig(
        temperature=0, response_mime_type="application/json",
        response_json_schema={...},            # json_llm firewall
        # response_schema=Claims,              # Argon: pydantic model
        http_options=types.HttpOptions(timeout=<ms>)),
)
data = json.loads(resp.text)
```

- json_llm firewall uses `MODELS["firewall"]`. When switching to `FIREWALL_BACKEND=json_llm`,
  also set `MODEL_FIREWALL` to a fast generate-content model in `.env`.
- Response JSON for json_llm: `{"probes": {id: p}, "firewall_action": {action: p}, "attack_severity": 0-3}`.
