/**
 * LiteModePerformancePatch.jsx  –  Stomaboard Lite Mode v3
 * ─────────────────────────────────────────────────────────
 * Designed for low-power hardware (Raspberry Pi, cheap Windows PCs).
 *
 * Philosophy: animations are FINE – they run on the CPU/JS side and
 * are cheap.  What kills a Pi is the GPU compositing pipeline:
 *   • backdrop-filter (blur/saturate)  → forces a separate GPU layer
 *   • filter (brightness on .glow)     → triggers full repaint + composite
 *   • mix-blend-mode                   → requires extra compositing pass
 *   • will-change: transform/opacity   → pre-promotes elements to GPU layers
 *   • translucent bg-white/* colours  → alpha compositing on every paint
 *
 * So Lite Mode ONLY removes those compositor costs.
 * Framer-motion springs, AnimatePresence, layout animations, the
 * glow/pulse-red flash effects, and all CSS transitions run at full
 * speed exactly as on a normal machine.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { MotionConfig } from "framer-motion";

/* ─────────────────────────── Context ─────────────────────────────── */
const LiteCtx = createContext({ lite: false, toggle: () => {} });
export const useLiteMode = () => useContext(LiteCtx);

/* ─────────────────────── CSS override sheet ──────────────────────── */
const STYLE_ID = "stomaboard-lite-css-v3";

function injectLiteCSS() {
  if (document.getElementById(STYLE_ID)) return;

  const css = /* css */ `
/* ═══════════════════════════════════════════════════════════════════
   STOMABOARD LITE MODE  –  GPU compositor override sheet
   Applied when <html> carries the class "lite".
   Target: remove expensive GPU layers only.
   Animations, transitions, and framer-motion run normally.
   ═══════════════════════════════════════════════════════════════════ */

/* ── 1. Kill backdrop-filter everywhere ────────────────────────────
   backdrop-filter: blur() is the single most expensive effect on Pi.
   Every element with it gets promoted to its own GPU layer and the
   compositor must re-render it on every frame.  Remove it entirely.  */
html.lite *,
html.lite *::before,
html.lite *::after {
  backdrop-filter:         none !important;
  -webkit-backdrop-filter: none !important;
}

/* ── 2. Remove filter (used by .glow brightness effect) ────────────
   filter: brightness() on .glow forces a full GPU repaint per frame.
   The .glow CSS animation still runs (the class is still there and
   the keyframe fires) but without the filter cost it is just a no-op
   paint – cheap.  The ring colour/border on the card still shows     */
html.lite * {
  filter: none !important;
}

/* ── 3. Clear will-change promotions ───────────────────────────────
   will-change: transform/opacity pre-promotes elements to GPU layers
   before any animation even starts.  On Pi that burns VRAM for every
   card on screen.  Reset to auto so promotion only happens when the
   browser actually needs it (i.e. during an active animation).       */
html.lite * {
  will-change: auto !important;
}

/* ── 4. Remove mix-blend-mode ──────────────────────────────────────
   mix-blend-mode: color (used by .pulse-red::after overlay) requires
   an extra compositing pass.  The pulse animation itself still runs
   but the colour-blend layer is removed; the element is still visible
   and animated, just without the blend overhead.                     */
html.lite * {
  mix-blend-mode: normal !important;
}

/* ── 5. Glass / blur panels → solid opaque surface ─────────────────
   .glass and .glass-nb rely entirely on backdrop-filter (killed above)
   for their frosted look.  Without the filter they show transparent,
   so give them a solid background that keeps the UI readable.        */
html.lite .glass,
html.lite .glass-nb,
html.lite .glass-nb-dark {
  background: rgba(255,255,255,0.95) !important;
  border:     1px solid rgba(0,0,0,0.10) !important;
}

/* ── 6. Translucent Tailwind bg utilities → near-opaque ────────────
   Classes like bg-white/10, bg-black/50 create semi-transparent
   layers that the compositor must alpha-blend on every repaint.
   Bumping them to near-opaque eliminates the blend cost while keeping
   the visual appearance close to the original.                       */
html.lite [class*="bg-white/"] {
  background-color: rgba(255,255,255,0.95) !important;
}
html.lite [class*="bg-black/"] {
  background-color: rgba(0,0,0,0.85) !important;
}

/* ── 7. backdrop-blur Tailwind utilities ───────────────────────────
   Catches backdrop-blur-sm, backdrop-blur-md, etc. applied directly
   as Tailwind classes rather than through .glass.                    */
html.lite [class*="backdrop-blur"] {
  backdrop-filter:         none !important;
  -webkit-backdrop-filter: none !important;
}

/* ── 8. Thin scrollbar ─────────────────────────────────────────────
   Minor paint saving: thinner scrollbar = less area to composite.   */
html.lite {
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,0.2) transparent;
}
html.lite ::-webkit-scrollbar       { width: 6px; height: 6px; }
html.lite ::-webkit-scrollbar-track { background: transparent; }
html.lite ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.20); border-radius: 3px; }
  `;

  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}

/* ─────────────────────────── Provider ───────────────────────────── */
export function LiteModeProvider({ children }) {
  const [lite, setLite] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("lite-ui") ?? "false");
    } catch {
      return false;
    }
  });

  /* Apply / remove class whenever `lite` changes */
  useEffect(() => {
    if (lite) {
      injectLiteCSS();
      document.documentElement.classList.add("lite");
    } else {
      document.documentElement.classList.remove("lite");
      // Leave the CSS sheet injected – harmless without the class,
      // and avoids a flash on next toggle.
    }
    try {
      localStorage.setItem("lite-ui", JSON.stringify(lite));
    } catch {
      /* storage unavailable in private mode – ignore */
    }
  }, [lite]);

  const toggle = useCallback(() => setLite((v) => !v), []);

  /* ── Keyboard shortcut: Alt + Shift + L ── */
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && e.shiftKey && (e.key === "l" || e.key === "L")) {
        toggle();
        showToast(!document.documentElement.classList.contains("lite"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <LiteCtx.Provider value={{ lite, toggle }}>
      {/*
        In Lite Mode we leave reducedMotion as "user" so framer-motion
        runs all springs and tweens at full speed.  The GPU cost
        savings come entirely from the CSS overrides above, not from
        disabling JS animation.
      */}
      <MotionConfig reducedMotion="user">
        {children}
      </MotionConfig>
    </LiteCtx.Provider>
  );
}

/* ──────────────────── Mini toast helper ─────────────────────────── */
function showToast(nowOn) {
  document.getElementById("lite-toast")?.remove();

  const t = document.createElement("div");
  t.id = "lite-toast";
  t.textContent = nowOn ? "⚡ Lite Mode ON" : "✦ Lite Mode OFF";
  t.style.cssText = [
    "position:fixed",
    "top:20px",
    "right:20px",
    "padding:8px 18px",
    "background:#1e293b",
    "color:#f1f5f9",
    "border:1px solid rgba(255,255,255,0.12)",
    "border-radius:10px",
    "font-size:13px",
    "font-weight:600",
    "letter-spacing:0.02em",
    "z-index:99999",
    "pointer-events:none",
    "font-family:system-ui,sans-serif",
  ].join(";");
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
