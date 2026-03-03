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
 *
 * Text colour fix: any element whose translucent background is made
 * opaque-light gets forced dark text so nothing becomes white-on-white.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { MotionConfig } from "motion/react";

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
   Every element with it gets promoted to its own GPU layer.          */
html.lite *,
html.lite *::before,
html.lite *::after {
  backdrop-filter:         none !important;
  -webkit-backdrop-filter: none !important;
}

/* ── 2. Remove filter ──────────────────────────────────────────────
   filter: brightness() on .glow forces a full GPU repaint per frame. */
html.lite * {
  filter: none !important;
}

/* ── 3. Clear will-change promotions ───────────────────────────────
   will-change pre-promotes elements to GPU layers before any
   animation even starts, burning VRAM for every visible card.        */
html.lite * {
  will-change: auto !important;
}

/* ── 4. Remove mix-blend-mode ──────────────────────────────────────
   mix-blend-mode: color (pulse-red::after) requires an extra pass.   */
html.lite * {
  mix-blend-mode: normal !important;
}

/* ── 5. Glass / blur panels → solid surface ────────────────────────
   .glass and .glass-nb rely on backdrop-filter (killed above).
   Give them a solid background so they remain readable.
   Use a light-neutral that works on both dark and light app themes.  */
html.lite .glass,
html.lite .glass-nb,
html.lite .glass-nb-dark {
  background: rgba(240,244,248,0.98) !important;
  border:     1px solid rgba(0,0,0,0.10) !important;
  color:      #0f172a !important;
}

/* ── 6. backdrop-blur Tailwind utilities ───────────────────────────
   Catches backdrop-blur-sm, backdrop-blur-md, etc.                   */
html.lite [class*="backdrop-blur"] {
  backdrop-filter:         none !important;
  -webkit-backdrop-filter: none !important;
}

/* ── 7. Translucent bg-white/* → light opaque + DARK text ──────────
   bg-white/10 … bg-white/90 create semi-transparent layers that need
   alpha compositing.  We make them near-opaque AND force dark text so
   nothing becomes white-on-white (e.g. RevealButton, nav pills,
   settings pill which all combine bg-white/* with text-white).       */
html.lite [class*="bg-white/"] {
  background-color: rgba(240,244,248,0.97) !important;
  color:            #1e293b               !important;
}
/* Ensure any nested text-white spans also go dark */
html.lite [class*="bg-white/"] *,
html.lite [class*="bg-white/"] *::before,
html.lite [class*="bg-white/"] *::after {
  color: inherit !important;
}

/* ── 8. Translucent bg-black/* → dark opaque + LIGHT text ──────────
   bg-black/* overlays should stay dark and keep their white text.    */
html.lite [class*="bg-black/"] {
  background-color: rgba(15,23,42,0.90) !important;
  color:            #f1f5f9              !important;
}

/* ── 9. Row cards on dark column backgrounds keep white text ────────
   Case row cards (bg-[#4D8490], bg-[#6F5BA8] etc.) are solid dark
   hex colours – our rules above don't touch them – but explicitly
   confirm their text stays white so rule 7's child cascade can't
   accidentally reach them via an ancestor with bg-white/*.            */
html.lite .glass *:not([class*="bg-white/"]):not([class*="bg-black/"]),
html.lite .glass-nb *:not([class*="bg-white/"]):not([class*="bg-black/"]) {
  color: #1e293b !important;
}

/* ── 10. Thin scrollbar ────────────────────────────────────────────*/
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
    }
    try {
      localStorage.setItem("lite-ui", JSON.stringify(lite));
    } catch {
      /* storage unavailable in private mode – ignore */
    }
  }, [lite]);

  /* Re-sync state when settings are applied from Supabase (e.g. on login or
     when an admin pushes settings via SystemManagementScreen).  The event
     detail may carry the value under "lite-ui" (current) or the legacy
     "liteUi" key so we check both. */
  useEffect(() => {
    const onSettingsApplied = (e) => {
      const detail = e.detail || {};
      const raw = detail["lite-ui"] ?? detail["liteUi"];
      if (raw === undefined) return;
      try {
        setLite(typeof raw === "boolean" ? raw : raw === "true");
      } catch {
        /* ignore parse errors */
      }
    };
    window.addEventListener("settings-applied", onSettingsApplied);
    return () => window.removeEventListener("settings-applied", onSettingsApplied);
  }, []);

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
        runs all springs and tweens at full speed.
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
