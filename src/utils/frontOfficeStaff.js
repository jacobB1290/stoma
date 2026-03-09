/**
 * Front Office Staff Utility
 *
 * Manages the list of staff designated as "Front Office".
 * Anyone on the list is front office; everyone else is regular staff.
 *
 * Uses the same name normalization as the rest of the app
 * (getCanonicalName) for consistent deduplication.
 *
 * Storage:
 *   Primary:   `active_devices` table, user_name = "__fo_config__"
 *              device_info.frontOfficeStaff = JSON array of canonical names
 *              This persists across sessions so new logins always get the
 *              current list even if they were offline when it changed.
 *
 *   Secondary: localStorage key "frontOfficeStaff" — instant local access,
 *              hydrated from DB on startup.
 *
 * Realtime sync:
 *   - Broadcast via existing syscmd:settings mechanism so active clients
 *     receive updates immediately (no page reload needed).
 *   - Realtime subscription on the `__fo_config__` row in active_devices
 *     provides a second sync channel.
 */

import { getCanonicalName } from "./nameNormalization";

export const STORAGE_KEY = "frontOfficeStaff";

// The special row we own in active_devices for persistent config storage.
const FO_CONFIG_USER = "__fo_config__";

// ─────────────────────────────────────────────────────────────────────────────
// Core read / write (localStorage — fast, synchronous)
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the current list (canonical names, sorted). */
export function getFrontOfficeList() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persists the list locally.
 * Normalizes names and deduplicates, then fires a `fo-list-updated` event
 * so components (like the pill) can re-query immediately.
 *
 * Does NOT write to DB — call persistFOListToDb() for that.
 */
export function setFrontOfficeList(names) {
  const normalized = Array.from(
    new Set(
      names
        .map((n) => getCanonicalName((n || "").trim()))
        .filter((n) => n.length >= 2)
    )
  ).sort((a, b) => a.localeCompare(b));

  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));

  // Notify same-tab listeners (storage event only fires for other tabs)
  window.dispatchEvent(new CustomEvent("fo-list-updated"));
  // Also synthesise a storage event so cross-tab code works
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: STORAGE_KEY,
      newValue: JSON.stringify(normalized),
    })
  );
}

/** Adds one name; returns true if it was new. */
export function addFrontOfficeStaff(name) {
  const canonical = getCanonicalName((name || "").trim());
  if (!canonical || canonical.length < 2) return false;
  const current = getFrontOfficeList();
  if (current.includes(canonical)) return false;
  setFrontOfficeList([...current, canonical]);
  return true;
}

/** Removes one name by canonical form; returns true if it was present. */
export function removeFrontOfficeStaff(name) {
  const canonical = getCanonicalName((name || "").trim());
  const current = getFrontOfficeList();
  if (!current.includes(canonical)) return false;
  setFrontOfficeList(current.filter((n) => n !== canonical));
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true if the given name belongs to a front office staff member. */
export function isFrontOfficeStaff(name) {
  if (!name) return false;
  return getFrontOfficeList().includes(getCanonicalName(name.trim()));
}

/**
 * Returns the user_name of whoever first created a case.
 * Looks for the earliest "created" entry in the case_history array.
 */
export function getCaseCreator(historyRows) {
  if (!Array.isArray(historyRows) || historyRows.length === 0) return null;
  const sorted = [...historyRows].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );
  const entry =
    sorted.find((h) => (h.action || "").toLowerCase().includes("created")) ||
    sorted[0];
  return entry?.user_name || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Database persistence — active_devices "__fo_config__" row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saves the current FO list to Supabase (active_devices table).
 * Called by SystemManagementScreen whenever the list changes.
 * All other clients fetch this on startup and via realtime subscription.
 */
export async function persistFOListToDb(db) {
  try {
    const list = getFrontOfficeList();
    const deviceInfo = {
      frontOfficeStaff: list,
      updated_at: new Date().toISOString(),
    };

    const payload = {
      user_name: FO_CONFIG_USER,
      device_id: FO_CONFIG_USER,
      last_seen: new Date().toISOString(),
      app_version: "config",
      device_info: deviceInfo,
    };

    // Try device_id conflict first, fall back to user_name
    const conflictTargets = ["device_id", "user_name"];
    for (const target of conflictTargets) {
      const { error } = await db
        .from("active_devices")
        .upsert(payload, { onConflict: target });
      if (!error) return true;
    }
    return false;
  } catch (err) {
    console.warn("[FO] persistFOListToDb failed:", err);
    return false;
  }
}

/**
 * Fetches the FO list from Supabase on startup.
 * If the DB record is newer than what's in localStorage, it wins.
 * Returns true if localStorage was updated.
 */
export async function fetchFOListFromDb(db) {
  try {
    const { data, error } = await db
      .from("active_devices")
      .select("device_info, last_seen")
      .eq("user_name", FO_CONFIG_USER)
      .maybeSingle();

    if (error || !data) return false;

    const incoming = data.device_info?.frontOfficeStaff;
    if (!Array.isArray(incoming)) return false;

    const current = JSON.stringify(getFrontOfficeList());
    const normalized = Array.from(
      new Set(
        incoming
          .map((n) => getCanonicalName((n || "").trim()))
          .filter((n) => n.length >= 2)
      )
    ).sort();
    const next = JSON.stringify(normalized);

    if (current === next) return false; // Already up to date

    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent("fo-list-updated"));
    console.log("[FO] Hydrated front office list from DB:", normalized);
    return true;
  } catch (err) {
    console.warn("[FO] fetchFOListFromDb failed:", err);
    return false;
  }
}

