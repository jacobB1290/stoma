import { useEffect, useState } from "react";

export function useLocalStorageSetting(key, defaultValue) {
  const read = () => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return defaultValue;
      return JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  };
  const [value, setValue] = useState(read);

  useEffect(() => {
    const onChange = () => setValue(read());
    window.addEventListener("storage", onChange);
    window.addEventListener("settings-changed", onChange);
    window.addEventListener("settings-applied", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("settings-changed", onChange);
      window.removeEventListener("settings-applied", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = (next) => {
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
    setValue(next);
    window.dispatchEvent(new Event("settings-changed"));
  };

  return [value, set];
}
