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
  fetchSettingsForName,
  applySettings,
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
    initUserStorage().then(async () => {
      // 1. URL slug takes highest priority: /jacob → bypass setup, use "Jacob"
      const urlName = getNameFromPath();
      if (urlName) {
        const canonical = getCanonicalName(urlName);
        userService.setName(canonical);
        setName(canonical);
        setNeedsName(false);

        // Fetch and apply settings from the database for this user.
        // Only overwrite localStorage if the Supabase record is at least as
        // fresh as the last local change.  Without this guard, a quick refresh
        // (before the 500 ms debounced heartbeat fires) would always restore
        // the *old* Supabase copy and discard the change the user just made.
        try {
          const settingsResult = await fetchSettingsForName(canonical);
          if (settingsResult?.settings && Object.keys(settingsResult.settings).length > 0) {
            const localUpdatedAt  = parseInt(localStorage.getItem("_settings_updated_at") || "0", 10);
            // settings_updated_at is the timestamp we embed in device_info when
            // flushing to Supabase, so it reflects when those settings were
            // actually changed — not just when the heartbeat happened to fire.
            const remoteUpdatedAt = parseInt(settingsResult.settingsUpdatedAt  || "0", 10);

            const remoteIsNewer = remoteUpdatedAt >= localUpdatedAt;
            const noLocalHistory = localUpdatedAt === 0; // fresh device / cleared storage

            if (remoteIsNewer || noLocalHistory) {
              console.log(
                `[UserContext] Applying Supabase settings (remote: ${remoteUpdatedAt}, local: ${localUpdatedAt})`
              );
              applySettings(settingsResult.settings);
              // Align our local timestamp so the next refresh doesn't think
              // these now-identical settings are "newer" than Supabase.
              try {
                if (remoteUpdatedAt > 0) {
                  localStorage.setItem("_settings_updated_at", String(remoteUpdatedAt));
                }
              } catch { /* ignore */ }
            } else {
              console.log(
                `[UserContext] Skipping Supabase settings – local is newer (local: ${localUpdatedAt}, remote: ${remoteUpdatedAt})`
              );
            }
          }
        } catch (err) {
          console.warn("[UserContext] Failed to fetch settings for URL name:", err);
        }

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
