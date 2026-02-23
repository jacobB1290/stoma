import { db } from "./caseService";
import { APP_VERSION } from "../constants";
import {
  getCanonicalName,
  getNameVariations,
} from "../utils/nameNormalization";

// ============================================
// ROBUST STORAGE - Multiple fallback layers
// ============================================

// Try to get name from multiple sources (priority order)
function getStoredName() {
  // 1. Try localStorage first (primary)
  try {
    const localName = localStorage.getItem("userName");
    if (localName && localName.trim()) {
      return localName.trim();
    }
  } catch (e) {
    console.warn("[Storage] localStorage read failed:", e);
  }

  // 2. Try IndexedDB via a cached value (if we've stored it before)
  // This is sync, so we check a module-level cache that gets populated async
  if (cachedIndexedDBName) {
    // Restore to localStorage since it was missing
    try {
      localStorage.setItem("userName", cachedIndexedDBName);
    } catch (e) {
      // Ignore write failures
    }
    return cachedIndexedDBName;
  }

  // 3. Try cookie as last resort
  try {
    const cookieName = getCookie("userName");
    if (cookieName && cookieName.trim()) {
      // Restore to localStorage
      try {
        localStorage.setItem("userName", cookieName.trim());
      } catch (e) {
        // Ignore
      }
      return cookieName.trim();
    }
  } catch (e) {
    console.warn("[Storage] Cookie read failed:", e);
  }

  return "";
}

