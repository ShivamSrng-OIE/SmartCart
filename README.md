# CartTrap (frontend)

Can an AI shopping agent be tricked into buying the wrong thing? CartTrap's site lets you try it three ways on real Shopify products:

| Mode | Key | What happens |
|---|---|---|
| **1 · Shop yourself** | `1` | Search Shopify (live), open listings, build a cart, check out on each store's own site. No AI. |
| **2 · AI shopper** | `2` | An AI agent (Gemini) gets your request and a photo, then shops. A note hidden in the photo can make it buy the wrong thing. |
| **3 · AI + CartTrap** | `3` | The same agent, but every purchase is checked first: the decision in ~0.2 s, 50 threat checks, why it was stopped, money saved, and a safe option. |

Under **More**: *Side by side* (modes 2 and 3 at once, for a big screen), *Self-healing* (CartTrap learning a new check from an attack it missed) and *Results* (the 50-case eval).

Vite + React + TypeScript + Tailwind v4, GSAP for motion, vitest for the logic. Shopify-admin look, light and dark themes, phone to 1920 px.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 41 tests: event reducer, Gemini adapter, Shopify normalizer, request parsing
npm run build      # type-check + production build into dist/
```

On Windows, run vitest from a path with an uppercase drive letter (`E:\CartTrap`). A lowercase `e:` makes vitest load its runner twice and every suite fails.

## Plugging in the two AI shoppers (Gemini)

Modes 2 and 3 each call one HTTP endpoint on **your backend**, which calls Gemini server-side; the Gemini key never reaches the browser. Point them at your APIs in `.env.local` (see `.env.example`):

```bash
VITE_UNPROTECTED_RUN_URL=/api/run      # mode 2
VITE_UNPROTECTED_RUN_MODE=victim
VITE_PROTECTED_RUN_URL=/api/run        # mode 3
VITE_PROTECTED_RUN_MODE=guarded
VITE_STREAM_URL=/api/runs/{id}/stream
```

Both receive the same `multipart/form-data`: `request` (cleaned, ≤ 1000 chars), `budget?`, `product_id?`, `product_url?`, `image?`, `audio?`, `video?`, `pdf?`, and `mode`.

### Gemini-compatible responses

Your endpoint can answer in whichever shape is easiest. `src/lib/gemini.ts` turns all of these into steps on screen:

1. **`{ "run_id": "..." }`** and then Server-Sent Events at `VITE_STREAM_URL`, one event per `data:` line (the team contract below).
2. **A raw Gemini `generateContent` response**: `candidates[0].content.parts[]`, where `text` becomes a log line, `functionCall {name, args}` becomes a tool call and `functionResponse {name, response}` becomes its result. Thought parts are skipped; `SAFETY`/blocked finishes are shown. In mode 2, money-moving calls (`create_cart`, `create_checkout`, spend requests…) are shown as caught before they reached Shopify.
3. **A `streamGenerateContent` stream** (`text/event-stream` or NDJSON), chunk by chunk.
4. Any of the above with CartTrap extras next to `candidates`: `verdict`, `fraud_card`, `intercepted`, or `events: TraceEvent[]`.

If the API isn't reachable, the page says so and offers **Demo**, which plays scripted sample runs. Demo data is labelled "Demo data · scripted" everywhere it appears; it is not a recording of a real run.

## Shopify

Product search and details use **Shopify's Shop MCP** (`https://mcp.shop.com/`, per [shop.dev/docs](https://shop.dev/docs/tools.md)):

- The browser calls `/shop-mcp` on its own origin and the Vite dev/preview server forwards it (no CORS, no cookies or Origin header sent to Shopify). For a static deploy, add the same one-line proxy on your host.
- JSON-RPC 2.0 `tools/call` with protocol `2026-07-28`, matching `Mcp-Method` / `Mcp-Name` headers and the required `_meta`.
- `search_catalog` (with price filter in minor units and cursor pagination for **Show more**), `get_product`, and `create_checkout` (with an idempotency key) for the cart. **`complete_checkout` is never called**; the shopper finishes on the merchant's `continue_url`.
- Prices arrive in minor units and are converted per currency. Product and checkout links are used exactly as returned, never rebuilt or logged. Merchant descriptions are shown as plain text only. Shopify `warning` messages and `rate_limited` errors (with `retry_after`) are shown to the user.
- Type several items separated by commas (`cold brew, ceramic mug`) to search them all at once.

If a team backend route exists (`GET /api/catalog/search`, `GET /api/catalog/products/{id}`), it is used first. If neither it nor Shopify is reachable, search falls back to a small bundled demo catalog and says so.

## Team API contract

Routes follow `docs/architecture.md` §5 on the `dev` branch. Every one has a fallback, so a missing endpoint never blanks a page.

| Route | Used by | If it's missing |
|---|---|---|
| `GET /health` → `{ok: true}` | Live/Demo switch | Switches to Demo and explains why |
| `POST /api/run` (`mode=victim\|guarded\|both`) → `{run_id}` | Modes 2 and 3, Side by side | Error with "Use demo data instead" |
| `GET /api/runs/{id}/stream` (SSE) | same | same; reconnects are safe because the bus replays from the start |
| `GET /api/rules` → `{version, probes}` | The 50 checks | Bundled sample rule set, tagged "sample" |
| `GET /api/eval/latest` → `{systems: {baseline, hardened, carttrap}: Metrics, meta?, failures?}` | Results | Sample numbers with a "not a real run yet" badge |
| `POST /api/redteam/launch` `{product_id?, rounds}` → `{run_id}` | Self-healing | "Use demo data instead" |

`TraceEvent` matches `backend/schemas.py`: `{run_id, pane: victim|guarded|redteam, t_ms, kind, data}`. The full list of event kinds and the red-team `data.stage` values (`launch, attack, blocked, mutate, bypass, diagnose, probe_proposed, validate, patched, reblocked`) is in `src/state.ts` and `src/fixtures/redteam_demo.jsonl`.

## Where things live

```
src/
  App.tsx                 routing between Home, the three modes and More
  draft.tsx               the test you're building, shared by modes 2, 3 and Side by side
  api.ts                  agent runs (any response shape), SSE, rules, eval, demo replay
  lib/gemini.ts           Gemini response → steps
  shop.ts                 Shop MCP client (search, product, checkout)
  catalog.ts              search/detail with backend → Shopify → demo fallback
  lib/intent.ts           request parsing: budget, quantities, comma-separated items
  state.ts                pure reducer: events → page state
  config.ts               endpoints, scenarios, demo SKUs
  components/
    Home, ShopYourself, AgentPage, RequestPanel, ProductPicker,
    TracePane, VerdictBanner, Seismograph, FraudCard, SafeCart,
    Arena (side by side), RedTeam, Scoreboard, Header, ui
  fixtures/               scripted demo runs, sample rules, sample eval, demo catalog
```

## Design notes

- Shopify-admin look: gray canvas, white cards, near-black primary buttons, one brand green. Red only means "something went wrong / a trick was found", green means safe, amber means warning.
- Plain language first; model names appear as small tags.
- Trusted vs untrusted is explicit: only the request box and budget are instructions. Photos, audio and files are checked, never obeyed.
- Motion is GSAP and short, and respects `prefers-reduced-motion`. Secondary pages are code-split.
