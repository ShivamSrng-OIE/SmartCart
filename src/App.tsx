import { useCallback, useEffect, useRef, useState } from "react";
import { Header, VIEWS, type View } from "./components/Header";
import { Arena } from "./components/Arena";
import { RedTeam } from "./components/RedTeam";
import { Scoreboard } from "./components/Scoreboard";
import { Catalog } from "./components/Catalog";
import { findDemo, refFromProduct, type ProductRef } from "./catalog";
import { SCENARIOS } from "./config";
import { useBackend } from "./hooks/useBackend";
import { useTheme } from "./hooks/useTheme";
import { gsap, useGSAP, d } from "./lib/motion";
import { WifiOff } from "lucide-react";

function viewFromHash(): View {
  const h = window.location.hash.replace(/^#\/?/, "");
  return (VIEWS.find((v) => v.id === h)?.id ?? "arena") as View;
}

export default function App() {
  const { theme, toggle } = useTheme();
  const backend = useBackend();
  const [view, setView] = useState<View>(viewFromHash);
  const mainRef = useRef<HTMLElement>(null);
  const [product, setProduct] = useState<ProductRef | null>(() => {
    const p = findDemo(SCENARIOS[0].productId);
    return p ? refFromProduct(p) : null;
  });

  const go = useCallback((v: View) => {
    setView(v);
    if (window.location.hash !== `#/${v}`) window.history.replaceState(null, "", `#/${v}`);
  }, []);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // 1-4 switch views when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      const v = VIEWS.find((x) => x.key === e.key);
      if (v) go(v.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // Page intro once, then a short rise on every view change.
  useGSAP(
    () => {
      const kids = mainRef.current?.querySelectorAll(":scope > div > *");
      if (!kids?.length) return;
      gsap.fromTo(kids, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: d(0.55), stagger: 0.06, ease: "power3.out", clearProps: "transform,opacity" });
    },
    { dependencies: [view], scope: mainRef },
  );

  return (
    <div className="min-h-dvh">
      <Header view={view} onView={go} theme={theme} onTheme={toggle} mode={backend.mode} online={backend.online} onMode={backend.setMode} />
      {backend.mode === "live" && backend.online === false && (
        <div className="border-b border-warn-line bg-warn-soft">
          <div className="mx-auto flex max-w-[1920px] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-5">
            <p className="flex items-center gap-2 text-[13px] text-warn">
              <WifiOff className="size-4 shrink-0" />
              <span>
                <span className="font-semibold">Backend not reachable.</span> Live runs need the API on localhost:8000.
              </span>
            </p>
            <div className="flex items-center gap-1.5">
              <button onClick={backend.refresh} className="btn-secondary h-7 rounded-md px-2.5 text-xs font-medium">
                Retry
              </button>
              <button onClick={() => backend.setMode("replay")} className="btn-primary h-7 rounded-md px-2.5 text-xs font-medium">
                Use recorded runs
              </button>
            </div>
          </div>
        </div>
      )}
      <main ref={mainRef} className="mx-auto w-full max-w-[1920px] px-3 pt-3 pb-24 sm:px-5 sm:pt-5 md:pb-5">
        <div key={view} className={view === "arena" ? "" : "flex flex-col gap-4"}>
          {view === "arena" && (
            <Arena mode={backend.mode} rules={backend.rules} rulesLive={backend.rulesSource === "live"} onSwitchToReplay={() => backend.setMode("replay")} product={product} onProduct={setProduct} />
          )}
          {view === "catalog" && (
            <Catalog
              mode={backend.mode}
              onTest={(ref) => {
                setProduct(ref);
                go("arena");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          )}
          {view === "redteam" && <RedTeam mode={backend.mode} rulesVersion={backend.rules.version} onPatched={backend.bumpRules} onSwitchToReplay={() => backend.setMode("replay")} />}
          {view === "scoreboard" && <Scoreboard results={backend.evalResults} source={backend.evalSource} />}
        </div>
      </main>
    </div>
  );
}