// Save name to all storage layers
function saveToAllStorages(name) {
  const trimmedName = name.trim();

  // 1. localStorage (primary)
  try {
    localStorage.setItem("userName", trimmedName);
  } catch (e) {
    console.warn("[Storage] localStorage write failed:", e);
  }

  // 2. Cookie (backup - survives some localStorage clears)
  try {
    // Set cookie to expire in 1 year
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 1);
    document.cookie = `userName=${encodeURIComponent(
      trimmedName
    )};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
  } catch (e) {
    console.warn("[Storage] Cookie write failed:", e);
  }

  // 3. IndexedDB (most persistent)
  saveToIndexedDB(trimmedName);
}

// Clear from all storage layers
function clearAllStorages() {
  try {
    localStorage.removeItem("userName");
  } catch (e) {
    // Ignore
  }

  try {
    document.cookie = "userName=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
  } catch (e) {
    // Ignore
  }

  clearIndexedDB();
  cachedIndexedDBName = null;
}

// ============================================
// COOKIE HELPERS
// ============================================

function getCookie(name) {
  const nameEQ = name + "=";
  const cookies = document.cookie.split(";");
  for (let i = 0; i < cookies.length; i++) {
    let cookie = cookies[i].trim();
    if (cookie.indexOf(nameEQ) === 0) {
      return decodeURIComponent(cookie.substring(nameEQ.length));
    }
  }
  return null;
}

// ============================================
// INDEXEDDB HELPERS (most persistent storage)
// ============================================

const DB_NAME = "AppUserStore";
const DB_VERSION = 1;
const STORE_NAME = "userData";

let cachedIndexedDBName = null;
let dbInstance = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.warn("[IndexedDB] Failed to open:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
  });
}

async function saveToIndexedDB(name) {
  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put({ key: "userName", value: name });
    cachedIndexedDBName = name;
  } catch (e) {
    console.warn("[IndexedDB] Save failed:", e);
  }
}

async function loadFromIndexedDB() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get("userName");

      request.onsuccess = () => {
        const result = request.result?.value || null;
        cachedIndexedDBName = result;
        resolve(result);
      };

      request.onerror = () => {
        resolve(null);
      };
    });
  } catch (e) {
    console.warn("[IndexedDB] Load failed:", e);
    return null;
  }
}

async function clearIndexedDB() {
  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.delete("userName");
  } catch (e) {
    console.warn("[IndexedDB] Clear failed:", e);
  }
}

// ============================================
// INITIALIZATION - Load from IndexedDB on startup
// ============================================

let initPromise = null;

export function initUserStorage() {
  if (!initPromise) {
    initPromise = loadFromIndexedDB().then((indexedDBName) => {
      // If localStorage is empty but IndexedDB has a name, restore it
      const localName = localStorage.getItem("userName");
      if (!localName && indexedDBName) {
        console.log("[Storage] Restoring name from IndexedDB:", indexedDBName);
        try {
          localStorage.setItem("userName", indexedDBName);
        } catch (e) {
          // Ignore
        }
        // Also restore cookie
        try {
          const expires = new Date();
          expires.setFullYear(expires.getFullYear() + 1);
          document.cookie = `userName=${encodeURIComponent(
            indexedDBName
          )};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
        } catch (e) {
          // Ignore
        }
      }
      // If localStorage has a name but IndexedDB doesn't, sync to IndexedDB
      else if (localName && !indexedDBName) {
        console.log("[Storage] Syncing existing name to IndexedDB:", localName);
        saveToIndexedDB(localName);
        // Also ensure cookie is set
        try {
          const expires = new Date();
          expires.setFullYear(expires.getFullYear() + 1);
          document.cookie = `userName=${encodeURIComponent(
            localName
          )};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
        } catch (e) {
          // Ignore
        }
      }
      return true;
    });
  }
  return initPromise;
}

// Start initialization immediately on module load
initUserStorage();

// ============================================
// PUBLIC USER SERVICE
// ============================================

export const userService = {
  getName: () => {
    return getStoredName();
  },

  setName: (name) => {
    if (name && name.trim()) {
      saveToAllStorages(name);
      return true;
    }
    return false;
  },

  clearUser: () => {
    clearAllStorages();
  },

  needsName: () => {
    const name = getStoredName();
    return !name || name.trim() === "";
  },

  // Wait for IndexedDB to be loaded (use in app startup if needed)
  waitForInit: () => initPromise,
};

// ============================================
// HEARTBEAT CONFIGURATION
// ============================================
const HEARTBEAT_INTERVAL = 20 * 1000;
const ACTIVITY_DEBOUNCE = 3 * 1000;
const DEBUG = true;

// ============================================
// STATE
// ============================================
let heartbeatInterval = null;
let lastReportTime = 0;
let activityDebounceTimeout = null;
let isTabVisible = true;

function log(...args) {
  if (DEBUG) {
    console.log(`[Heartbeat ${new Date().toLocaleTimeString()}]`, ...args);
  }
}

// ============================================
// CORE REPORT FUNCTION
// ============================================
export async function reportActive(reason = "unknown") {
  const userName = userService.getName();
  if (!userName) {
    log("No user name, skipping report");
    return;
  }

  const now = Date.now();
  lastReportTime = now;

  log(`Reporting active - reason: ${reason}`);

  try {
    const basePayload = {
      user_name: userName,
      app_version: APP_VERSION,
      last_seen: new Date().toISOString(),
    };

    const settingsKeys = [
      "boardTheme",
      "showInfoBar",
      "showCaseTableDividers",
      "lockAddCaseCard",
      "showStageDividers",
      "autoUpdate",
      "facultySystemManager",
    ];

    const settings = {};
    settingsKeys.forEach((k) => {
      const v = localStorage.getItem(k);
      if (v != null) settings[k] = v;
    });

    const device_info = {
      ua: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      settings,
    };

    // Try enhanced payload first, then fall back for older DB schemas.
    let error = null;
    {
      const res = await db
        .from("active_devices")
        .upsert({ ...basePayload, device_info }, { onConflict: "user_name" });
      error = res.error || null;
    }
    if (error) {
      const res2 = await db
        .from("active_devices")
        .upsert(basePayload, { onConflict: "user_name" });
      error = res2.error || null;
    }

    if (error) console.error("Failed to report active:", error);
    else log("Successfully reported active");
  } catch (error) {
    console.error("Failed to report active status:", error);
  }
}

// ============================================
// HEARTBEAT MANAGEMENT
// ============================================
function startHeartbeatTimer() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  log("Starting heartbeat timer");

  reportActive("heartbeat-start");

  heartbeatInterval = setInterval(() => {
    if (isTabVisible) {
      reportActive("heartbeat-interval");
    } else {
      log("Tab hidden, skipping heartbeat");
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeatTimer() {
  log("Stopping heartbeat timer");
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ============================================
// EVENT HANDLERS
// ============================================

function handleVisibilityChange() {
  const wasVisible = isTabVisible;
  isTabVisible = document.visibilityState === "visible";

  log(`Visibility changed: ${wasVisible} -> ${isTabVisible}`);

  if (isTabVisible && !wasVisible) {
    reportActive("tab-visible");
    startHeartbeatTimer();
  } else if (!isTabVisible && wasVisible) {
    stopHeartbeatTimer();
  }
}

function handleFocus() {
  log("Window focused");
  isTabVisible = true;
  reportActive("window-focus");

  if (!heartbeatInterval) {
    startHeartbeatTimer();
  }
}

function handleBlur() {
  log("Window blurred");
}

function handleActivity(event) {
  if (activityDebounceTimeout) {
    clearTimeout(activityDebounceTimeout);
  }

  activityDebounceTimeout = setTimeout(() => {
    if (isTabVisible) {
      reportActive(`activity-${event.type}`);
    }
  }, ACTIVITY_DEBOUNCE);
}

function handleBeforeUnload() {
  log("Page unloading");
  const userName = userService.getName();
  if (userName && navigator.sendBeacon) {
    log("Page closing - sendBeacon would go here");
  }
}

// ============================================
// PUBLIC API
// ============================================
export function startHeartbeat() {
  log("=== STARTING HEARTBEAT SYSTEM ===");

  isTabVisible = document.visibilityState === "visible";
  log(`Initial visibility: ${isTabVisible}`);

  startHeartbeatTimer();

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", handleFocus);
  window.addEventListener("blur", handleBlur);
  window.addEventListener("beforeunload", handleBeforeUnload);

  window.addEventListener("mousedown", handleActivity);
  window.addEventListener("keydown", handleActivity);
  window.addEventListener("scroll", handleActivity, { passive: true });
  window.addEventListener("touchstart", handleActivity, { passive: true });

  log("All event listeners attached");
}

export function stopHeartbeat() {
  log("=== STOPPING HEARTBEAT SYSTEM ===");

  stopHeartbeatTimer();

  if (activityDebounceTimeout) {
    clearTimeout(activityDebounceTimeout);
    activityDebounceTimeout = null;
  }

  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("focus", handleFocus);
  window.removeEventListener("blur", handleBlur);
  window.removeEventListener("beforeunload", handleBeforeUnload);
  window.removeEventListener("mousedown", handleActivity);
  window.removeEventListener("keydown", handleActivity);
  window.removeEventListener("scroll", handleActivity);
  window.removeEventListener("touchstart", handleActivity);

  log("All event listeners removed");
}

// ============================================
// FETCH USERS (for UpdateModal)
// ============================================
export async function fetchActiveUsers() {
  try {
    const { data, error } = await db
      .from("active_devices")
      .select("*")
      .order("last_seen", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Failed to fetch active users:", error);
    return [];
  }
}

// ============================================
// FETCH SETTINGS BY NAME (for UserSetupModal)
// Uses name normalization to find settings from
// any variation of the same user's name
// ============================================
export async function fetchSettingsForName(inputName) {
  if (!inputName || !inputName.trim()) {
    return null;
  }

  try {
    // Get all variations of this name that might exist in the database
    const variations = getNameVariations(inputName);
    const canonicalName = getCanonicalName(inputName);

    console.log(
      `[UserService] Looking up settings for "${inputName}" (canonical: "${canonicalName}")`
    );
    console.log(`[UserService] Checking variations:`, variations);

    // Fetch all active_devices records
    const { data, error } = await db
      .from("active_devices")
      .select("user_name, device_info, last_seen, app_version")
      .order("last_seen", { ascending: false });

    if (error) {
      console.error("[UserService] Failed to fetch devices:", error);
      return null;
    }

    if (!data || data.length === 0) {
      console.log("[UserService] No devices found in database");
      return null;
    }

    // Find matching records based on name variations
    // Match by checking if the lowercase username matches any variation
    const matchingRecords = data.filter((record) => {
      const recordNameLower = (record.user_name || "").toLowerCase().trim();
      // Check direct match with variations
      if (variations.includes(recordNameLower)) {
        return true;
      }
      // Also check if the canonical name matches
      const recordCanonical = getCanonicalName(record.user_name);
      return recordCanonical === canonicalName;
    });

    if (matchingRecords.length === 0) {
      console.log(`[UserService] No matching records found for "${inputName}"`);
      return null;
    }

    console.log(
      `[UserService] Found ${matchingRecords.length} matching record(s)`
    );

    // Find the record with the most complete settings
    // Prioritize: most recent record with non-empty settings
    let bestRecord = null;
    let bestSettingsCount = -1;

    for (const record of matchingRecords) {
      const settings = record.device_info?.settings;
      const settingsCount = settings ? Object.keys(settings).length : 0;

      // Prefer record with more settings, or more recent if same count
      if (settingsCount > bestSettingsCount) {
        bestRecord = record;
        bestSettingsCount = settingsCount;
      } else if (settingsCount === bestSettingsCount && settingsCount > 0) {
        // If same number of settings, prefer more recent
        if (
          bestRecord &&
          new Date(record.last_seen) > new Date(bestRecord.last_seen)
        ) {
          bestRecord = record;
        }
      }
    }

    if (!bestRecord) {
      // If no record has settings, just use the most recent one
      bestRecord = matchingRecords[0];
    }

    const settings = bestRecord.device_info?.settings || {};

    console.log(
      `[UserService] Using settings from "${bestRecord.user_name}":`,
      settings
    );

    return {
      canonicalName,
      settings,
      foundInRecord: bestRecord.user_name,
      lastSeen: bestRecord.last_seen,
      appVersion: bestRecord.app_version,
    };
  } catch (error) {
    console.error("[UserService] Error fetching settings for name:", error);
    return null;
  }
}

// ============================================
// APPLY SETTINGS TO LOCAL STORAGE
// ============================================
export function applySettings(settings) {
  if (!settings || typeof settings !== "object") {
    return false;
  }

  const settingsKeys = [
    "boardTheme",
    "showInfoBar",
    "showCaseTableDividers",
    "lockAddCaseCard",
    "showStageDividers",
    "autoUpdate",
    "facultySystemManager",
  ];

  let appliedCount = 0;
  const appliedSettings = {};

  settingsKeys.forEach((key) => {
    if (settings[key] !== undefined && settings[key] !== null) {
      try {
        localStorage.setItem(key, settings[key]);
        appliedSettings[key] = settings[key];
        appliedCount++;
        console.log(`[UserService] Applied setting: ${key} = ${settings[key]}`);
      } catch (e) {
        console.warn(`[UserService] Failed to apply setting ${key}:`, e);
      }
    }
  });

  console.log(`[UserService] Applied ${appliedCount} settings`);

  // Dispatch events to notify the app of the changes
  if (appliedCount > 0) {
    // Dispatch a custom event with the applied settings
    // This allows App.jsx to update its state immediately
    window.dispatchEvent(
      new CustomEvent("settings-applied", {
        detail: appliedSettings,
      })
    );

    // Also dispatch the general settings-changed event
    window.dispatchEvent(new Event("settings-changed"));

    // If info bar setting changed, dispatch its specific event
    if (appliedSettings.showInfoBar !== undefined) {
      window.dispatchEvent(new Event("infobar-toggle"));
    }
  }

  return appliedCount > 0;
}
