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
const DB_VERSION = 2;          // bumped: added deviceId key
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
      const idb = event.target.result;
      if (!idb.objectStoreNames.contains(STORE_NAME)) {
        idb.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
      // v2: no schema change needed, the store already supports any key
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
    const idb = await openDB();
    return new Promise((resolve) => {
      const transaction = idb.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get("userName");

      request.onsuccess = () => {
        const result = request.result?.value || null;
        cachedIndexedDBName = result;
        resolve(result);
      };

      request.onerror = () => { resolve(null); };
    });
  } catch (e) {
    console.warn("[IndexedDB] Load failed:", e);
    return null;
  }
}

// ============================================================================
// DEVICE ID — stable per browser install
// Stored in IndexedDB so it survives Chrome profile switches / localStorage
// clears. Used to look up the user's name from Supabase when all local
// storage is empty (the "wrong Google profile" scenario).
// ============================================================================

let cachedDeviceId = null;

export async function getOrCreateDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    const idb = await openDB();

    const existing = await new Promise((resolve) => {
      const tx  = idb.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get("deviceId");
      req.onsuccess = () => resolve(req.result?.value || null);
      req.onerror  = () => resolve(null);
    });

    if (existing) {
      cachedDeviceId = existing;
      return existing;
    }

    const newId = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const tx = idb.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ key: "deviceId", value: newId });

    cachedDeviceId = newId;
    console.log("[DeviceId] Created new device ID:", newId);
    return newId;
  } catch (e) {
    console.warn("[DeviceId] Could not persist device ID:", e);
    if (!cachedDeviceId) cachedDeviceId = `tmp-${Date.now()}`;
    return cachedDeviceId;
  }
}

/**
 * Helper — write a userName cookie that lasts 2 years.
 */
function setLongCookie(name) {
  try {
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 2);
    document.cookie =
      `userName=${encodeURIComponent(name)};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
  } catch { /* ignore */ }
}

/**
 * Ask Supabase: "what user_name did this device last log in as?"
 * Returns the name string, or null if not found / error.
 */
export async function lookupNameByDeviceId() {
  try {
    const deviceId = await getOrCreateDeviceId();
    if (!deviceId || deviceId.startsWith("tmp-")) return null;

    const { data, error } = await db
      .from("active_devices")
      .select("user_name")
      .eq("device_id", deviceId)
      .order("last_seen", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data?.user_name) return null;

    console.log("[DeviceId] Restored name from Supabase:", data.user_name);
    return data.user_name;
  } catch (e) {
    console.warn("[DeviceId] Supabase lookup failed:", e);
    return null;
  }
}

async function clearIndexedDB() {
  try {
    const idb = await openDB();
    const transaction = idb.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.delete("userName");
    // NOTE: deviceId is intentionally kept so the device can still be
    // recognised by Supabase after the user logs out / switches profiles.
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
    initPromise = (async () => {
      const indexedDBName = await loadFromIndexedDB();
      const localName     = localStorage.getItem("userName");
      const cookieName    = getCookie("userName");

      if (!localName && indexedDBName) {
        // ── Restore from IndexedDB (e.g. localStorage cleared) ─────────
        console.log("[Storage] Restoring name from IndexedDB:", indexedDBName);
        try { localStorage.setItem("userName", indexedDBName); } catch { /* ignore */ }
        setLongCookie(indexedDBName);

      } else if (!localName && !indexedDBName && cookieName) {
        // ── Restore from cookie ─────────────────────────────────────────
        console.log("[Storage] Restoring name from cookie:", cookieName);
        try { localStorage.setItem("userName", cookieName); } catch { /* ignore */ }
        await saveToIndexedDB(cookieName);

      } else if (!localName && !indexedDBName && !cookieName) {
        // ── All local storage empty → try Supabase device-ID lookup ────
        // This covers the Chrome-profile-switch scenario.
        const supabaseName = await lookupNameByDeviceId();
        if (supabaseName) {
          console.log("[Storage] Restored name from Supabase device lookup:", supabaseName);
          try { localStorage.setItem("userName", supabaseName); } catch { /* ignore */ }
          await saveToIndexedDB(supabaseName);
          setLongCookie(supabaseName);
        }

      } else if (localName && !indexedDBName) {
        // ── Sync localStorage → IndexedDB ───────────────────────────────
        console.log("[Storage] Syncing existing name to IndexedDB:", localName);
        await saveToIndexedDB(localName);
        setLongCookie(localName);
      }

      // Ensure device ID is initialised (creates it if first run)
      await getOrCreateDeviceId();

      return true;
    })();
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
    const deviceId = await getOrCreateDeviceId();

    const basePayload = {
      user_name:   userName,
      app_version: APP_VERSION,
      last_seen:   new Date().toISOString(),
      device_id:   deviceId,
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
let heartbeatListenersAttached = false;

export function startHeartbeat() {
  log("=== STARTING HEARTBEAT SYSTEM ===");

  isTabVisible = document.visibilityState === "visible";
  log(`Initial visibility: ${isTabVisible}`);

  startHeartbeatTimer();

  // Guard: only attach listeners once to prevent accumulation
  if (!heartbeatListenersAttached) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("beforeunload", handleBeforeUnload);

    window.addEventListener("mousedown", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("scroll", handleActivity, { passive: true });
    window.addEventListener("touchstart", handleActivity, { passive: true });

    heartbeatListenersAttached = true;
    log("All event listeners attached");
  } else {
    log("Event listeners already attached, skipping");
  }
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

  heartbeatListenersAttached = false;
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
