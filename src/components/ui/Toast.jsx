import React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { useToast } from "../../context/ToastContext";

const KIND_STYLES = {
  success: {
    bg: "rgba(22, 163, 74, 0.95)",
    border: "rgba(34, 197, 94, 0.6)",
    text: "#ffffff",
    icon: "✓",
  },
  error: {
    bg: "rgba(220, 38, 38, 0.95)",
    border: "rgba(248, 113, 113, 0.6)",
    text: "#ffffff",
    icon: "!",
  },
  warn: {
    bg: "rgba(217, 119, 6, 0.95)",
    border: "rgba(251, 191, 36, 0.6)",
    text: "#ffffff",
    icon: "!",
  },
  info: {
    bg: "rgba(37, 99, 235, 0.95)",
    border: "rgba(96, 165, 250, 0.6)",
    text: "#ffffff",
    icon: "i",
  },
};

export default function Toast() {
  const { toasts, remove } = useToast();

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: "fixed",
        bottom: "1rem",
        right: "1rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "0.5rem",
        zIndex: "var(--z-toast, 500)",
        pointerEvents: "none",
        maxWidth: "calc(100vw - 2rem)",
      }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const style = KIND_STYLES[t.kind] || KIND_STYLES.info;
          return (
            <motion.div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 280, damping: 24 }}
              onClick={() => remove(t.id)}
              style={{
                background: style.bg,
                border: `1px solid ${style.border}`,
                color: style.text,
                padding: "0.75rem 1rem",
                borderRadius: "0.625rem",
                boxShadow:
                  "0 10px 25px rgba(0,0,0,0.15), 0 4px 10px rgba(0,0,0,0.1)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                pointerEvents: "auto",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                minWidth: "240px",
                maxWidth: "420px",
                fontSize: "0.875rem",
                fontWeight: 500,
                lineHeight: 1.4,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "1.25rem",
                  height: "1.25rem",
                  borderRadius: "9999px",
                  background: "rgba(255,255,255,0.25)",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {style.icon}
              </span>
              <span style={{ flex: 1 }}>{t.message}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body
  );
}
