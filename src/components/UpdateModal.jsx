import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import { SPRING } from "../animationEngine";
import { db } from "../services/caseService";
import { fetchActiveUsers } from "../services/userService";
import { APP_VERSION } from "../version";
import { getCanonicalName } from "../utils/nameNormalization";

export default function UpdateModal({ open, onClose }) {
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [usersData, setUsersData] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedPriority, setSelectedPriority] = useState(null);
  const [now, setNow] = useState(Date.now());

  const stableOrderRef = useRef({ outdated: [], current: [] });
  const prevStatusTierRef = useRef({});

  const loadUsers = useCallback(async () => {
    try {
      const data = await fetchActiveUsers();
      setUsersData(data);
    } catch (error) {
      console.error("Failed to load users:", error);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setLoadingUsers(true);
      loadUsers().finally(() => setLoadingUsers(false));
      setSelectedPriority(null);
      setNotes("");
    } else {
      stableOrderRef.current = { outdated: [], current: [] };
      prevStatusTierRef.current = {};
    }
  }, [open, loadUsers]);

  useEffect(() => {
    if (!open) return;

    const channel = db
      .channel("active-devices-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "active_devices",
        },
        () => loadUsers()
      )
      .subscribe();

    return () => db.removeChannel(channel);
  }, [open, loadUsers]);

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(loadUsers, 15000);
    return () => clearInterval(interval);
  }, [open, loadUsers]);

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, [open]);

  const getStatus = useCallback(
    (lastSeen) => {
      if (!lastSeen) return "offline";

      const lastSeenTime = new Date(lastSeen).getTime();
      const diffMs = now - lastSeenTime;
      const diffSeconds = diffMs / 1000;

      if (diffSeconds < 45) return "active";
      if (diffSeconds < 330) return "idle";
      return "offline";
    },
    [now]
  );

  /**
   * Normalizes a username for duplicate detection.
   * Uses the centralized name normalization utility which handles:
   * - Case variations (brenda vs Brenda vs BRENDA)
   * - Typos (dgital vs digital, yarz vs yara)
   * - Formatting differences (Design 2 vs Design #2)
   * - Abbreviations (j vs jacob, h vs henry)
   * - Full names vs short names (Jacob vs Jacob Babichenko)
   */
  function normalizeForDedup(name) {
    if (!name) return "";
    // Use the canonical name as the dedup key
    return getCanonicalName(name).toLowerCase();
  }

  function formatDisplayName(name) {
    if (!name) return "Unknown";
    return name
      .trim()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }

  const formatDate = useCallback(
    (dateString) => {
      if (!dateString) return "—";
      const date = new Date(dateString);
      const diffMs = now - date.getTime();
      const diffSecs = Math.floor(diffMs / 1000);
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffSecs < 25) return "Now";
      if (diffSecs < 60) return `${diffSecs}s`;
      if (diffMins < 60) return `${diffMins}m`;
      if (diffHours < 24) return `${diffHours}h`;
      if (diffDays < 7) return `${diffDays}d`;

      return `${date.getMonth() + 1}/${date.getDate()}`;
    },
    [now]
  );

  const { outdatedUsers, currentUsers, userStats } = useMemo(() => {
    if (!usersData || usersData.length === 0) {
      return {
        outdatedUsers: [],
        currentUsers: [],
        userStats: {
          total: 0,
          upToDate: 0,
          outdated: 0,
          active: 0,
          idle: 0,
          offline: 0,
        },
      };
    }

    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    // Initial filter
    let filtered = usersData.filter((user) => {
      if (!user.last_seen) return false;
      const lastSeen = new Date(user.last_seen);
      if (lastSeen < sevenDaysAgo) return false;
      const name = (user.user_name || "").trim();
      if (name.length < 2) return false;
      // Filter out obvious test entries
      const testPatterns = /^(test|asdf|qwer|xxx|yyy|zzz|abc|aaa|bbb|\d+)$/i;
      return !testPatterns.test(name);
    });

    // Dedupe using normalized keys
    // Group by normalized name, keep the most recent entry
    // But preserve the best display name (prefer ones with proper formatting)
    const grouped = {};
    filtered.forEach((user) => {
      const normalizedKey = normalizeForDedup(user.user_name);
      const existing = grouped[normalizedKey];

      if (!existing) {
        grouped[normalizedKey] = {
          ...user,
          _normalizedKey: normalizedKey,
        };
      } else {
        // Keep the most recent last_seen
        const existingTime = new Date(existing.last_seen).getTime();
        const currentTime = new Date(user.last_seen).getTime();

        if (currentTime > existingTime) {
          // Use newer data but consider keeping better display name
          const existingName = existing.user_name || "";
          const currentName = user.user_name || "";

          // Prefer names with proper casing (has uppercase) and special chars like #
          const existingScore = getNameQualityScore(existingName);
          const currentScore = getNameQualityScore(currentName);

          grouped[normalizedKey] = {
            ...user,
            // Keep the better formatted name for display
            user_name:
              currentScore >= existingScore ? currentName : existingName,
            // But use the most recent version/last_seen
            app_version: user.app_version,
            last_seen: user.last_seen,
            _normalizedKey: normalizedKey,
          };
        } else {
          // Keep existing but maybe update version if current is newer
          // (in case someone updated but old entry has more recent heartbeat)
          if (user.app_version && existing.app_version) {
            if (isNewerVersion(user.app_version, existing.app_version)) {
              grouped[normalizedKey] = {
                ...existing,
                app_version: user.app_version,
              };
            }
          }
        }
      }
    });

    // Helper to score name quality for choosing best display name
    function getNameQualityScore(name) {
      let score = 0;
      // Has uppercase letters (properly cased)
      if (/[A-Z]/.test(name)) score += 2;
      // Has # before number (e.g., "Design #2")
      if (/#\d/.test(name)) score += 1;
      // Longer names are usually more complete
      score += Math.min(name.length / 10, 1);
      return score;
    }

    // Helper to compare versions
    function isNewerVersion(v1, v2) {
      const parse = (v) => (v || "0").split(".").map(Number);
      const [a, b] = [parse(v1), parse(v2)];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) > (b[i] || 0)) return true;
        if ((a[i] || 0) < (b[i] || 0)) return false;
      }
      return false;
    }

    const allUsers = Object.values(grouped).map((user) => ({
      ...user,
      key: user._normalizedKey,
      status: getStatus(user.last_seen),
      isOutdated: user.app_version !== APP_VERSION,
      displayName: formatDisplayName(user.user_name),
    }));

    const currentTiers = {};
    allUsers.forEach((u) => {
      currentTiers[u.key] = u.status;
    });

    let needsReorder = false;
    const isFirstLoad = Object.keys(prevStatusTierRef.current).length === 0;

    if (isFirstLoad) {
      needsReorder = true;
    } else {
      const prevKeys = new Set(Object.keys(prevStatusTierRef.current));
      const currKeys = new Set(Object.keys(currentTiers));

      for (const key of currKeys) {
        if (!prevKeys.has(key)) {
          needsReorder = true;
          break;
        }
      }

      for (const key of prevKeys) {
        if (!currKeys.has(key)) {
          needsReorder = true;
          break;
        }
      }

      if (!needsReorder) {
        for (const [key, tier] of Object.entries(currentTiers)) {
          if (prevStatusTierRef.current[key] !== tier) {
            needsReorder = true;
            break;
          }
        }
      }
    }

    prevStatusTierRef.current = currentTiers;

    const outdated = allUsers.filter((u) => u.isOutdated);
    const current = allUsers.filter((u) => !u.isOutdated);

    const sortFn = (a, b) => {
      const statusOrder = { active: 0, idle: 1, offline: 2 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }

      if (a.status === "offline") {
        return new Date(b.last_seen) - new Date(a.last_seen);
      }

      return a.displayName.localeCompare(b.displayName);
    };

    let finalOutdated, finalCurrent;

    if (needsReorder || stableOrderRef.current.outdated.length === 0) {
      outdated.sort(sortFn);
      current.sort(sortFn);

      stableOrderRef.current = {
        outdated: outdated.map((u) => u.key),
        current: current.map((u) => u.key),
      };

      finalOutdated = outdated;
      finalCurrent = current;
    } else {
      const outdatedMap = Object.fromEntries(outdated.map((u) => [u.key, u]));
      const currentMap = Object.fromEntries(current.map((u) => [u.key, u]));

      finalOutdated = stableOrderRef.current.outdated
        .filter((key) => outdatedMap[key])
        .map((key) => outdatedMap[key]);

      finalCurrent = stableOrderRef.current.current
        .filter((key) => currentMap[key])
        .map((key) => currentMap[key]);

      outdated.forEach((u) => {
        if (!stableOrderRef.current.outdated.includes(u.key)) {
          finalOutdated.push(u);
        }
      });
      current.forEach((u) => {
        if (!stableOrderRef.current.current.includes(u.key)) {
          finalCurrent.push(u);
        }
      });
    }

    const stats = {
      total: allUsers.length,
      upToDate: current.length,
      outdated: outdated.length,
      active: allUsers.filter((u) => u.status === "active").length,
      idle: allUsers.filter((u) => u.status === "idle").length,
      offline: allUsers.filter((u) => u.status === "offline").length,
    };

    return {
      outdatedUsers: finalOutdated,
      currentUsers: finalCurrent,
      userStats: stats,
    };
  }, [usersData, now, getStatus]);

  const handleNotesChange = (e) => {
    const value = e.target.value;
    const cursorPosition = e.target.selectionStart;

    if (value.length > notes.length && value[cursorPosition - 1] === "\n") {
      const beforeCursor = value.substring(0, cursorPosition);
      const afterCursor = value.substring(cursorPosition);
      const newValue = beforeCursor + "• " + afterCursor;
      setNotes(newValue);

      setTimeout(() => {
        e.target.selectionStart = cursorPosition + 2;
        e.target.selectionEnd = cursorPosition + 2;
      }, 0);
    } else {
      setNotes(value);
    }
  };

  const handleFocus = () => {
    if (notes === "") {
      setNotes("• ");
    }
  };

  async function send(priority) {
    setSending(true);
    setSelectedPriority(priority);

    try {
      const cleanedNotes = notes
        .split("\n")
        .filter((line) => line.trim() !== "•" && line.trim() !== "")
        .join("\n")
        .trim();

      await db.from("cases").insert({
        casenumber: "update",
        department: "General",
        priority: priority === "high" || priority === "force",
        modifiers: [priority, cleanedNotes].filter(Boolean),
        due: new Date().toISOString(),
        completed: false,
        created_at: new Date().toISOString(),
      });

      window.dispatchEvent(
        new CustomEvent("update-available", {
          detail: {
            priority,
            notes: cleanedNotes,
            timestamp: Date.now(),
          },
        })
      );

      if (priority === "force") {
        localStorage.setItem("forceUpdate", "true");
      }

      setNotes("");
      onClose();
    } catch (error) {
      console.error("Failed to send update:", error);
    } finally {
      setSending(false);
      setSelectedPriority(null);
    }
  }

  const StatusDot = ({ status }) => {
    if (status === "active") {
      return (
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
        </span>
      );
    }
    if (status === "idle") {
      return (
        <div className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />
      );
    }
    return <div className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />;
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          variants={{
            hidden: { scale: 0.95, opacity: 0, y: 10 },
            shown: { scale: 1, opacity: 1, y: 0 },
          }}
          initial="hidden"
          animate="shown"
          exit="hidden"
          transition={SPRING}
          className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl overflow-hidden"
          style={{ zIndex: 201 }}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-gray-800 to-gray-900 px-6 py-4 text-white flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-bold">Push Update</h2>
              <div className="flex items-center gap-2 bg-white/10 px-3 py-1 rounded-full">
                <span className="text-gray-300 text-sm">Current:</span>
                <span className="font-mono font-semibold">v{APP_VERSION}</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 text-sm bg-white/5 px-3 py-1.5 rounded-full">
                <div className="flex items-center gap-1.5" title="Active now">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  <span className="text-green-400 font-medium">
                    {userStats.active}
                  </span>
                </div>
                <div
                  className="flex items-center gap-1.5"
                  title="Idle (45s - 5m30s)"
                >
                  <div className="w-2 h-2 rounded-full bg-yellow-400" />
                  <span className="text-yellow-400 font-medium">
                    {userStats.idle}
                  </span>
                </div>
                <div
                  className="flex items-center gap-1.5"
                  title="Offline (5m30s+)"
                >
                  <div className="w-2 h-2 rounded-full bg-gray-400" />
                  <span className="text-gray-400 font-medium">
                    {userStats.offline}
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex">
            {/* Left Column - Users */}
            <div className="w-1/2 border-r border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-800">Users</h3>
                  <span className="text-xs text-gray-400">(last 7 days)</span>
                  <button
                    onClick={loadUsers}
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                    title="Refresh now"
                  >
                    <svg
                      className="w-4 h-4 text-gray-400 hover:text-gray-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  </button>
                </div>
                <div className="flex gap-2">
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
                    {userStats.upToDate} current
                  </span>
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
                    {userStats.outdated} outdated
                  </span>
                </div>
              </div>

              {loadingUsers ? (
                <div className="flex items-center justify-center h-64">
                  <div className="w-8 h-8 border-3 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-2">
                  {/* Outdated Users */}
                  <div>
                    <p className="text-xs font-medium text-amber-600 mb-2 uppercase tracking-wide">
                      Need Update ({outdatedUsers.length})
                    </p>
                    <div className="space-y-1.5">
                      {outdatedUsers.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">
                          All current!
                        </p>
                      ) : (
                        outdatedUsers.map((user) => (
                          <div
                            key={user.key}
                            className={`flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-amber-50 border border-amber-100 transition-opacity duration-200 ${
                              user.status === "offline"
                                ? "opacity-50"
                                : "opacity-100"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <StatusDot status={user.status} />
                              <span className="font-medium text-sm text-gray-800 truncate">
                                {user.displayName}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs flex-shrink-0 ml-2">
                              <span className="font-mono text-amber-600 w-10 text-right">
                                {user.app_version || "?"}
                              </span>
                              <span className="text-gray-300">•</span>
                              <span
                                className={`w-8 text-right ${
                                  user.status === "active"
                                    ? "text-green-600 font-medium"
                                    : "text-gray-400"
                                }`}
                              >
                                {formatDate(user.last_seen)}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Current Users */}
                  <div>
                    <p className="text-xs font-medium text-green-600 mb-2 uppercase tracking-wide">
                      Up to Date ({currentUsers.length})
                    </p>
                    <div className="space-y-1.5">
                      {currentUsers.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">
                          No current users
                        </p>
                      ) : (
                        currentUsers.map((user) => (
                          <div
                            key={user.key}
                            className={`flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-green-50 border border-green-100 transition-opacity duration-200 ${
                              user.status === "offline"
                                ? "opacity-50"
                                : "opacity-100"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <StatusDot status={user.status} />
                              <span className="font-medium text-sm text-gray-800 truncate">
                                {user.displayName}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs flex-shrink-0 ml-2">
                              <span className="font-mono text-green-600 w-10 text-right">
                                {user.app_version || "?"}
                              </span>
                              <span className="text-gray-300">•</span>
                              <span
                                className={`w-8 text-right ${
                                  user.status === "active"
                                    ? "text-green-600 font-medium"
                                    : "text-gray-400"
                                }`}
                              >
                                {formatDate(user.last_seen)}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column - Actions */}
            <div className="w-1/2 p-5 bg-gray-50">
              <h3 className="font-semibold text-gray-800 mb-4">
                Release Notes
              </h3>

              <textarea
                value={notes}
                onChange={handleNotesChange}
                onFocus={handleFocus}
                placeholder="What's new in this update?"
                rows={5}
                className="w-full rounded-xl border border-gray-200 bg-white p-4 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-none text-sm transition-all mb-1"
                disabled={sending}
              />
              <p className="text-xs text-gray-400 mb-5">
                Press Enter for bullet points
              </p>

              {/* Action Buttons */}
              <div className="space-y-3">
                <button
                  className="w-full rounded-xl bg-blue-600 py-3.5 font-semibold text-white hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                  onClick={() => send("normal")}
                  disabled={sending}
                >
                  {sending && selectedPriority === "normal" ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                        />
                      </svg>
                      Standard Update
                      <span className="text-blue-200 text-sm ml-1">
                        — Shows notification
                      </span>
                    </>
                  )}
                </button>

                <button
                  className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-red-500 py-3.5 font-semibold text-white hover:from-orange-600 hover:to-red-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                  onClick={() => send("high")}
                  disabled={sending}
                >
                  {sending && selectedPriority === "high" ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      High Priority
                      <span className="text-orange-200 text-sm ml-1">
                        — Flashing alert
                      </span>
                    </>
                  )}
                </button>

                <button
                  className="w-full rounded-xl bg-gradient-to-r from-gray-700 to-gray-900 py-3.5 font-semibold text-white hover:from-gray-800 hover:to-black active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                  onClick={() => send("force")}
                  disabled={sending}
                >
                  {sending && selectedPriority === "force" ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                      </svg>
                      Force Reload
                      <span className="text-gray-400 text-sm ml-1">
                        — Instant refresh all
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