/**
 * Subscribes to realtime changes on the `__fo_config__` row.
 * When another client saves the list, this fires and updates localStorage.
 * Returns the Supabase channel (call db.removeChannel(ch) to clean up).
 */
export function subscribeFOListRealtime(db) {
  const ch = db
    .channel("fo-config-watch")
    .on(
      "postgres_changes",
      {
        schema: "public",
        table: "active_devices",
        event: "*",
        filter: `user_name=eq.${FO_CONFIG_USER}`,
      },
      (ev) => {
        const incoming = ev.new?.device_info?.frontOfficeStaff;
        if (!Array.isArray(incoming)) return;

        const current = JSON.stringify(getFrontOfficeList());
        const normalized = Array.from(
          new Set(
            incoming
              .map((n) => getCanonicalName((n || "").trim()))
              .filter((n) => n.length >= 2)
          )
        ).sort();
        const next = JSON.stringify(normalized);

        if (current === next) return;

        localStorage.setItem(STORAGE_KEY, next);
        window.dispatchEvent(new CustomEvent("fo-list-updated"));
        console.log("[FO] Realtime: front office list updated:", normalized);
      }
    )
    .subscribe();
  return ch;
}

// ─────────────────────────────────────────────────────────────────────────────
// Startup initializer — call once at app boot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called once at app start (from index.js or DataContext).
 *
 * 1. Fetches the latest list from DB to hydrate localStorage.
 * 2. Subscribes to realtime changes so future admin edits propagate.
 * 3. Listens for "settings-applied" events (syscmd broadcast) as a
 *    third sync channel for active clients.
 *
 * Returns a cleanup function.
 */
export function initFrontOfficeSync(db) {
  // 1. Fetch on startup
  fetchFOListFromDb(db).catch(() => {});

  // 2. Realtime subscription
  const ch = subscribeFOListRealtime(db);

  // 3. syscmd "settings-applied" fallback
  const onSettingsApplied = (e) => {
    const detail = e?.detail;
    if (!detail || detail[STORAGE_KEY] === undefined) return;
    try {
      const raw = detail[STORAGE_KEY];
      const incoming = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!Array.isArray(incoming)) return;

      const current = JSON.stringify(getFrontOfficeList());
      const normalized = Array.from(
        new Set(
          incoming
            .map((n) => getCanonicalName((n || "").trim()))
            .filter(Boolean)
        )
      ).sort();
      const next = JSON.stringify(normalized);
      if (current === next) return;

      localStorage.setItem(STORAGE_KEY, next);
      window.dispatchEvent(new CustomEvent("fo-list-updated"));
    } catch {
      // Malformed payload — ignore
    }
  };

  window.addEventListener("settings-applied", onSettingsApplied);

  return () => {
    db.removeChannel(ch);
    window.removeEventListener("settings-applied", onSettingsApplied);
  };
}
