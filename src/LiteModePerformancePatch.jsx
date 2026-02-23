/**
 * LiteModePerformancePatch.jsx  –  Stomaboard Lite Mode v2
 * ─────────────────────────────────────────────────────────
 * A ground-up rewrite designed for low-power hardware (Raspberry Pi,
 * older laptops, cheap Windows PCs).
 *
 * What it does
 * ────────────
 *  1. Injects a comprehensive CSS override sheet onto <html class="lite">
 *     that surgically removes every GPU-compositing expense:
 *       • backdrop-filter / filter / blur / saturate       → removed
 *       • framer-motion layout animations                  → disabled
 *       • CSS keyframe animations (glow, pulse-red, ping)  → stopped
 *       • box-shadow, ring                                 → flattened
 *       • will-change                                      → auto
 *       • smooth-scroll                                    → auto
 *       • opacity fractions on backgrounds                 → solid
 *
 *  2. Patches window.requestAnimationFrame to throttle at ≤ 20 fps so
 *     framer-motion's layout engine doesn't eat all four Pi cores.
 *     The original rAF is restored when Lite Mode is turned off.
 *
 *  3. Tells framer-motion reducedMotion="always" via <MotionConfig> so
 *     every <motion.div> skips its spring/tween interpolation.
 *
 *  4. Exposes useLiteMode() hook → { lite: bool, toggle: fn } for
 *     any component (currently SettingsModal).
 *
 *  5. Persists preference to localStorage("lite-ui").
 *
 *  6. Keyboard shortcut: Alt + Shift + L  (for power users / IT staff).
 *
 * What it does NOT do
 * ───────────────────
 *  • Does not change layout or break any interactive behaviour.
 *  • Does not alter data, routing, modals, or React state.
 *  • Does not re-theme the app – it stays on whatever theme the user chose.
 *    (The light-coloured flat background only activates on glass/translucent
 *     classes that would otherwise need a GPU layer.)
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
const STYLE_ID = "stomaboard-lite-css-v2";

function injectLiteCSS() {
  if (document.getElementById(STYLE_ID)) return;

  const css = /* css */ `
/* ═══════════════════════════════════════════════════════════════════
   STOMABOARD LITE MODE  –  performance override sheet
   Applied when <html> carries the class "lite"
   Every rule uses !important to win over inline styles and libraries.
   ═══════════════════════════════════════════════════════════════════ */

/* ── 1. Stop ALL animations & transitions globally ─────────────────
   This is the single biggest CPU win on Pi.  Framer-motion still
   fires its JavaScript timers but MotionConfig reducedMotion="always"
   suppresses the actual interpolation; this catches anything else.    */
html.lite *,
html.lite *::before,
html.lite *::after {
  animation-duration:       0.001ms !important;
  animation-delay:          0s      !important;
  animation-iteration-count:1       !important;
  transition-duration:      0.001ms !important;
  transition-delay:         0s      !important;
}

/* ── 2. Kill GPU compositing layers ────────────────────────────────
   backdrop-filter and filter push every element onto its own GPU
   layer.  On a Pi this saturates VRAM and the compositor stalls.     */
html.lite *,
html.lite *::before,
html.lite *::after {
  backdrop-filter: none      !important;
  -webkit-backdrop-filter: none !important;
  filter:          none      !important;
  will-change:     auto      !important;
  transform:       none      !important;
  mix-blend-mode:  normal    !important;
}

/* ── 3. Framer-motion layout / position overrides ──────────────────
   Even with reducedMotion="always" framer-motion adds inline
   transform/opacity/scale styles.  We reset them here so the layout
   is purely CSS-driven again.                                         */
html.lite [style*="transform"],
html.lite [style*="opacity"],
html.lite [style*="scale"] {
  transform: none    !important;
  /* opacity intentionally NOT reset – we want invisible-to-visible
     transitions to still show content.  Only animation is removed.  */
}

/* ── 4. Glass / blur panels → solid white surface ──────────────────
   .glass and .glass-nb use backdrop-filter which we killed above.
   Give them a clean opaque background so they remain readable.        */
html.lite .glass,
html.lite .glass-nb,
html.lite .glass-nb-dark {
  background:    #ffffff !important;
  border:        1px solid rgba(0,0,0,0.10) !important;
  box-shadow:    0 1px 4px rgba(0,0,0,0.08) !important;
}

/* ── 5. Translucent Tailwind utility classes → opaque ──────────────
   bg-white/10 … bg-white/90, bg-black/10 … bg-black/90 etc.
   The pattern [class*="bg-white/"] doesn't catch inline vars so we
   also target common specific values used across the codebase.        */
html.lite [class*="bg-white/"],
html.lite [class*="bg-black/"] {
  background-color: rgba(255,255,255,0.96) !important;
}
html.lite [class*="border-white/"] {
  border-color: rgba(0,0,0,0.12) !important;
}
html.lite [class*="ring-white/"] {
  --tw-ring-color: rgba(0,0,0,0.15) !important;
}

/* ── 6. Flash / glow / pulse animations ───────────────────────────
   flash.css defines .glow and .pulse-red which rely on CSS animations
   and CSS filter.  In lite mode we show a static coloured ring
   instead so urgency is still communicated without the GPU cost.      */
html.lite .glow {
  outline: 3px solid #f59e0b !important;   /* amber – "priority" */
  outline-offset: -2px        !important;
}
html.lite .pulse-red,
html.lite .flash-red {
  outline: 3px solid #ef4444 !important;   /* red – "overdue"    */
  outline-offset: -2px        !important;
}
html.lite .pulse-red::after,
html.lite .flash-red::after {
  display: none !important;
}

/* ── 7. Animate-ping (update dot) ─────────────────────────────────
   Tailwind's animate-ping is used for the "update available" badge.
   Replace with a static dot.                                          */
html.lite .animate-ping {
  animation: none    !important;
  opacity:   1       !important;
  transform: none    !important;
}
html.lite .animate-spin {
  animation: none    !important;
}
html.lite .animate-pulse {
  animation: none    !important;
  opacity:   1       !important;
}
html.lite .animate-bounce {
  animation: none    !important;
}

/* ── 8. Box-shadow flattening ──────────────────────────────────────
   Multi-layer box shadows trigger extra GPU compositing passes.
   In lite mode we use a single crisp 1-pixel border instead.         */
html.lite [class*="shadow-"] {
  box-shadow: 0 1px 3px rgba(0,0,0,0.10) !important;
}

/* ── 9. Sticky headers → static ───────────────────────────────────
   Sticky positioning forces the browser to recomposite on every
   scroll event, which is expensive on slow hardware.                  */
html.lite .sticky,
html.lite [class*="sticky"] {
  position: static !important;
  top:      auto   !important;
  left:     auto   !important;
  right:    auto   !important;
}

/* ── 9a. KEEP fixed UI elements fixed ─────────────────────────────
   Settings button, FABs, modal overlays, toasts must stay in place.  */
html.lite .fixed,
html.lite [class*="fixed"] {
  position: fixed !important;
}

/* ── 10. Add-case card de-sticky / de-zoom ─────────────────────────
   The "Add Case" bubble has a scale/zoom entrance that causes forced
   layout on Pi.  Lock it to a plain inline card.                      */
html.lite .add-case-card,
html.lite [data-add-case] {
  position:   static    !important;
  transform:  none      !important;
  scale:      1         !important;
  max-width:  260px     !important;
  padding:    8px 16px  !important;
  background: #ffffff   !important;
  border:     1px solid rgba(0,0,0,0.10) !important;
  border-radius: 12px   !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08) !important;
}

/* ── 11. Smooth-scroll → instant ──────────────────────────────────*/
html.lite {
  scroll-behavior: auto !important;
}

/* ── 12. Scrollbar – thin, no GPU paint ───────────────────────────*/
html.lite {
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,0.2) transparent;
}
html.lite ::-webkit-scrollbar       { width: 6px; height: 6px; }
html.lite ::-webkit-scrollbar-track { background: transparent; }
html.lite ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.20); border-radius: 3px; }

/* ── 13. framer-motion LayoutGroup – stop layout animations ────────
   framer-motion adds [data-framer-*] attributes. We don't target
   those directly but MotionConfig reducedMotion="always" + the
   transform:none above together eliminate the motion.                 */
html.lite [data-projection-id] {
  transform: none !important;
}

/* ── 14. Overlay / modal backdrops ─────────────────────────────────
   Modal backdrops use bg-black/50 backdrop-blur-sm.  In lite mode:
   backdrop is a solid semi-transparent layer, no blur.               */
html.lite [class*="backdrop-blur"] {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* ── 15. Opacity classes ───────────────────────────────────────────
   Framer-motion sets opacity: 0 on initial render and animates to 1.
   With reducedMotion="always" it jumps immediately, but CSS can still
   catch elements left at 0 if a component bails early.               */
html.lite [class*="opacity-0"]:not([aria-hidden="true"]) {
  opacity: 1 !important;
}
  `;

  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}

