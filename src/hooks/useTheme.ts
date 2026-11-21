import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "carttrap.theme";

function current(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(current);

  const apply = useCallback((t: Theme) => {
    const root = document.documentElement;
    root.classList.add("theme-anim");
    root.dataset.theme = t;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", t === "dark" ? "#0e0e0d" : "#f6f5f2"));
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* private mode */
    }
    window.setTimeout(() => root.classList.remove("theme-anim"), 320);
    setThemeState(t);
  }, []);

  // Follow the OS only while the user hasn't picked a theme.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(KEY);
      } catch {
        /* ignore */
      }
      if (!saved) apply(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [apply]);

  const toggle = useCallback(() => apply(current() === "dark" ? "light" : "dark"), [apply]);
  return { theme, toggle };
}
