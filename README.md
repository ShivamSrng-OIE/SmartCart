# CartTrap arena (frontend)

The live arena for CartTrap: an unprotected Hydrogen shopper and the same shopper behind CartTrap's firewall get the same request and the same poisoned media, side by side. It shows the hijacked call, the firewall verdict with all ~50 probe lights, the "why is it fraud?" card with Dollars Defended and a safe Shopify cart, the self-healing red-team loop, and the eval scoreboard.

Vite + React + TypeScript + Tailwind v4, GSAP for motion, vitest for the event reducer. Light and dark themes, phone to 1920px projector.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api, /media, /health to :8000
npm test           # reducer tests (vitest)
npm run build      # type-check + production build into dist/
```

On Windows, run vitest from a path with an uppercase drive letter (`E:\CartTrap`). A lowercase `e:` makes vitest load its runner twice and every suite fails.

No backend? The app notices `/health` is down and switches to **Replay**, which plays recorded runs from `src/fixtures/`. The Live/Replay switch in the header flips it by hand, which is the offline fallback for the venue.

## Screens

| Screen | Key | What it's for |
|---|---|---|
| Arena | `1` | Scenario presets, webcam + Snap, push-to-talk request, budget, product picker, untrusted media. Both agents stream side by side; the firewall verdict, seismograph and fraud card react live. `Ctrl/⌘ + Enter` runs. |
| Catalog | `2` | Search products, filter by price, open a listing (the "truth ledger") and send it to the Arena. `/` focuses search. |
| Red team | `3` | Launch the self-healing loop: attack → block → mutate → bypass → Neon diagnoses → new probe → validation → rules v+1 → re-blocked. |
| Scoreboard | `4` | Baseline vs prompt-hardened vs CartTrap from the latest results file, failures, and freeze provenance. |

## API the UI consumes

Routes follow `docs/architecture.md` §5 on the `dev` branch. Every one has a fallback, so a missing endpoint never blanks the stage.

| Route | Used by | If it's missing |
|---|---|---|
| `GET /health` → `{ok: true}` | Live/Replay switch | Switches to Replay and shows a "backend not reachable" bar in Live |
| `POST /api/run` multipart: `request`, `budget?`, `product_url?`, `demo_product_id?`, `image?`, `audio?`, `video?`, `pdf?`, `mode=both` → `{run_id}` | Arena Run | Error bar with "Use the recorded run" |
| `GET /api/runs/{id}/stream` (SSE, `data: <TraceEvent>`) | Arena, Red team | Same as above; reconnects are safe because the bus replays from the start |
| `GET /api/rules` → `{version, probes}` | Seismograph lights | Bundled sample rule set, tagged "sample" |
| `GET /api/eval/latest` → `{systems: {baseline, hardened, carttrap}: Metrics, meta?, failures?}` | Scoreboard | Bundled sample numbers with a "Sample numbers · not a real run" badge |
| `POST /api/redteam/launch` `{product_id?, rounds}` → `{run_id}` | Red team | "Play the recorded heal" |
| **Proposed:** `GET /api/catalog/search?q=&max_price=&limit=` → `{products: [...]}` | Catalog, product picker | Searches the bundled demo catalog and says so |
| **Proposed:** `GET /api/catalog/products/{id}` → `get_product` JSON | Catalog detail | Demo catalog entry |

The two catalog routes are thin wrappers over Shop MCP `search_catalog` / `get_product`. Raw Shop MCP items are fine because `src/catalog.ts` normalizes them.

### Event shapes

`TraceEvent` matches `backend/schemas.py`: `{run_id, pane: victim|guarded|redteam, t_ms, kind, data}`.

- `tool_call` `{name, arguments, source?}`. `source: "neon"` marks the defender's safe-swap calls so they aren't shown as waiting on the firewall.
- `tool_result` `{name, result}`, attached to the latest unanswered call of the same name. `get_product` results feed the price ledger.
- `intercepted` `{tool, arguments, hijacked?}`. The victim is marked **hijacked** if `hijacked` is true, or the call breaks the Request box intent (quantity ≠ asked, total > budget, or any spend request).
- `verdict` = `Verdict`. If `error` is set, the UI shows "Failed closed".
- `fraud_card` = `FraudCard`. `safe_cart.continue_url` is opened exactly as returned (ADR m4/0008).
- `log` `{source?: argon|hydrogen|neon|carttrap, message}`
- `done`. The stream closes after the guarded (or red-team) pane's `done`.

Red-team rounds are `log` events on `pane: "redteam"` with `data.stage` set to one of `launch, attack, blocked, mutate, bypass, diagnose, probe_proposed, validate, patched, reblocked`. Useful fields are `round`, `payload`, `latency_ms`, `top_probe {id, p}`, `approve_p`, `probe` (a `rules.json` entry), `exploit {p, fired}`, `benign [{id, p}]` and `rules_version_from/_to`. `src/fixtures/redteam_demo.jsonl` is a full example.

## Where things live

```
src/
  state.ts             pure reducer: TraceEvent → ArenaState (tested in state.test.ts)
  api.ts               live routes, SSE, normalizers, fixture replay
  catalog.ts           product search/detail with demo fallback
  config.ts            scenarios and demo SKUs (swap in real product IDs at the venue)
  components/          Arena, InputBar, ProductPicker, TracePane, Seismograph, VerdictBanner,
                       FraudCard, SafeCart, Catalog, RedTeam, Scoreboard, Header, ui
  fixtures/            recorded runs, sample rules, sample eval, demo catalog
```

## Design notes

- Shopify-admin look: gray canvas, white cards, near-black primary buttons, one brand green. Red only means hijack or block, green means safe, amber means escalate.
- Trusted vs untrusted is visible: only the Request box and budget count as intent; every image, clip and PDF is labelled untrusted.
- Motion is GSAP and short. It respects `prefers-reduced-motion`.
- No merchant images are committed; product images are hot-linked when the catalog returns them.
