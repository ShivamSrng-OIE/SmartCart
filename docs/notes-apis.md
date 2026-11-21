# API notes (verified call shapes)

Every real API call lives in one private function so the rest of the app never depends on SDK
details. Model IDs come from `backend/config.py` only.

| Role | Model ID | API | Our function |
|---|---|---|---|
| firewall | `gemini-decision-1` | Decisions API (v1beta) | `firewall_decisions._call_decisions` |
| firewall fallback (`FIREWALL_BACKEND=json_llm`) | `config.FIREWALL_JSON_LLM_MODEL` (default `gemini-4-argon`) | Interactions API | `firewall_decisions._call_json_llm` |
| perception (Argon) | `gemini-4-argon` | Interactions API | `perception_argon._call_argon` |
| victim (Hydrogen) | `gemini-4-hydrogen` | | |
| defender (Neon) | `gemini-4-neon` | | |
| red team (Carbon) | `gemini-4-carbon` | | |
| image generation | `gemini-nano-banana-2.1` | | |

## Decisions API (firewall)

**Source: the official Decisions API guide (shape supplied by the team, Nov 21).** Matches the
types in the installed SDK, `google-genai` 3.6.1.

```python
from google import genai
beta_client = genai.Client(http_options={"api_version": "v1beta"})
decision = beta_client.decisions.create(
    model=config.MODELS["firewall"],   # "gemini-decision-1"
    input=[
        {"type": "image", "data": <base64>, "mime_type": "image/jpeg", "resolution": "ultra_high"},
        {"type": "audio", "data": <base64>, "mime_type": "audio/wav"},
        {"type": "document", "data": <base64>, "mime_type": "application/pdf"},
        {"type": "text", "text": "USER_INTENT:\n...\n\nSHOP_PRODUCT_JSON:\n...\n\nPROPOSED_TOOL_CALL:\n...\n\nCLAIMS (untrusted data):\n...\n"},
    ],
    questions={
        "<probe_id>": {"type": "noul", "instructions": "..."},
        "firewall_action": {"type": "choice", "instructions": "...",
            "criteria": {"approve_checkout": "...", "escalate_to_neon_swap": "...", "hard_block_quarantine": "..."}},
        "attack_severity": {"type": "score", "instructions": "...",
            "criteria": ["none", "low", "medium", "severe"]},
    },
)
```

Facts from the guide:
- The image field is `resolution` (`low | medium | high | ultra_high`), **not** `media_resolution`.
  Video blocks also take `resolution`. PDFs use `type: "document"`.
- Adjacent text blocks are joined with **no separator**, so put newlines between sections.
- Question keys must match `[A-Za-z0-9_-]+`, 1 to 64 characters.
- Response: `decision.answers[key].noul` = P(yes), from 0.01 to 0.99.
  `decision.answers["firewall_action"].probabilities["approve_checkout"]`.
  `decision.answers["attack_severity"].score` is the probability-weighted level index (0 to 3): use `round()`.
- A safety block comes back as **HTTP 400 with an error object** instead of answers.
- If there is no async method, use `asyncio.to_thread` inside `asyncio.wait_for`.

How we use it (`backend/firewall_decisions.py`):
- The SDK has the async method, so the call is
  `await gemini.beta_client().aio.decisions.create(model=..., input=..., questions=..., timeout=remaining_s)`
  inside `asyncio.wait_for(..., remaining_s)`. The whole `decide()` is bounded by
  `THRESHOLDS["firewall_timeout_ms"]` (1500 ms). The SDK retries 408/409/429/5xx with backoff
  on its own, and `wait_for` cuts that off at the deadline.
- `input` = one block per media file (images at `resolution: "ultra_high"`), then **one** text
  block. Its sections are separated by blank lines and it ends with `\n`. CLAIMS are wrapped
  as `<<<UNTRUSTED_CLAIMS ... UNTRUSTED_CLAIMS>>>`.
- `questions` = one `noul` question per active probe (no `pack_lie` probes when there is no
  product), plus `firewall_action` and `attack_severity`. That is 52 questions with the seed
  rules, or 44 without a product.
- Probe ids are checked against `[A-Za-z0-9_-]{1,64}` in two places. `RuleSet` rejects a bad id
  (so `RuleStore.append` raises and a bad hand edit keeps the last good rules), and the
  firewall checks again before sending.
- Parsing reads SDK objects or plain dicts. Probe p = `.noul`; `action_probs` =
  `firewall_action.probabilities` (all three actions required); `severity` = `round(score)`.
- **Fail closed** (`hard_block_quarantine`, `Verdict.error` set) on: timeout, any exception
  (including the SDK's `GenAiDefaultError` for HTTP 400 safety blocks), a missing answer for any
  question sent, a missing or out-of-range probability, a score outside 0 to 3, or
  `prompt_feedback.block_reason` being set.

## Interactions API (Argon perception, json_llm firewall fallback)

**Source: the team's notes from the guide** (`client.interactions.create(model=..., input=[...],
generation_config={"thinking_level": "high"})`, text in `.output_text`). `system_instruction`
and `response_format` are not in the guide snippet. They come from the typed parameters of the
installed SDK (google-genai 3.6.1) and are **not yet verified live**.

```python
resp = await client.aio.interactions.create(
    model=config.MODELS["perception"],                  # Argon
    system_instruction=<backend/prompts/argon.md>,     # Argon only
    input=[{"type": "image", "data": <base64>, "mime_type": "image/png", "resolution": "ultra_high"},
           {"type": "text", "text": "...\n"}],
    response_format={"type": "text", "mime_type": "application/json", "schema": <JSON schema>},
    generation_config={"thinking_level": "low"},       # "minimal" for the json_llm firewall
    timeout=<seconds>,                                  # json_llm firewall only
)
data = json.loads(resp.output_text)                     # a ```json fence is stripped first
```

- No `tools` are ever passed (Argon must have none; the firewall needs none).
- Argon's schema is `Claims.model_json_schema()`. The json_llm schema is
  `{"probes": {id: number 0-1}, "firewall_action": {action: number 0-1}, "attack_severity": int 0-3}`.
- Empty `output_text` or invalid JSON: the firewall fails closed, and Argon returns empty `Claims`
  with `notes="perception_error"`.
- `FIREWALL_JSON_LLM_MODEL` is a separate config value (env `MODEL_FIREWALL_JSON_LLM`), because
  `gemini-decision-1` only serves the Decisions API. It defaults to Argon's model; switch it if
  another Gemini 4 model turns out faster.

## Not yet verified live

There was no API key in the build container, so none of these calls has run against the real
API. Run `uv run pytest -m live` with `GEMINI_API_KEY` set and the golden images in
`eval/golden/`.
