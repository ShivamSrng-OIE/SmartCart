# CartTrap (frontend)

Can an AI shopping agent be tricked into buying the wrong thing? CartTrap's site lets you try it three ways on real Shopify products:

| Mode | Key | What happens |
|---|---|---|
| **Shop** | `1` | Live Shopify search and browse, full product pages (gallery, description, features, every store's offer, price comparison, similar items), cart and per-store checkout. |
| **Assistant** | `2` | An AI agent (Gemini) gets your request and a photo, then shops. A note hidden in the photo can make it put together the wrong order. |
| **Safe Checkout** | `3` | The same agent, but every order is verified first: the decision in ~0.2 s, 50 checks, why it was held, amount protected, and a suggested alternative. |

Under **More**: *Compare* (Assistant and Safe Checkout at once, for a big screen), *Safety updates* (a new check learned from a missed order) and *Performance* (the 50-case eval). The visible copy is deliberately neutral: it reads as an ordinary Shopify shopping site, so a wrong order from the Assistant shows up as a surprise.

Vite + React + TypeScript + Tailwind v4, GSAP for motion, vitest for the logic. Shopify-admin look, light and dark themes, phone to 1920 px.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 51 tests: event reducer, Gemini adapter, Shopify normalizer, request parsing, search router
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

If an API isn't reachable, the page says it's temporarily unavailable and offers **Try again**. Production never shows scripted runs, placeholder products or placeholder scores. For rehearsals, `VITE_DEMO_MODE=true` (dev server only, never in a build) plays the scripted runs in `src/fixtures/`.

## Landing search router (Gemini Decisions API)

The home search bar decides which page should handle what you typed: a product search goes to **Shop**, a task ("I have $30, buy anything nice") goes to the **Assistant** with the request and budget filled in, and a task that asks for verification goes to **Safe Checkout**.

The decision comes from your backend at `VITE_ROUTER_URL` (default `/api/route`), which asks the Gemini Decisions API one `choice` question:

```http
POST /api/route
{ "text": "I have $30, buy anything nice", "question": "Which page should handle this?",
  "choices": [ {"id": "shop", "description": "..."}, {"id": "assistant", "description": "..."}, {"id": "safe", "description": "..."} ] }
→ { "choice": "assistant", "probabilities": { "shop": 0.04, "assistant": 0.91, "safe": 0.05 } }
```

`{answers: {route: {choice, probabilities}}}` and `safe_checkout` are accepted too. If the route is missing, slow (> 1.2 s) or unreadable, local rules in `src/lib/router.ts` decide, and the page says "quick match" instead of "decided by Gemini Decisions".

Requests can be budget-only: "anything under $30", "I have $30, get something nice", or an empty box with a budget, which is sent as "Buy anything under $30".

## Shopify

Product search and details use **Shopify's Shop MCP** (`https://mcp.shop.com/`, per [shop.dev/docs](https://shop.dev/docs/tools.md)):

- The browser calls `/shop-mcp` on its own origin and the Vite dev/preview server forwards it (no CORS, no cookies or Origin header sent to Shopify). For a static deploy, add the same one-line proxy on your host.
- JSON-RPC 2.0 `tools/call` with protocol `2026-07-28`, matching `Mcp-Method` / `Mcp-Name` headers and the required `_meta`.
- `search_catalog` (query, price filter in minor units, `ships_to` + `available` filters, cursor pagination for **Show more**, and `like` for similar products), `get_product` (every store offer, media, metadata, policies), and `create_checkout` (with an idempotency key) for the cart.
- **Deliver to** (header) sets `address_country`, `currency` and `ships_to`; it is detected from the browser on first visit. Stores that only quote USD keep USD.
- Product photos load from Shopify's CDN at the size each slot needs (`width` + `srcset`), lazily, with a preconnect; repeat searches come from a 2-minute memory cache and identical in-flight requests are merged. **`complete_checkout` is never called**; the shopper finishes on the merchant's `continue_url`.
- Prices arrive in minor units and are converted per currency. Product and checkout links are used exactly as returned, never rebuilt or logged. Merchant descriptions are shown as plain text only. Shopify `warning` messages and `rate_limited` errors (with `retry_after`) are shown to the user.
- Type several items separated by commas (`cold brew, ceramic mug`) to search them all at once.

If a team backend route exists (`GET /api/catalog/search`, `GET /api/catalog/products/{id}`), it is used first. If neither it nor Shopify is reachable, the page shows "Couldn't reach Shopify" with a retry.

## Team API contract

Routes follow `docs/architecture.md` §5 on the `dev` branch. Every one has a fallback, so a missing endpoint never blanks a page.

| Route | Used by | If it's missing |
|---|---|---|
| `GET /health` → `{ok: true}` (`VITE_HEALTH_URL`) | Assistant pages | "Temporarily unavailable" banner with Try again |
| `POST /api/run` (`mode=victim\|guarded\|both`) → `{run_id}` | Assistant, Safe Checkout, Compare | "The assistant didn't respond" with Try again |
| `GET /api/runs/{id}/stream` (SSE) | same | same; reconnects are safe because the bus replays from the start |
| `GET /api/rules` → `{version, probes}` | The 50 checks | The default rule set shipped with the site |
| `GET /api/eval/latest` → `{systems: {baseline, hardened, carttrap}: Metrics, meta?, failures?}` | Performance | "Results will appear here after the next evaluation run" |
| `POST /api/redteam/launch` `{product_id?, rounds}` → `{run_id}` | Safety updates | "Couldn't start a test run" with Try again |

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
