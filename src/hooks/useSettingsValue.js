import { useEffect, useState } from "react";

export function useSettingsValue(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? defaultValue : JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  });
  useEffect(() => {
    const onChange = (e) => {
      if (e.detail && e.detail.key && e.detail.key !== key) return;
      try {
        const raw = localStorage.getItem(key);
        setValue(raw == null ? defaultValue : JSON.parse(raw));
      } catch {
        setValue(defaultValue);
      }
    };
    window.addEventListener("settings-changed", onChange);
    window.addEventListener("settings-applied", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("settings-changed", onChange);
      window.removeEventListener("settings-applied", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [key, defaultValue]);
  return value;
}
