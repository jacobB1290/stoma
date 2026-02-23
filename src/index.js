// src/index.js
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/glass.css"; // existing
import "./flash.css"; // existing
import "./index.css"; // ← new
import { configureLLM } from "./qa/LLMChatService";

// API key is read from the REACT_APP_OPENAI_API_KEY environment variable.
// Set it in Vercel → Project Settings → Environment Variables,
// or in a local .env file (never commit .env to git).
configureLLM({
  apiKey: process.env.REACT_APP_OPENAI_API_KEY || "",
});

createRoot(document.getElementById("root")).render(<App />);
