// src/index.js
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/glass.css"; // existing
import "./flash.css"; // existing
import "./index.css"; // Tailwind base + app globals
import { configureLLM } from "./qa/LLMChatService";
import { deepRefresh } from "./utils/deepRefresh";

// API key is read from the REACT_APP_OPENAI_API_KEY environment variable.
// Set it in Vercel → Project Settings → Environment Variables,
// or in a local .env file (never commit .env to git).
configureLLM({
  apiKey: process.env.REACT_APP_OPENAI_API_KEY || "",
});

// Strip the _deep_refresh marker so it never persists in the address bar
// or bookmarks after a cache-busting reload.
if (window.location.search.includes("_deep_refresh")) {
  const clean = new URL(window.location.href);
  clean.searchParams.delete("_deep_refresh");
  window.history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
}

createRoot(document.getElementById("root")).render(<App />);

// ── Service Worker registration ────────────────────────────────────────────
// Register our custom service worker in production for PWA install support,
// caching, and (eventually) offline resilience.
if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
  window.addEventListener("load", () => {
    // Capture whether a SW was already controlling the page *before* we
    // register. On the very first install there is no existing controller,
    // so controllerchange fires from null → new SW. That is not an update
    // worth reloading for — the user just loaded fresh content. Only reload
    // when an *existing* SW is replaced by a newer one.
    const hadController = Boolean(navigator.serviceWorker.controller);

    navigator.serviceWorker
      .register("/service-worker.js", { scope: "/" })
      .then((registration) => {
        console.log("[SW] Registered:", registration.scope);

        // When a new SW is waiting, activate it immediately and reload
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New content is available – post a message to skip waiting
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[SW] Registration failed:", err);
      });

    // Reload once when a new SW takes control — but only if this is a real
    // update (there was already a controller before). Skip on first install
    // to avoid the unnecessary double-load on first open.
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing && hadController) {
        refreshing = true;
        deepRefresh("service-worker-controller-change");
      }
    });
  });
}
