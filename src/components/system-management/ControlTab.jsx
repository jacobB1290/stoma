// ─────────────────────────────────────────────────────────────────────────────
// Control & History Tab Components
// ─────────────────────────────────────────────────────────────────────────────

import React, { memo, useMemo, useState, useCallback } from "react";
import clsx from "clsx";
import { db } from "../../services/caseService";
import { APP_VERSION } from "../../version";
import { getCanonicalName, getAllCanonicalNames } from "../../utils/nameNormalization";
import {
  addFrontOfficeStaff,
  removeFrontOfficeStaff,
  persistFOListToDb,
} from "../../utils/frontOfficeStaff";
import {
  SETTING_DEFINITIONS,
  fmtTimeAgo, getDefaultSettings,
  broadcastFOList, fmtTime,
} from "./constants";
import { StatusDot } from "./DashboardTab";

// ── UserRow ────────────────────────────────────────────────────────────────
export const UserRow = memo(function UserRow({ user, isSelected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(user.key)}
      className={clsx(
        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all",
        isSelected ? "bg-[#16525F]/10 border-l-2 border-[#16525F]" : "hover:bg-gray-50 border-l-2 border-transparent",
        user.status === "offline" && !isSelected && "opacity-60"
      )}
    >
      <StatusDot status={user.status} size="small" />
      <div className={clsx("flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white flex-shrink-0",
        user.isOutdated ? "bg-gradient-to-br from-amber-500 to-orange-600" : "bg-gradient-to-br from-emerald-500 to-teal-600"
      )}>{user.displayName.charAt(0)}</div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm text-gray-800 truncate">{user.displayName}</div>
        <div className="text-xs text-gray-500">{fmtTimeAgo(user.last_seen)}</div>
      </div>
      <span className={clsx("font-mono text-[10px] px-1.5 py-0.5 rounded flex-shrink-0",
        user.isOutdated ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
      )}>v{user.app_version || "?"}</span>
    </button>
  );
});

