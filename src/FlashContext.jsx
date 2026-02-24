// src/FlashContext.jsx
//
// The pulse clock writes --pulse and --pulse-clock directly onto :root
// every animation frame. All flash/glow CSS rules read those vars at paint
// time — no React state, no context propagation, no re-renders.
//
// useFlashPhase() is kept as a no-op export so any future caller compiles,
// but it intentionally returns nothing useful — consuming components should
// read the CSS var directly or use a non-React approach.

import React, { createContext, useContext, useEffect } from "react";

/* One global 1.5 s cycle. */
const CYCLE_MS = 1500;

let rafId = null;
let rafRunning = false;

// Smooth cosine easing: 0 → 1 → 0 over one full cycle
function easedPulse(t) {
  return 0.5 - 0.5 * Math.cos(t * 2 * Math.PI);
}

function startRAF() {
  if (rafRunning) return;
  rafRunning = true;
  const loop = (t) => {
    const phase = (t % CYCLE_MS) / CYCLE_MS;
    const pulse = easedPulse(phase);
    // --pulse  : 0→1→0 smooth cosine, consumed by flash.css / theme-white.css
    //            via calc(... * var(--pulse)) — no @keyframes, no per-element delays.
    document.documentElement.style.setProperty("--pulse", pulse.toFixed(4));
    // --pulse-clock: negative-seconds offset kept for any legacy @keyframes that
    //                still use animation-delay: var(--pulse-clock, 0s).
    document.documentElement.style.setProperty(
      "--pulse-clock",
      `${-(phase * 1.5).toFixed(4)}s`
    );
    if (rafRunning) rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

function stopRAF() {
  rafRunning = false;
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// Stub context — value never changes, never triggers re-renders.
const FlashContext = createContext(null);

export function FlashProvider({ children }) {
  useEffect(() => {
    startRAF();
    return () => stopRAF();
  }, []);
  // No value prop that changes — provider wrapper is just for lifecycle.
  return <FlashContext.Provider value={null}>{children}</FlashContext.Provider>;
}

/** @deprecated — pulse is driven by CSS vars now, not React state. */
export function useFlashPhase() {
  return useContext(FlashContext);
}
