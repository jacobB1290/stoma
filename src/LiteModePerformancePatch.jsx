// Professional Lite UI – Ultra‑Low‑Power Edition  (2025‑07‑22)
// ▸ Kills ALL motion, GPU effects, and rAF loops
// ▸ Solid high‑contrast skin
// ▸ Forces "Add Case Card" to stay small, inline, non‑sticky
// ▸ Alt + Shift + L toggles Lite mode everywhere

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { MotionConfig } from "framer-motion";

const LiteCtx = createContext({ lite: false, toggle: () => {} });
export const useLiteMode = () => useContext(LiteCtx);

/* ───────────────────────────── CSS injection ──────────────────────────── */
function injectUltraLiteCSS() {
  if (document.getElementById("ultra-lite-css")) return;

  const css = String.raw`
  /*** DESIGN TOKENS ************************************************************/
  :root {
    --lite-bg-primary:#fff;
    --lite-bg-secondary:#f8fafc;
    --lite-bg-elevated:#fff;
    --lite-bg-hover:#f8fafc;
    --lite-bg-active:#e2e8f0;
  
    --lite-border-subtle:rgba(0,0,0,0.06);
    --lite-border-default:rgba(0,0,0,0.09);
  
    --lite-text-primary:#0f172a;
  
    --lite-shadow-sm:0 1px 2px rgba(0,0,0,0.05);
  }
  
  /*** GLOBAL PERFORMANCE OVERRIDES ********************************************/
  html.lite,html.lite *{
    animation:none!important;
    transition:none!important;
    transform:none!important;
    will-change:auto!important;
    filter:none!important;
    backdrop-filter:none!important;
    mix-blend-mode:normal!important;
  }
  
  /*** "ADD CASE CARD" – lock in flow, kill zoom / sticky **********************/
  html.lite .add-case-card,
  html.lite [data-add-case]{
    position:static!important;
    top:auto!important;
    left:auto!important;
    right:auto!important;
    bottom:auto!important;
    z-index:auto!important;
  
    width:auto!important;
    max-width:260px!important;
    height:auto!important;
    padding:8px 16px!important;
  
    transform:none!important;
    scale:1!important;
  
    background:var(--lite-bg-elevated)!important;
    border:1px solid var(--lite-border-default)!important;
    border-radius:12px!important;
    box-shadow:var(--lite-shadow-sm)!important;
    cursor:pointer;
  }
  
  /*** DE‑STICKY ANYTHING SIMILAR **********************************************/
  html.lite .sticky,
  html.lite [class*="sticky"]{
    position:static!important;
    top:auto!important;
    left:auto!important;
    right:auto!important;
  }
  
  /*** PRESERVE SETTINGS BUTTON POSITION ***************************************/
  /* Settings button should remain fixed */
  html.lite .settings-button,
  html.lite button[aria-label*="settings"],
  html.lite button[aria-label*="Settings"],
  html.lite .fixed:has(svg[class*="gear"]),
  html.lite .fixed:has(svg[class*="settings"]),
  html.lite .fixed.bottom-4.right-4,
  html.lite .fixed.bottom-6.right-6 {
    position:fixed!important;
    bottom:1.5rem!important;
    right:1.5rem!important;
    z-index:50!important;
  }
  
  /*** GLASS ➜ SOLID ************************************************************/
  html.lite .glass,
  html.lite .glass-nb,
  html.lite [class*="backdrop-blur"]{
    background:var(--lite-bg-elevated)!important;
    border:1px solid var(--lite-border-default)!important;
    box-shadow:var(--lite-shadow-sm)!important;
  }
  
  /*** TRANSLUCENT / SHADOW CLASSES ➜ SIMPLE ***********************************/
  html.lite [class*="bg-white/"],
  html.lite [class*="bg-black/"],
  html.lite .shadow,
  html.lite .shadow-*{
    background:var(--lite-bg-primary)!important;
    border:1px solid var(--lite-border-subtle)!important;
    box-shadow:var(--lite-shadow-sm)!important;
  }
  
  /*** OPACITY RESET ************************************************************/
  html.lite [class*="opacity-"]{opacity:1!important;}
  html.lite svg{opacity:1!important;}
  
  /*** NO SMOOTH‑SCROLL & THIN BAR **********************************************/
  html.lite{scroll-behavior:auto!important;scrollbar-width:thin;scrollbar-color:var(--lite-border-default) var(--lite-bg-secondary);}
  html.lite::-webkit-scrollbar{width:8px;height:8px;}
  html.lite::-webkit-scrollbar-track{background:var(--lite-bg-secondary);}
  html.lite::-webkit-scrollbar-thumb{background:var(--lite-border-default);border-radius:4px;}
    `;
  const style = document.createElement("style");
  style.id = "ultra-lite-css";
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);
}

/* ───────────── Throttle requestAnimationFrame (10 fps) ──────────────── */
let originalRAF = null;
function patchRAF(enable) {
  if (enable && !originalRAF) {
    originalRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) =>
      setTimeout(() => cb(performance.now()), 100);
  } else if (!enable && originalRAF) {
    window.requestAnimationFrame = originalRAF;
    originalRAF = null;
  }
}

/* ─────────────────────────── provider ───────────────────────────────── */
export function LiteModeProvider({ children }) {
  const [lite, setLite] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("lite-ui") ?? "false");
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (lite) {
      injectUltraLiteCSS();
      document.documentElement.classList.add("lite");
      patchRAF(true);
    } else {
      document.documentElement.classList.remove("lite");
      patchRAF(false);
    }
    try {
      localStorage.setItem("lite-ui", JSON.stringify(lite));
    } catch {}
  }, [lite]);

  const toggle = useCallback(() => setLite((v) => !v), []);

  /* Alt+Shift+L quick toggle with mini‑toast */
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === "l") {
        const isCurrentlyLite =
          document.documentElement.classList.contains("lite");
        toggle();

        // Create toast notification
        const t = document.createElement("div");
        t.textContent = `Lite Mode ${isCurrentlyLite ? "OFF" : "ON"}`;
        t.style.cssText =
          "position:fixed;top:20px;right:20px;padding:8px 16px;background:#3b82f6;color:#fff;border-radius:8px;font-weight:600;z-index:9999;opacity:0;transition:opacity .2s ease;pointer-events:none;";
        document.body.appendChild(t);

        // Force reflow then show
        t.offsetHeight;
        t.style.opacity = "1";

        setTimeout(() => (t.style.opacity = "0"), 1500);
        setTimeout(() => t.remove(), 2000);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <LiteCtx.Provider value={{ lite, toggle }}>
      <MotionConfig reducedMotion={lite ? "always" : "user"}>
        {children}
      </MotionConfig>
    </LiteCtx.Provider>
  );
}