// ── UserSettingsPanel ──────────────────────────────────────────────────────
export const UserSettingsPanel = memo(function UserSettingsPanel({
  selectedUser, settingsToSend, settingsMode, onSettingsChange, onModeChange, onApplySettings, onForceRestart, sending,
}) {
  const displaySettings = useMemo(() => {
    const defaults = getDefaultSettings();
    return selectedUser?.settings ? { ...defaults, ...selectedUser.settings } : defaults;
  }, [selectedUser]);

  const hasChanges = useMemo(() => {
    if (settingsMode !== "edit") return false;
    return SETTING_DEFINITIONS.some(s => settingsToSend[s.key] !== displaySettings[s.key]);
  }, [settingsMode, settingsToSend, displaySettings]);

  const formatValue = (key, value) => {
    if (value === undefined || value === null) return "—";
    if (typeof value === "boolean") return value ? "On" : "Off";
    if (key === "boardTheme") return value.charAt(0).toUpperCase() + value.slice(1);
    return String(value);
  };

  return (
    <div className="p-3 flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-gray-700">Settings</h4>
        <div className="flex rounded bg-gray-100 p-0.5">
          {["view", "edit"].map(mode => (
            <button key={mode} onClick={() => onModeChange(mode)}
              className={clsx("px-2 py-0.5 rounded text-xs transition-all capitalize",
                settingsMode === mode ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"
              )}>{mode}</button>
          ))}
        </div>
      </div>

      <div className="space-y-1 flex-1 overflow-y-auto">
        {SETTING_DEFINITIONS.map(setting => {
          const viewValue = displaySettings[setting.key];
          const editValue = settingsToSend[setting.key];
          const changed = settingsMode === "edit" && editValue !== displaySettings[setting.key];
          const displayViewValue = setting.invert && typeof viewValue === "boolean" ? !viewValue : viewValue;
          const displayEditValue = setting.invert && typeof editValue === "boolean" ? !editValue : editValue;

          return (
            <div key={setting.key} className={clsx("rounded px-2 py-1.5 flex items-center justify-between", changed ? "bg-[#16525F]/10" : "bg-gray-50")}>
              <span className="text-xs text-gray-600">{setting.label}</span>
              {settingsMode === "view" ? (
                <span className={clsx("text-xs font-medium",
                  typeof displayViewValue === "boolean" ? (displayViewValue ? "text-emerald-600" : "text-gray-400") : "text-gray-700"
                )}>{formatValue(setting.key, displayViewValue)}</span>
              ) : setting.type === "toggle" ? (
                <button onClick={() => onSettingsChange(setting.key, !editValue)}
                  className={clsx("relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full transition-colors",
                    displayEditValue ? "bg-[#16525F]" : "bg-gray-300"
                  )}>
                  <span className={clsx("inline-block h-3 w-3 rounded-full bg-white shadow transition-transform mt-0.5",
                    displayEditValue ? "translate-x-3.5 ml-0.5" : "translate-x-0.5"
                  )} />
                </button>
              ) : (
                <select value={editValue || ""} onChange={e => onSettingsChange(setting.key, e.target.value)}
                  className="rounded bg-white border border-gray-200 px-1.5 py-0.5 text-xs">
                  {setting.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>

      {settingsMode === "edit" && (
        <div className="flex gap-2 mt-2 pt-2 border-t border-gray-100">
          <button onClick={onApplySettings} disabled={sending || !hasChanges}
            className={clsx("flex-1 rounded py-1.5 text-xs font-semibold transition-all",
              hasChanges ? "bg-[#16525F] text-white" : "bg-gray-100 text-gray-400"
            )}>{sending ? "..." : "Apply"}</button>
          <button onClick={onForceRestart} disabled={sending}
            className="flex-1 rounded bg-amber-50 border border-amber-200 py-1.5 text-xs font-semibold text-amber-700">Restart</button>
        </div>
      )}
    </div>
  );
});

// ── PushUpdatePanel ────────────────────────────────────────────────────────
export const PushUpdatePanel = memo(function PushUpdatePanel({ updateNotes, onNotesChange, onSendUpdate, sending, userStats }) {
  return (
    <div className="glass-panel p-4 rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-800">Push Update</h4>
        <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{userStats.total} users</span>
      </div>
      <textarea rows={2} value={updateNotes} onChange={e => onNotesChange(e.target.value)}
        placeholder="Release notes or message..."
        className="w-full rounded-lg border border-gray-200 bg-white p-2 text-sm placeholder-gray-400 resize-none mb-2" />
      {userStats.outdated > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-2">
          {userStats.outdated} user{userStats.outdated !== 1 ? "s" : ""} on older version
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => onSendUpdate("normal")} disabled={sending}
          className="rounded-lg bg-blue-600 hover:bg-blue-700 py-1.5 text-xs font-medium text-white disabled:opacity-50">Normal</button>
        <button onClick={() => onSendUpdate("high")} disabled={sending}
          className="rounded-lg bg-gradient-to-r from-orange-500 to-red-500 py-1.5 text-xs font-medium text-white disabled:opacity-50">High</button>
        <button onClick={() => onSendUpdate("force")} disabled={sending}
          className="rounded-lg bg-gray-600 hover:bg-gray-700 py-1.5 text-xs font-medium text-white disabled:opacity-50">Force</button>
      </div>
    </div>
  );
});

// ── FrontOfficePanel ───────────────────────────────────────────────────────
export const FrontOfficePanel = memo(function FrontOfficePanel({ frontOfficeList, onListChange }) {
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState("");
  const [suggestions, setSuggestions] = useState([]);

  const handleAdd = useCallback(async (name) => {
    const canonical = getCanonicalName((name || inputValue).trim());
    if (!canonical || canonical.length < 2) { setInputError("Enter a valid name."); return; }
    if (frontOfficeList.includes(canonical)) { setInputError(`${canonical} already listed.`); return; }
    const ok = addFrontOfficeStaff((name || inputValue).trim());
    if (ok) {
      onListChange();
      setInputValue("");
      setSuggestions([]);
      setInputError("");
      broadcastFOList();
      persistFOListToDb(db);
    }
  }, [inputValue, frontOfficeList, onListChange]);

  return (
    <div className="glass-panel p-4 rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-800">Front Office Staff</h4>
        <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{frontOfficeList.length}</span>
      </div>
      <p className="text-[11px] text-gray-400 mb-3">Staff here are Front Office. Cases by others count as "staff-entered".</p>

      <div className="flex gap-2 mb-2 relative">
        <div className="flex-1 relative">
          <input type="text" value={inputValue}
            onChange={e => {
              setInputValue(e.target.value);
              setInputError("");
              const val = e.target.value.trim();
              if (val.length >= 2) {
                const lower = val.toLowerCase();
                setSuggestions(getAllCanonicalNames().filter(n => n.toLowerCase().includes(lower) && !frontOfficeList.includes(n)).slice(0, 6));
              } else setSuggestions([]);
            }}
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
            onBlur={() => setTimeout(() => setSuggestions([]), 150)}
            placeholder="Type a name..."
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:border-[#16525F] focus:outline-none focus:ring-2 focus:ring-[#16525F]/20" />
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
              {suggestions.map(s => (
                <button key={s} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"
                  onMouseDown={e => { e.preventDefault(); handleAdd(s); }}>{s}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => handleAdd()}
          className="rounded-lg bg-[#16525F] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f3f4a] flex-shrink-0">Add</button>
      </div>
      {inputError && <p className="mb-2 text-xs text-red-500">{inputError}</p>}

      {frontOfficeList.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-6 text-center">
          <p className="text-sm text-gray-400">No front office staff designated yet.</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {frontOfficeList.map(name => (
            <span key={name} className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 pl-3 pr-1.5 py-1 text-sm font-medium text-indigo-800">
              {name}
              <button onClick={() => { removeFrontOfficeStaff(name); onListChange(); broadcastFOList(); persistFOListToDb(db); }}
                className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-200 hover:bg-indigo-300 text-indigo-600">
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

// ── SystemHealthPanel ──────────────────────────────────────────────────────
export const SystemHealthPanel = memo(function SystemHealthPanel({ userStats, onForceRefreshAll, sending }) {
  const pct = userStats.total > 0 ? Math.round((userStats.upToDate / userStats.total) * 100) : 0;

  return (
    <div className="glass-panel p-4 rounded-xl">
      <h4 className="text-sm font-semibold text-gray-800 mb-3">System Health</h4>
      <div className="space-y-2">
        {[
          { label: "App Version", value: `v${APP_VERSION}`, cls: "text-emerald-600 font-mono" },
          { label: "Connected Clients", value: userStats.total },
          { label: "Active Now", value: userStats.active, cls: "text-emerald-600" },
          { label: "Idle", value: userStats.idle, cls: "text-amber-600" },
          { label: "Offline", value: userStats.offline, cls: "text-gray-400" },
        ].map(row => (
          <div key={row.label} className="flex items-center justify-between py-1">
            <span className="text-xs text-gray-500">{row.label}</span>
            <span className={clsx("text-xs font-medium", row.cls || "text-gray-800")}>{row.value}</span>
          </div>
        ))}
        <div className="space-y-1 py-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Up to Date</span>
            <span className="text-xs text-gray-700 font-medium">{userStats.upToDate} / {userStats.total}</span>
          </div>
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <div className="pt-3 mt-2 border-t border-gray-100">
        <button onClick={onForceRefreshAll} disabled={sending}
          className={clsx("w-full text-xs font-medium py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 transition-colors", sending && "opacity-50")}>
          {sending ? "Sending..." : "Force Refresh All"}
        </button>
        <p className="text-[10px] text-gray-400 text-center mt-1">Reloads all connected browsers</p>
      </div>
    </div>
  );
});

// ── HistoryRow ─────────────────────────────────────────────────────────────
export const HistoryRow = memo(function HistoryRow({ row }) {
  const [num, desc] = useMemo(() => {
    const s = row.casenumber || "";
    const t = s.replace(/[()]/g, "").replace(/\s*-\s*/, " ").trim().split(/\s+/);
    return [t.shift() || "", t.join(" ")];
  }, [row.casenumber]);

  return (
    <div className="grid grid-cols-[1fr_auto_auto_1fr] gap-3 items-start px-4 py-2 hover:bg-gray-50 transition-colors">
      <div className="min-w-0">
        <div className="font-mono text-sm text-gray-800">{num}</div>
        {desc && <div className="text-[10px] text-gray-500">{desc}</div>}
      </div>
      <div className="text-sm text-gray-600 whitespace-nowrap">{fmtTime(row.created_at)}</div>
      <div className="text-sm text-gray-600 whitespace-nowrap max-w-[120px] truncate">{row.user_name}</div>
      <div className="text-sm text-right text-gray-600">{row.action}</div>
    </div>
  );
});

// ── DaySection ─────────────────────────────────────────────────────────────
export const DaySection = memo(function DaySection({ group }) {
  return (
    <section className="mb-4">
      <div className="rounded-xl overflow-hidden bg-white/60 border border-white/50 shadow-sm">
        <div className="px-4 py-2 font-bold text-gray-800 bg-white/80 border-b border-gray-200/30">{group.label}</div>
        <div className="grid grid-cols-[1fr_auto_auto_1fr] gap-3 px-4 py-1.5 text-[10px] font-semibold uppercase text-gray-500 bg-white/50 border-b border-gray-100">
          <span>Case #</span><span>Time</span><span>User</span><span className="text-right">Action</span>
        </div>
        <div className="divide-y divide-gray-100/50">
          {group.rows.map((row, idx) => <HistoryRow key={`${row.created_at}-${idx}`} row={row} />)}
        </div>
      </div>
    </section>
  );
});

// ── HistoryPanel ───────────────────────────────────────────────────────────
export const HistoryPanel = memo(function HistoryPanel({ historyGroups, loadingHistory, onRefresh }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  const filteredGroups = useMemo(() => {
    if (!searchTerm && !userFilter && actionFilter === "all") return historyGroups;
    return historyGroups.map(group => {
      const rows = group.rows.filter(row => {
        if (searchTerm && !(row.casenumber || "").toLowerCase().includes(searchTerm.toLowerCase())) return false;
        if (userFilter && !(row.user_name || "").toLowerCase().includes(userFilter.toLowerCase())) return false;
        if (actionFilter !== "all") {
          const a = (row.action || "").toLowerCase();
          if (actionFilter === "created" && !a.includes("created")) return false;
          if (actionFilter === "completed" && !a.includes("marked done")) return false;
          if (actionFilter === "moved" && !a.includes("moved")) return false;
          if (actionFilter === "archived" && !a.includes("archived")) return false;
        }
        return true;
      });
      return rows.length > 0 ? { ...group, rows } : null;
    }).filter(Boolean);
  }, [historyGroups, searchTerm, userFilter, actionFilter]);

  return (
    <div className="glass-panel overflow-hidden rounded-xl" style={{ height: "calc(100vh - 280px)" }}>
      <header className="flex flex-wrap items-center gap-2 px-4 py-3 bg-white/70 border-b border-gray-200/30">
        <h2 className="text-lg font-semibold text-gray-800">Case History</h2>
        <div className="flex-1" />
        <input type="text" placeholder="Search case #..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm w-36 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#16525F]/30" />
        <input type="text" placeholder="Filter user..." value={userFilter} onChange={e => setUserFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm w-32 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#16525F]/30" />
        <div className="flex rounded bg-gray-100 p-0.5">
          {[{ key: "all", label: "All" }, { key: "created", label: "Created" }, { key: "completed", label: "Done" }, { key: "moved", label: "Moved" }].map(f => (
            <button key={f.key} onClick={() => setActionFilter(f.key)}
              className={clsx("px-2 py-1 text-xs rounded", actionFilter === f.key ? "bg-white text-gray-800 shadow-sm" : "text-gray-500")}>{f.label}</button>
          ))}
        </div>
        <button onClick={onRefresh} disabled={loadingHistory}
          className="px-3 py-1.5 text-sm bg-white/60 hover:bg-white/80 border border-white/50 rounded-lg">
          {loadingHistory ? "Loading..." : "Refresh"}
        </button>
      </header>
      <div className="overflow-y-auto p-4" style={{ height: "calc(100% - 60px)" }}>
        {filteredGroups.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No history entries found</div>
        ) : filteredGroups.map(group => <DaySection key={group.key} group={group} />)}
      </div>
    </div>
  );
});
