import React, { createContext, useContext, useEffect, useState } from "react";
import {
  userService,
  startHeartbeat,
  stopHeartbeat,
  reportActive,
} from "../services/userService";

export const UserCtx = createContext(null);

export function UserProvider({ children }) {
  const [name, setName] = useState(userService.getName());
  const [needsName, setNeedsName] = useState(userService.needsName());

  // Start heartbeat system when user has a name
  useEffect(() => {
    if (name) {
      console.log("[UserContext] User has name, starting heartbeat:", name);
      startHeartbeat();

      return () => {
        console.log("[UserContext] Cleanup, stopping heartbeat");
        stopHeartbeat();
      };
    }
  }, [name]);

  const saveName = (newName) => {
    if (!newName || !newName.trim()) return;

    console.log("[UserContext] Saving new name:", newName);
    userService.setName(newName);
    setName(newName.trim());
    setNeedsName(false);

    // Report active with new name immediately
    reportActive("name-saved");
  };

  const switchUser = () => {
    console.log("[UserContext] Switching user");
    stopHeartbeat();
    userService.clearUser();
    window.location.reload();
  };

  return (
    <UserCtx.Provider
      value={{
        name,
        needsName,
        saveName,
        switchUser,
      }}
    >
      {children}
    </UserCtx.Provider>
  );
}

export const useUser = () => useContext(UserCtx);
