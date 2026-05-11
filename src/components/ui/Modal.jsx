import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";

const SIZE = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export default function Modal({
  open,
  onClose,
  size = "md",
  title,
  children,
  closeOnBackdrop = true,
  ariaLabel,
}) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    const previouslyFocused = document.activeElement;
    // Focus first focusable inside dialog
    const focusables = dialogRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusables?.[0]?.focus?.();
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previouslyFocused?.focus) previouslyFocused.focus();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          style={{ zIndex: "var(--z-modal)" }}
          onClick={closeOnBackdrop ? onClose : undefined}
          role="presentation"
        >
          <motion.div
            ref={dialogRef}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={`w-full ${SIZE[size] || SIZE.md} mx-4 rounded-2xl bg-white shadow-2xl`}
            style={{ background: "var(--surface, white)" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel || title}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