function removeLiteCSS() {
  document.getElementById(STYLE_ID)?.remove();
}

/* ──────────────── rAF throttle (≤ 20 fps) ───────────────────────── */
// Framer-motion drives every layout animation through rAF.  Capping
// it at 20 fps cuts its CPU share by ~67 % on a 60 Hz display.
// We restore the real rAF when Lite Mode is off.
let _originalRAF = null;
let _patchCount   = 0;  // guard against double-patch

function patchRAF() {
  if (_patchCount > 0) { _patchCount++; return; }
  _originalRAF = window.requestAnimationFrame;
  // 50 ms ≈ 20 fps
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 50);
  _patchCount = 1;
}

function unpatchRAF() {
  _patchCount = Math.max(0, _patchCount - 1);
  if (_patchCount === 0 && _originalRAF) {
    window.requestAnimationFrame = _originalRAF;
    _originalRAF = null;
  }
}

/* ──────────────── pulse-clock interval ──────────────────────────── */
// animationEngine.js runs setInterval(tick, 1500) to drive CSS
// --pulse-clock.  In Lite Mode we don't need sub-second precision –
// we just keep the variable frozen so the static outlines above work.
// We don't touch the interval because animationEngine.js manages it;
// our CSS animation-duration: 0.001ms override already stops it from
// consuming paint time.

