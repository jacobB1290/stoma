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

function startRAF() {
  let running = true;
  const loop = (t) => {
    phase = (t % CYCLE_MS) / CYCLE_MS;
    broadcast();
    if (running) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return () => (running = false);
}

const stopRAF = startRAF();

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
  useEffect(() => stopRAF, []);
  return <FlashContext.Provider value={p}>{children}</FlashContext.Provider>;
}

export function useFlashPhase() {
  return useContext(FlashContext);
}
