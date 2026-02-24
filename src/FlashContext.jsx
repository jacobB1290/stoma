// src/FlashContext.jsx
import React, {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";

/* One global 1.5 s cycle. */
const CYCLE_MS = 1500;

let phase = 0; // 0‥1 repeating
const subs = new Set();

function broadcast() {
  subs.forEach((fn) => fn());
}

let rafId = null;
let rafRunning = false;

// Smooth sine-based easing: 0 → 1 → 0 over one full cycle
function easedPulse(t) {
  // t is 0..1 (phase). Returns 0..1..0 smoothly.
  return 0.5 - 0.5 * Math.cos(t * 2 * Math.PI);
}

function startRAF() {
  if (rafRunning) return;
  rafRunning = true;
  const loop = (t) => {
    phase = (t % CYCLE_MS) / CYCLE_MS;
    // Write the live pulse value directly onto :root as a CSS custom property.
    // This means every .flash-overdue / .glow element in the entire tree reads
    // the *same* value at the *same* time — no per-element animation-delay
    // offsets, no restarts when components re-mount.
    const pulse = easedPulse(phase); // 0..1..0, smooth cosine
    document.documentElement.style.setProperty("--pulse", pulse.toFixed(4));
    // Also keep --pulse-clock (negative-seconds offset) for any legacy @keyframes
    // in theme-white.css / animationEngine that use animation-delay: var(--pulse-clock).
    // Writing this every frame instead of every 1500ms makes the delay offset
    // current-accurate and prevents the jarring reset that happened with setInterval.
    document.documentElement.style.setProperty(
      "--pulse-clock",
      `${-(phase * 1.5).toFixed(4)}s`
    );
    broadcast();
    if (rafRunning) rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

function stopRAFLoop() {
  rafRunning = false;
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/* external-store glue */
function subscribe(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}
function getSnapshot() {
  return phase;
}

const FlashContext = createContext(0);

export function FlashProvider({ children }) {
  const p = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    startRAF();
    return () => stopRAFLoop();
  }, []);
  return <FlashContext.Provider value={p}>{children}</FlashContext.Provider>;
}

export function useFlashPhase() {
  return useContext(FlashContext);
}