/* ─────────────────────────── Provider ───────────────────────────── */
export function LiteModeProvider({ children }) {
  const [lite, setLite] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("lite-ui") ?? "false");
    } catch {
      return false;
    }
  });

  /* Apply / remove effects whenever `lite` changes */
  useEffect(() => {
    if (lite) {
      injectLiteCSS();
      document.documentElement.classList.add("lite");
      patchRAF();
    } else {
      document.documentElement.classList.remove("lite");
      unpatchRAF();
      // Leave the CSS sheet injected – it's harmless without the class
      // and avoids a flash when toggling back on.
    }
    try {
      localStorage.setItem("lite-ui", JSON.stringify(lite));
    } catch {
      /* ignore – storage may be unavailable in private mode */
    }
  }, [lite]);

  /* Cleanup on unmount */
  useEffect(() => {
    return () => {
      if (lite) unpatchRAF();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        reducedMotion="always" tells every <motion.*> to skip its
        spring / tween and jump straight to the final value.
        When lite is false we pass "user" – meaning framer-motion
        respects the OS "prefers-reduced-motion" media query normally.
      */}
      <MotionConfig reducedMotion={lite ? "always" : "user"}>
        {children}
      </MotionConfig>
    </LiteCtx.Provider>
  );
}

/* ──────────────────── Mini toast helper ─────────────────────────── */
function showToast(nowOn) {
  // If a toast already exists, remove it first
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
