# Tote web app

The storefront for CartTrap: Shop, Assistant, Safe Checkout, Compare, Sell (merchant portal), Marketplace trust, Models, Dataset and Performance. Vite, React 19, TypeScript and Tailwind v4. It talks to the backend API only over HTTP, so it deploys on its own.

## Run

```
npm install
npm run dev          # http://localhost:5173, proxies /api, /media, /health and /shop-mcp to http://localhost:8000
```

Start the API from `../backend` first (see its README).

## Build and deploy

```
VITE_API_URL=https://your-api.example npm run build     # static files in dist/
```

- `VITE_API_URL` is the API's origin with no trailing slash. Leave it empty in development.
- Routing uses the URL hash, so any static host works with no rewrite rules.
- The API must allow this app's origin in its `CORS_ORIGINS`.

## Checks

```
npx tsc -b --noEmit
npx vitest run       # on Windows, run from an uppercase drive path (E:\...)
```

## Layout

```
src/
  App.tsx, config.ts      routing between views; API base URL (apiUrl, assetUrl) and endpoints
  api.ts, shop.ts         the run/stream API and the Shopify proxy client
  catalog.ts              product search and detail: Shopify results with warehouse listings mixed in by trust
  lib/marketplace.ts      merchant sign-in and portal, trust, and model-settings API client
  hooks/useCartChecker.ts the check that runs when a warehouse listing is added to the cart
  components/             pages (Home, ShopYourself, ProductPage, Sell, Trust, Settings, Scoreboard, ...)
  fixtures/               recorded runs for rehearsal (VITE_DEMO_MODE=true on the dev server)
```

Nothing in this folder imports from `../backend`.
