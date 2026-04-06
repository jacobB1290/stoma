// ─────────────────────────────────────────────────────────────────────────────
// System Management Screen — Complete Redesign
// Command center: Dashboard → Performance → Control → History
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import clsx from "clsx";
import { db } from "../services/caseService";
import { fetchActiveUsers } from "../services/userService";
import { useMut } from "../context/DataContext";
import { APP_VERSION } from "../version";
import { calculateStageStatistics } from "../utils/stageTimeCalculations";
import { calculateDepartmentEfficiency } from "../utils/efficiencyCalculations";
import { getFrontOfficeList } from "../utils/frontOfficeStaff";

import {
  STAGES, nowIso, getStatus, stageOfCase, isDigitalGeneral, isOpenCase,
  normalizeForDedup, formatDisplayName, extractUserSettings, getDefaultSettings,
  dateFormatters, dayKey, fmtDate,
} from "./system-management/constants";

import { PipelineOverview, AtRiskPanel, TeamActivity, ActivityFeed } from "./system-management/DashboardTab";
import { StagePerformanceCard, BottleneckAnalysis, ThroughputSummary } from "./system-management/PerformanceTab";
import {
  UserRow, UserSettingsPanel, PushUpdatePanel, FrontOfficePanel, SystemHealthPanel, HistoryPanel,
} from "./system-management/ControlTab";

// ── Toast ──────────────────────────────────────────────────────────────────
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className={clsx("fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-5 py-3 shadow-2xl",
      type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
    )}>
      <span>{type === "success" ? "✓" : "✗"}</span>
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="ml-2 text-white/70 hover:text-white">×</button>
    </div>
  );
}

