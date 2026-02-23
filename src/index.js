// src/index.js
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/glass.css"; // existing
import "./flash.css"; // existing
import "./index.css"; // ← new
import { configureLLM } from "./qa/LLMChatService";

// ============================================
// PASTE YOUR OPENAI API KEY HERE
// ============================================
configureLLM({
  apiKey:
    "REACT_APP_OPENAI_API_KEY_REMOVED_FROM_HISTORY",
});
// ============================================

createRoot(document.getElementById("root")).render(<App />);
