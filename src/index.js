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
    "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",
});
// ============================================

createRoot(document.getElementById("root")).render(<App />);
