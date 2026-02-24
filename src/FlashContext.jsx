// src/FlashContext.jsx
//
// Sets --pulse-clock ONCE on :root at startup, then stops.
//
// CSS @keyframes run on their own — the browser compositor drives them
// at 60fps with zero JavaScript involvement after the initial write.
// Changing the var every frame was restarting every animation every frame.
//
// --pulse-clock: a static negative-seconds offset that phase-aligns all
//   1.5s @keyframes animations to the current wall-clock time so they
//   all start in sync, identical to how the Board page works.

import React, { createContext, useContext, useEffect } from "react";

const CYCLE_MS = 1500;

// Called once — calculates where we are in the 1.5s cycle right now
// and writes a static animation-delay offset to :root.
// After this, CSS @keyframes run entirely on the GPU — no JS needed.
function applyPulseClock() {
  const phase = (performance.now() % CYCLE_MS) / CYCLE_MS; // 0..1
  const offset = -(phase * (CYCLE_MS / 1000)).toFixed(4) + "s";
  document.documentElement.style.setProperty("--pulse-clock", offset);
}

// Stub context — never changes, never triggers re-renders.
const FlashContext = createContext(null);

export function FlashProvider({ children }) {
  useEffect(() => {
    applyPulseClock();
    // No RAF loop, no interval — CSS handles it from here.
  }, []);
  return <FlashContext.Provider value={null}>{children}</FlashContext.Provider>;
}

/** @deprecated — pulse is CSS-only now. */
export function useFlashPhase() {
  return useContext(FlashContext);
}