// ── LoadingSpinner ─────────────────────────────────────────────────────────
function LoadingSpinner({ size = "md" }) {
  const sizes = { sm: "w-4 h-4 border-2", md: "w-6 h-6 border-2", lg: "w-8 h-8 border-3" };
  return <div className={clsx(sizes[size], "border-gray-200 border-t-[#16525F] rounded-full animate-spin")} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SystemManagementScreen() {
  const { rows, allRows, togglePriority, toggleRush, toggleHold } = useMut();

  // ── UI State ─────────────────────────────────────────────────────────────
  const [tab, setTab] = useState("dashboard");
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState(null);

  // ── User Management ──────────────────────────────────────────────────────
  const [activeUsers, setActiveUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false); // eslint-disable-line no-unused-vars
  const [selectedUserKey, setSelectedUserKey] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sending, setSending] = useState(false);
  const [updateNotes, setUpdateNotes] = useState("");
  const [settingsToSend, setSettingsToSend] = useState(getDefaultSettings());
  const [settingsMode, setSettingsMode] = useState("view");

  // ── Front Office ─────────────────────────────────────────────────────────
  const [frontOfficeList, setFrontOfficeListState] = useState(() => getFrontOfficeList());

  // ── History ──────────────────────────────────────────────────────────────
  const [history, setHistory] = useState([]);
  const [historyGroups, setHistoryGroups] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ── Projections ──────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [stageReports, setStageReports] = useState({});
  const [stageStats, setStageStats] = useState({});
  const [projectionsLoaded, setProjectionsLoaded] = useState(false);
  const hasAutoLoadedRef = useRef(false);
  const lastSelectedUserKeyRef = useRef(null);

  // ── Time Ticker ──────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  // ── Computed Data ────────────────────────────────────────────────────────
  const { digitalCases, stageCounts } = useMemo(() => {
    const caseRows = allRows || rows || [];
    const open = caseRows.filter(isOpenCase);
    const digital = open.filter(isDigitalGeneral);
    const counts = { design: 0, production: 0, finishing: 0, qc: 0 };
    digital.forEach(c => { const s = stageOfCase(c); if (s in counts) counts[s]++; });
    return { digitalCases: digital, stageCounts: counts };
  }, [allRows, rows]);

  const overdueCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return digitalCases.filter(c => new Date(c.due) < today).length;
  }, [digitalCases]);

  const holdCount = useMemo(() => digitalCases.filter(c => c.hold).length, [digitalCases]);

  const dueToday = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return digitalCases.filter(c => c.due && new Date(c.due).toISOString().slice(0, 10) === todayStr).length;
  }, [digitalCases]);

  // ── User Processing ──────────────────────────────────────────────────────
  const { allProcessedUsers, userStats } = useMemo(() => {
    const users = activeUsers || [];
    if (users.length === 0) return {
      allProcessedUsers: [],
      userStats: { total: 0, upToDate: 0, outdated: 0, active: 0, idle: 0, offline: 0 },
    };

    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const filtered = users.filter(u => {
      if (!u.last_seen || new Date(u.last_seen) < sevenDaysAgo) return false;
      const name = (u.user_name || "").trim();
      return name.length >= 2 && !/^(test|asdf|qwer|xxx|yyy|zzz|abc|aaa|bbb|\d+)$/i.test(name);
    });

    const grouped = {};
    filtered.forEach(u => {
      const key = normalizeForDedup(u.user_name);
      const existing = grouped[key];
      if (!existing || new Date(u.last_seen) > new Date(existing.last_seen)) grouped[key] = { ...u, _key: key };
    });

    const all = Object.values(grouped).map(u => ({
      ...u, key: u._key,
      status: getStatus(now, u.last_seen),
      isOutdated: u.app_version !== APP_VERSION,
      displayName: formatDisplayName(u.user_name),
      settings: extractUserSettings(u),
    }));

    const sortFn = (a, b) => {
      const order = { active: 0, idle: 1, offline: 2 };
      return (order[a.status] - order[b.status]) || a.displayName.localeCompare(b.displayName);
    };
    all.sort(sortFn);

    return {
      allProcessedUsers: all,
      userStats: {
        total: all.length,
        upToDate: all.filter(u => !u.isOutdated).length,
        outdated: all.filter(u => u.isOutdated).length,
        active: all.filter(u => u.status === "active").length,
        idle: all.filter(u => u.status === "idle").length,
        offline: all.filter(u => u.status === "offline").length,
      },
    };
  }, [activeUsers, now]);

  const filteredUsers = useMemo(() =>
    statusFilter === "all" ? allProcessedUsers : allProcessedUsers.filter(u => u.status === statusFilter),
  [allProcessedUsers, statusFilter]);

  const selectedUser = useMemo(() =>
    selectedUserKey ? allProcessedUsers.find(u => u.key === selectedUserKey) || null : null,
  [allProcessedUsers, selectedUserKey]);

  useEffect(() => {
    if (selectedUser && lastSelectedUserKeyRef.current !== selectedUser.key) {
      lastSelectedUserKeyRef.current = selectedUser.key;
      setSettingsToSend(selectedUser.settings ? { ...getDefaultSettings(), ...selectedUser.settings } : getDefaultSettings());
      setSettingsMode("view");
    } else if (!selectedUser) lastSelectedUserKeyRef.current = null;
  }, [selectedUser]);

  // avgEfficiency available for future use
  // const avgEfficiency = useMemo(() => { ... }, [stageReports]);

  // ── Data Loaders ─────────────────────────────────────────────────────────
  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const data = await fetchActiveUsers();
      setActiveUsers(Array.isArray(data) ? data : []);
    } catch (e) { console.error("Failed to load users", e); }
    finally { setLoadingUsers(false); }
  }, []);

  useEffect(() => {
    loadUsers();
    const t = setInterval(loadUsers, 15000);
    const channel = db.channel("sms-active-devices-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "active_devices" }, () => loadUsers())
      .subscribe();
    return () => { clearInterval(t); db.removeChannel(channel); };
  }, [loadUsers]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const since = new Date();
      since.setDate(since.getDate() - 7);
      const { data, error } = await db.from("case_history")
        .select("case_id,action,created_at,user_name,cases!inner(casenumber,archived)")
        .eq("cases.archived", false)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setHistory(data || []);

      const groups = new Map();
      (data || []).forEach(r => {
        const k = dayKey(r.created_at);
        if (!groups.has(k)) groups.set(k, { label: fmtDate(r.created_at), key: k, rows: [] });
        groups.get(k).rows.push({ ...r, casenumber: r.cases?.casenumber || "—" });
      });
      setHistoryGroups([...groups.values()].sort((a, b) => b.key.localeCompare(a.key)));
    } catch (e) { console.error("Failed to load history", e); }
    finally { setLoadingHistory(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const runProjections = useCallback(async () => {
    setRunning(true);
    setStageReports({});
    setStageStats({});
    try {
      const reports = {};
      const rawStats = {};
      for (const stage of STAGES) {
        const stats = await calculateStageStatistics(stage, () => {});
        rawStats[stage] = stats;
        const rep = await calculateDepartmentEfficiency("Digital", stage, stats, stats?.validCases?.length || 0, () => {});
        reports[stage] = rep;
      }
      setStageReports(reports);
      setStageStats(rawStats);
      setProjectionsLoaded(true);
    } catch (e) { console.error("Projection calc failed", e); }
    finally { setRunning(false); }
  }, []);

  useEffect(() => {
    if (!hasAutoLoadedRef.current && !projectionsLoaded && !running) {
      hasAutoLoadedRef.current = true;
      runProjections();
    }
  }, [projectionsLoaded, running, runProjections]);

  // ── Command Handlers ─────────────────────────────────────────────────────
  const showToast = useCallback((message, type = "success") => setToast({ message, type }), []);

  const sendCommand = useCallback(async (cmd, payload = null) => {
    if (!selectedUser) return showToast("No user selected", "error");
    setSending(true);
    try {
      await db.from("cases").insert({
        casenumber: "force-cmd", department: "General", priority: true,
        modifiers: [`force-syscmd:${cmd}`, `target:${selectedUser.key}`, payload ? `payload:${JSON.stringify(payload)}` : null].filter(Boolean),
        due: nowIso(), completed: false, created_at: nowIso(), archived: false,
      });
      showToast(`Applied to ${selectedUser.displayName}`);
    } catch (e) { console.error("Failed", e); showToast("Command failed", "error"); }
    finally { setSending(false); }
  }, [selectedUser, showToast]);

  const sendUpdate = useCallback(async (priority) => {
    setSending(true);
    try {
      await db.from("cases").insert({
        casenumber: "update", department: "General",
        priority: priority === "high" || priority === "force",
        modifiers: [priority, updateNotes.trim()].filter(Boolean),
        due: nowIso(), completed: false, created_at: nowIso(),
      });
      showToast(`Update pushed (${priority})`);
      setUpdateNotes("");
    } catch (e) { console.error("Failed", e); showToast("Failed to push update", "error"); }
    finally { setSending(false); }
  }, [updateNotes, showToast]);

  const forceRefreshAll = useCallback(async () => {
    setSending(true);
    try {
      await db.from("cases").insert({
        casenumber: "force-cmd", department: "General", priority: true,
        modifiers: ["force-syscmd:restart", "target:all"],
        due: nowIso(), completed: false, created_at: nowIso(), archived: false,
      });
      showToast("Force refresh sent to all clients");
    } catch (e) { showToast("Failed", "error"); }
    finally { setSending(false); }
  }, [showToast]);

  // ── Render ───────────────────────────────────────────────────────────────
  const TABS = [
    { key: "dashboard", label: "Dashboard" },
    { key: "performance", label: "Performance" },
    { key: "control", label: "Control" },
    { key: "history", label: "History" },
  ];

  return (
    <main className="flex-1 overflow-auto bg-gradient-to-br from-gray-100 to-gray-200 pb-44 text-gray-900">
      <div className="mx-auto max-w-7xl p-4 sm:p-6">

        {/* ── Status Bar (always visible) ─────────────────────────────── */}
        <div className="glass-panel rounded-xl p-3 mb-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <span className="text-[10px] uppercase text-gray-500 tracking-wide">Open Cases</span>
              <div className="text-lg font-bold text-gray-800">{digitalCases.length}</div>
            </div>
            <div>
              <span className="text-[10px] uppercase text-gray-500 tracking-wide">Due Today</span>
              <div className={clsx("text-lg font-bold", dueToday > 0 ? "text-amber-600" : "text-gray-800")}>{dueToday}</div>
            </div>
            <div>
              <span className="text-[10px] uppercase text-gray-500 tracking-wide">Overdue</span>
              <div className={clsx("text-lg font-bold", overdueCount > 0 ? "text-red-600" : "text-gray-800")}>
                {overdueCount > 0 && <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse mr-1 align-middle" />}
                {overdueCount}
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase text-gray-500 tracking-wide">On Hold</span>
              <div className={clsx("text-lg font-bold", holdCount > 0 ? "text-amber-500" : "text-gray-800")}>{holdCount}</div>
            </div>
            <div>
              <span className="text-[10px] uppercase text-gray-500 tracking-wide">Active Users</span>
              <div className="text-lg font-bold text-gray-800">
                <span className="text-emerald-600">{userStats.active}</span>
                <span className="text-xs text-gray-400 font-normal ml-1">{userStats.idle > 0 && `+${userStats.idle} idle`}</span>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-gray-400">v{APP_VERSION}</span>
              <span className="text-xs text-gray-400">{dateFormatters.fullDateTime.format(new Date())}</span>
              <button onClick={runProjections} disabled={running}
                className={clsx("px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  running ? "bg-gray-100 text-gray-400" : "bg-[#16525F] text-white hover:bg-[#0f3f4a]"
                )}>
                {running ? <span className="flex items-center gap-1"><LoadingSpinner size="sm" /> Calculating...</span> : "Refresh Data"}
              </button>
            </div>
          </div>
        </div>

        {/* ── Tab Navigation ──────────────────────────────────────────── */}
        <nav className="mb-5 flex gap-1 glass-panel p-1 rounded-xl">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={clsx("whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all",
                tab === t.key ? "bg-[#16525F] text-white shadow" : "text-gray-600 hover:bg-gray-100"
              )}>{t.label}</button>
          ))}
        </nav>

        {/* ── Tab Content ─────────────────────────────────────────────── */}

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div className="space-y-5">
            <PipelineOverview stageCounts={stageCounts} stageReports={stageReports} stageStats={stageStats} />
            <div className="grid gap-5 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <AtRiskPanel cases={digitalCases} stageReports={stageReports}
                  onTogglePriority={togglePriority} onToggleHold={toggleHold} onToggleRush={toggleRush} />
              </div>
              <div className="lg:col-span-2 space-y-5">
                <TeamActivity users={allProcessedUsers} recentHistory={history} />
                <ActivityFeed history={history} />
              </div>
            </div>
          </div>
        )}

        {/* PERFORMANCE */}
        {tab === "performance" && (
          <div className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-3">
              {STAGES.map(stage => (
                <StagePerformanceCard key={stage} stage={stage} report={stageReports[stage]} stats={stageStats[stage]} />
              ))}
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <BottleneckAnalysis stageReports={stageReports} stageStats={stageStats} />
              <ThroughputSummary cases={digitalCases} history={history} />
            </div>
          </div>
        )}

        {/* CONTROL */}
        {tab === "control" && (
          <div className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-5" style={{ minHeight: 500 }}>
              {/* User List */}
              <div className="lg:col-span-3 glass-panel rounded-xl overflow-hidden flex flex-col">
                <div className="px-4 py-3 bg-white/70 border-b border-gray-200/30 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-800">Users</h3>
                  <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">{userStats.upToDate} current</span>
                  {userStats.outdated > 0 && <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">{userStats.outdated} outdated</span>}
                  <div className="flex-1" />
                  <div className="flex rounded bg-gray-100 p-0.5">
                    {[{ key: "all", label: "All" }, { key: "active" }, { key: "idle" }, { key: "offline" }].map(f => (
                      <button key={f.key} onClick={() => setStatusFilter(f.key)}
                        className={clsx("px-2 py-1 text-xs rounded capitalize", statusFilter === f.key ? "bg-white text-gray-800 shadow-sm" : "text-gray-500")}>
                        {f.label || f.key}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="divide-y divide-gray-50 overflow-y-auto flex-1">
                  {filteredUsers.map(u => (
                    <UserRow key={u.key} user={u} isSelected={selectedUserKey === u.key} onSelect={setSelectedUserKey} />
                  ))}
                  {filteredUsers.length === 0 && <div className="p-8 text-center text-gray-400 text-sm">No users match filter</div>}
                </div>
              </div>

              {/* Right Panel */}
              <div className="lg:col-span-2 space-y-4">
                {selectedUser ? (
                  <div className="glass-panel rounded-xl overflow-hidden">
                    <div className="p-3 border-b border-gray-100 flex items-center gap-2">
                      <div className={clsx("flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white",
                        selectedUser.isOutdated ? "bg-gradient-to-br from-amber-500 to-orange-600" : "bg-gradient-to-br from-emerald-500 to-teal-600"
                      )}>{selectedUser.displayName.charAt(0)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-gray-800 truncate">{selectedUser.displayName}</div>
                        <div className="text-xs text-gray-500">
                          {selectedUser.status === "active" ? "Online" : selectedUser.status} · v{selectedUser.app_version || "?"}
                        </div>
                      </div>
                      <button onClick={() => setSelectedUserKey(null)} className="p-1 text-gray-400 hover:text-gray-600">✕</button>
                    </div>
                    <UserSettingsPanel selectedUser={selectedUser} settingsToSend={settingsToSend} settingsMode={settingsMode}
                      onSettingsChange={(k, v) => setSettingsToSend(c => ({ ...c, [k]: v }))}
                      onModeChange={setSettingsMode}
                      onApplySettings={() => sendCommand("force-settings", { settings: settingsToSend })}
                      onForceRestart={() => sendCommand("force-restart")}
                      sending={sending} />
                  </div>
                ) : (
                  <div className="glass-panel rounded-xl flex items-center justify-center p-8">
                    <div className="text-center text-gray-400">
                      <div className="text-3xl mb-2">👆</div>
                      <p className="text-sm">Select a user to manage</p>
                    </div>
                  </div>
                )}

                <PushUpdatePanel updateNotes={updateNotes} onNotesChange={setUpdateNotes}
                  onSendUpdate={sendUpdate} sending={sending} userStats={userStats} />
                <SystemHealthPanel userStats={userStats} onForceRefreshAll={forceRefreshAll} sending={sending} />
                <FrontOfficePanel frontOfficeList={frontOfficeList}
                  onListChange={() => setFrontOfficeListState(getFrontOfficeList())} />
              </div>
            </div>
          </div>
        )}

        {/* HISTORY */}
        {tab === "history" && (
          <HistoryPanel historyGroups={historyGroups} loadingHistory={loadingHistory} onRefresh={loadHistory} />
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </main>
  );
}
