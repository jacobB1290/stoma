import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  userService,
  initUserStorage,
  startHeartbeat,
  stopHeartbeat,
  reportActive,
} from "../services/userService";
import { getCanonicalName } from "../utils/nameNormalization";

export const UserCtx = createContext(null);

/**
 * Reads a name from the URL path segment.
 * "/jacob" → "jacob", "/Jacob" → "Jacob", "/" or "/some/nested" → null.
 * Rejects paths that look like static assets or internal routes.
 */
function getNameFromPath() {
  const path = window.location.pathname;
  // Only match a single top-level segment (no nested paths)
  const match = path.match(/^\/([^/]+)\/?$/);
  if (!match) return null;
  const candidate = decodeURIComponent(match[1]).trim();
  // Reject system/asset paths
  if (/^(app|api|static|icons|favicon|manifest|robots|service-worker|version|changelog)$/i.test(candidate)) return null;
  // Must be at least 2 chars and contain no URL-special characters
  if (candidate.length < 2 || /[.\\?#]/.test(candidate)) return null;
  return candidate;
}

export function UserProvider({ children }) {
  // ── Wait for initUserStorage (which may hit Supabase for device lookup)
  // before deciding whether the modal is needed. This prevents the modal
  // from flashing open for a returning user whose localStorage was cleared.
  const [ready,     setReady]     = useState(false);
  const [name,      setName]      = useState("");
  const [needsName, setNeedsName] = useState(false);

  useEffect(() => {
    initUserStorage().then(() => {
      // 1. URL slug takes highest priority: /jacob → bypass setup, use "Jacob"
      const urlName = getNameFromPath();
      if (urlName) {
        const canonical = getCanonicalName(urlName);
        userService.setName(canonical);
        setName(canonical);
        setNeedsName(false);
        setReady(true);
        return;
      }

      // 2. Fall back to persisted storage (localStorage → IndexedDB → cookie → Supabase)
      const storedName = userService.getName();
      setName(storedName || "");
      setNeedsName(!storedName);
      setReady(true);
    });
  }, []);

  // Start heartbeat once the user has a name
  useEffect(() => {
    if (name) {
      startHeartbeat();
      return () => stopHeartbeat();
    }
  }, [name]);

  const saveName = (newName) => {
    if (!newName || !newName.trim()) return;
    userService.setName(newName);
    const canonical = newName.trim();
    setName(canonical);
    setNeedsName(false);
    reportActive("name-saved");

    // Update the URL to the name slug so future visits (and shared links)
    // bypass the setup screen automatically.
    const slug = encodeURIComponent(canonical.toLowerCase());
    window.history.replaceState(null, "", `/${slug}`);
  };

  const switchUser = () => {
    stopHeartbeat();
    userService.clearUser();
    // Strip the name slug from the URL so the next load shows setup again
    window.history.replaceState(null, "", "/");
    window.location.reload();
  };

  // Render nothing until storage init is complete — avoids a flash of the
  // name modal for users who will be auto-restored from Supabase/IndexedDB.
  if (!ready) return null;

  return (
    <UserCtx.Provider value={{ name, needsName, saveName, switchUser }}>
      {children}
    </UserCtx.Provider>
  );
}

export const useUser = () => useContext(UserCtx);
