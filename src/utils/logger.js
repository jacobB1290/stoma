// src/utils/logger.js
//
// Centralized logging helper.
//
// In production builds (`NODE_ENV === "production"`), debug/info logs are
// suppressed to keep the console clean and avoid the perf cost of formatting
// large arg lists. Warnings and errors always pass through so prod issues
// remain visible.

const isProd = process.env.NODE_ENV === "production";

export const logger = {
  debug: (...args) => {
    if (!isProd) console.log(...args);
  },
  info: (...args) => {
    if (!isProd) console.info(...args);
  },
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

export default logger;
