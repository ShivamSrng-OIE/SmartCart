import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { WifiOff } from "lucide-react";
import { ALL_VIEWS, Header, MODES, type View } from "./components/Header";
import { HomePage } from "./components/Home";
import { ShopYourself } from "./components/ShopYourself";
import type { CatalogProduct } from "./catalog";
import type { RouteDecision } from "./lib/router";
import { parseIntent } from "./lib/intent";
import { useBackend } from "./hooks/useBackend";
import { useTheme } from "./hooks/useTheme";
import { useCart } from "./hooks/useCart";
import { useDraft } from "./draft";
import { gsap, useGSAP, d } from "./lib/motion";

// Secondary pages load on demand so the first screen stays light.
const ProductPage = lazy(() => import("./components/ProductPage").then((m) => ({ default: m.ProductPage })));
const AgentPage = lazy(() => import("./components/AgentPage").then((m) => ({ default: m.AgentPage })));
const Arena = lazy(() => import("./components/Arena").then((m) => ({ default: m.Arena })));
const RedTeam = lazy(() => import("./components/RedTeam").then((m) => ({ default: m.RedTeam })));
const Scoreboard = lazy(() => import("./components/Scoreboard").then((m) => ({ default: m.Scoreboard })));

const AGENT_VIEWS: View[] = ["unprotected", "protected", "compare"];

function PageLoading() {
  return <div className="card h-64 animate-pulse" aria-label="Loading" />;
}

function parseHash(): { view: View; productId: string | null } {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h.startsWith("product/")) {
    const id = decodeURIComponent(h.slice("product/".length));
    return id ? { view: "product", productId: id } : { view: "shop", productId: null };
  }
  return { view: ALL_VIEWS.includes(h as View) && h !== "product" ? (h as View) : "home", productId: null };
}

export default function App() {
  const { theme, toggle } = useTheme();
  const backend = useBackend();
  const cart = useCart();
  const { set: setDraft } = useDraft();
  const [view, setView] = useState<View>(() => parseHash().view);
  const [productId, setProductId] = useState<string | null>(() => parseHash().productId);
  const [productSeed, setProductSeed] = useState<CatalogProduct | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [shopQuery, setShopQuery] = useState("");
  const [cartTick, setCartTick] = useState(0);

  const go = useCallback((v: View) => {
    setView(v);
    if (window.location.hash !== `#/${v}`) window.history.pushState(null, "", `#/${v}`);
    window.scrollTo({ top: 0 });
  }, []);

  const openProduct = useCallback((p: CatalogProduct) => {
    setProductSeed(p);
    setProductId(p.id);
    setView("product");
    window.history.pushState(null, "", `#/product/${encodeURIComponent(p.id)}`);
    window.scrollTo({ top: 0 });
  }, []);

  // Browser back/forward walks between pages.
  useEffect(() => {
    const onPop = () => {
      const r = parseHash();
      setView(r.view);
      setProductId(r.productId);
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);

  // 1 / 2 / 3 jump between the three modes when you're not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      const m = MODES.find((x) => x.key === e.key);
      if (m) go(m.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  useEffect(() => {
    const titles: Record<View, string> = {
      home: "Tote",
      product: productSeed?.title ? `${productSeed.title} · Tote` : "Product · Tote",
      shop: "Shop · Tote",
      unprotected: "Assistant · Tote",
      protected: "Safe Checkout · Tote",
      compare: "Compare · Tote",
      redteam: "Safety updates · Tote",
      results: "Performance · Tote",
    };
    document.title = titles[view];
  }, [view, productSeed?.title]);

  useGSAP(
    () => {
      const kids = mainRef.current?.querySelectorAll(":scope > div > *");
      if (!kids?.length) return;
      gsap.fromTo(kids, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: d(0.5), stagger: 0.05, ease: "power3.out", clearProps: "transform,opacity" });
    },
    { dependencies: [view], scope: mainRef },
  );

  const showOffline = backend.mode === "live" && backend.online === false && AGENT_VIEWS.includes(view);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Header
        view={view}
        onView={go}
        theme={theme}
        onTheme={toggle}
        cartCount={cart.count}
        onCart={() => {
          go("shop");
          setCartTick((t) => t + 1);
        }}
      />
      {showOffline && (
        <div className="border-b border-warn-line bg-warn-soft">
          <div className="mx-auto flex max-w-[2400px] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-5 xl:px-8">
            <p className="flex items-center gap-2 text-[13px] text-warn">
              <WifiOff className="size-4 shrink-0" />
              <span>
                <span className="font-semibold">The assistant is temporarily unavailable.</span> Please try again in a moment.
              </span>
            </p>
            <div className="flex items-center gap-1.5">
              <button onClick={backend.refresh} className="btn-primary h-7 rounded-md px-2.5 text-xs font-medium">
                Try again
              </button>
            </div>
          </div>
        </div>
      )}
      <main id="main" ref={mainRef} className="mx-auto w-full max-w-[2400px] px-3 pt-4 pb-28 sm:px-5 sm:pt-6 md:pb-8 xl:px-8 short:pt-3 short:pb-6">
        <div key={view} className="flex flex-col gap-4">
          <Suspense fallback={<PageLoading />}>
          {view === "home" && (
            <HomePage
              onView={go}
              onOpenProduct={openProduct}
              onRoute={(d: RouteDecision) => {
                if (d.route === "shop") {
                  setShopQuery(d.text);
                  go("shop");
                  return;
                }
                const intent = parseIntent(d.text, "");
                setDraft({ request: d.text, budget: intent.budget != null ? String(intent.budget) : "", product: null, scenarioId: null, media: {} });
                go(d.route === "safe" ? "protected" : "unprotected");
              }}
              onSearch={(q) => {
                setShopQuery(q);
                go("shop");
              }}
            />
          )}
          {view === "shop" && (
            <ShopYourself
              openCartTick={cartTick}
              initialQuery={shopQuery}
              mode={backend.mode}
              cart={cart}
              onOpenProduct={openProduct}
              onAskAI={(ref) => {
                setDraft({ product: ref, scenarioId: null });
                go("unprotected");
              }}
            />
          )}
          {view === "product" && productId && (
            <ProductPage
              key={productId}
              id={productId}
              seed={productSeed?.id === productId ? productSeed : null}
              cart={cart}
              onBack={() => (window.history.length > 1 ? window.history.back() : go("shop"))}
              onOpen={openProduct}
              onAskAssistant={(ref) => {
                setDraft({ product: ref, scenarioId: null });
                go("unprotected");
              }}
            />
          )}
          {view === "unprotected" && (
            <AgentPage kind="unprotected" mode={backend.mode} rules={backend.rules} onOtherMode={() => go("protected")} />
          )}
          {view === "protected" && (
            <AgentPage kind="protected" mode={backend.mode} rules={backend.rules} onOtherMode={() => go("unprotected")} />
          )}
          {view === "compare" && <Arena mode={backend.mode} rules={backend.rules} />}
          {view === "redteam" && <RedTeam mode={backend.mode} rulesVersion={backend.rules.version} onPatched={backend.bumpRules} />}
          {view === "results" && <Scoreboard results={backend.evalResults} />}
          </Suspense>
        </div>
      </main>
    </div>
  );
}
