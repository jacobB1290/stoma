// src/index.js
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/glass.css"; // existing
import "./flash.css"; // existing
import "./index.css"; // Tailwind base + app globals
import { configureLLM } from "./qa/LLMChatService";

// API key is read from the REACT_APP_OPENAI_API_KEY environment variable.
// Set it in Vercel → Project Settings → Environment Variables,
// or in a local .env file (never commit .env to git).
configureLLM({
  apiKey: process.env.REACT_APP_OPENAI_API_KEY || "",
});

createRoot(document.getElementById("root")).render(<App />);

// ── Service Worker registration ────────────────────────────────────────────
// Register our custom service worker in production for PWA install support,
// caching, and (eventually) offline resilience.
if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
  window.addEventListener("load", () => {
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

    // When the controller changes (new SW activated), reload the page once
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}
