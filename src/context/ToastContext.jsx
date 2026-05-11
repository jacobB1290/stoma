import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback(
    (id) => setToasts((t) => t.filter((x) => x.id !== id)),
    []
  );

  const push = useCallback(
    (message, kind = "info", ttl = 4000) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t, { id, message, kind }]);
      setTimeout(() => remove(id), ttl);
      return id;
    },
    [remove]
  );

  const api = useMemo(
    () => ({
      success: (m) => push(m, "success"),
      error: (m) => push(m, "error", 6000),
      info: (m) => push(m, "info"),
      warn: (m) => push(m, "warn"),
      remove,
      toasts,
    }),
    [push, remove, toasts]
  );

  return <ToastCtx.Provider value={api}>{children}</ToastCtx.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
