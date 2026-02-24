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

function startRAF() {
  if (rafRunning) return;
  rafRunning = true;
  const loop = (t) => {
    phase = (t % CYCLE_MS) / CYCLE_MS;
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
