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

export const UserCtx = createContext(null);

export function UserProvider({ children }) {
  // ── Wait for initUserStorage (which may hit Supabase for device lookup)
  // before deciding whether the modal is needed. This prevents the modal
  // from flashing open for a returning user whose localStorage was cleared.
  const [ready,     setReady]     = useState(false);
  const [name,      setName]      = useState("");
  const [needsName, setNeedsName] = useState(false);

  useEffect(() => {
    initUserStorage().then(() => {
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
    setName(newName.trim());
    setNeedsName(false);
    reportActive("name-saved");
  };

  const switchUser = () => {
    stopHeartbeat();
    userService.clearUser();
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
