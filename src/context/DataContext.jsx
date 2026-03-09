import React, {
  createContext,
  useEffect,
  useState,
  useRef,
} from "react";

import {
  addCase,
  updateCase,
  togglePriority as svcTogglePriority,
  toggleRush as svcToggleRush,
  toggleHold as svcToggleHold,
  toggleNewAccount as svcToggleNewAccount,
  toggleComplete as svcToggleComplete,
  toggleStage2 as svcToggleStage2,
  unlinkFromWorkflow as svcUnlinkFromWorkflow,
  relinkToWorkflow as svcRelinkToWorkflow,
  db,
  logCase,
  toggleCaseExclusion as svcToggleCaseExclusion,
  batchToggleExclusions as svcBatchToggleExclusions,
} from "../services/caseService";

import { userService } from "../services/userService";
import { buildWorkflowMap } from "../utils/workflowDetection";
import { initFrontOfficeSync } from "../utils/frontOfficeStaff";
import { deepRefresh } from "../utils/deepRefresh";

/* ────── flag "update" rows ────── */
function flagUpdatePending(record) {
  const modifiers = record.modifiers || [];
  const priority =
    modifiers.find((m) => ["normal", "high", "force"].includes(m)) || "normal";
  const notes =
    modifiers.find((m) => !["normal", "high", "force"].includes(m)) || "";

  if (priority === "force") {
    setTimeout(() => {
      deepRefresh("force-update-row");
    }, 500);
    return;
  }

  if (!document.documentElement.classList.contains("update-pending")) {
    document.documentElement.classList.add("update-pending");

    if (notes) {
      localStorage.setItem("updateNotes", notes);
    }
    localStorage.setItem("updatePriority", priority);

    if (priority === "high") {
      document.documentElement.classList.add("update-critical");
    } else {
      document.documentElement.classList.remove("update-critical");
    }

    window.dispatchEvent(
      new CustomEvent("update-available", {
        detail: {
          priority,
          notes,
          timestamp: Date.now(),
        },
      })
    );
  }
}

async function purgeUpdateRows() {
  await db.from("cases").delete().ilike("casenumber", "update");
  await db.from("cases").delete().ilike("casenumber", "syscmd");
  await db.from("cases").delete().ilike("casenumber", "force-cmd");
}

/* ────── system command rows ────── */
const SYSCMD_PROCESSED_KEY = "syscmdProcessedIds";

function getProcessedSysCmdIds() {
  const raw = localStorage.getItem(SYSCMD_PROCESSED_KEY);
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function markSysCmdProcessed(id) {
  if (!id) return;
  const ids = getProcessedSysCmdIds();
  if (ids.includes(id)) return;
  ids.unshift(id);
  localStorage.setItem(SYSCMD_PROCESSED_KEY, JSON.stringify(ids.slice(0, 50)));
}

function hasProcessedSysCmd(id) {
  if (!id) return false;
  return getProcessedSysCmdIds().includes(id);
}

function normalizeUserKey(name) {
  if (!name) return "";
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*[#\-_\.]\s*(\d)/g, " $1")
    .replace(/\s+/g, " ")
    .replace(/\s*&\s*/g, "&")
    .trim();
}

function parseSysCmd(record) {
  const mods = record?.modifiers || [];

  let cmdEntry = mods.find((m) => m.startsWith("force-syscmd:"));
  let cmd = cmdEntry ? cmdEntry.replace("force-syscmd:", "") : null;

  if (!cmd) {
    cmdEntry = mods.find((m) => m.startsWith("syscmd:"));
    cmd = cmdEntry ? cmdEntry.replace("syscmd:", "") : null;
  }

  const targetEntry = mods.find((m) => m.startsWith("target:"));
  const target = targetEntry ? targetEntry.replace("target:", "") : "all";
  const payloadEntry = mods.find((m) => m.startsWith("payload:"));
  const payload = payloadEntry ? payloadEntry.replace("payload:", "") : null;

  return { cmd, target, payload };
}

function applySettingsPayload(payloadJson) {
  if (!payloadJson) return;
  try {
    const obj = JSON.parse(payloadJson);
    if (!obj || typeof obj !== "object") return;

    const settings = obj.settings || obj;
    const appliedSettings = {};

    Object.entries(settings).forEach(([k, v]) => {
      let valueToStore;
      if (typeof v === "boolean") {
        valueToStore = v ? "true" : "false";
      } else if (typeof v === "number") {
        valueToStore = String(v);
      } else if (typeof v === "string") {
        valueToStore = v;
      } else {
        valueToStore = JSON.stringify(v);
      }
      localStorage.setItem(k, valueToStore);
      appliedSettings[k] = v;
    });

    console.log(
      "[DataContext] Applied settings from system command:",
      appliedSettings
    );

    window.dispatchEvent(
      new CustomEvent("settings-applied", {
        detail: appliedSettings,
      })
    );

    window.dispatchEvent(new Event("settings-changed"));

    if (appliedSettings.showInfoBar !== undefined) {
      window.dispatchEvent(new Event("infobar-toggle"));
    }
  } catch (e) {
    console.error("Error applying settings payload:", e);
  }
}

function handleSysCmd(record) {
  if (!record) return;
  if (hasProcessedSysCmd(record.id)) return;

  const userName = (userService.getName() || "").trim();
  const { cmd, target, payload } = parseSysCmd(record);
  if (!cmd) return;

  const normalizedTarget = normalizeUserKey(target);
  const normalizedMe = normalizeUserKey(userName);

  const match =
    normalizedTarget === "all" ||
    (normalizedMe && normalizedTarget === normalizedMe);

  if (!match) return;

  markSysCmdProcessed(record.id);

  if (cmd === "restart" || cmd === "force-restart") {
    setTimeout(() => deepRefresh(`syscmd-${cmd}`), 300);
    return;
  }

  if (cmd === "refresh") {
    setTimeout(() => deepRefresh("syscmd-refresh"), 300);
    return;
  }

  if (cmd === "settings" || cmd === "force-settings") {
    applySettingsPayload(payload);

    let shouldRestart = false;
    try {
      const parsed = JSON.parse(payload);
      shouldRestart = parsed?.restart === true;
    } catch {}

    if (shouldRestart) {
      setTimeout(() => deepRefresh("syscmd-settings-restart"), 300);
    }
    return;
  }
}

export const DataCtx = createContext(null);
export const useMut = () => React.useContext(DataCtx);

/* Map DB record → UI row */
const mapRow = (rec) => {
  const mods = rec.modifiers ?? [];
  return {
    ...structuredClone(rec),
    department: rec.department ?? "General",
    rush: mods.includes("rush"),
    hold: mods.includes("hold"),
    newAccount: mods.includes("newaccount"),
    stage2: mods.includes("stage2"),
    priority: rec.priority ?? false,
    caseNumber: rec.casenumber,
    caseType: mods.includes("bbs")
      ? "bbs"
      : mods.includes("flex")
      ? "flex"
      : "general",
  };
};

export function DataProvider({ activeDept, children }) {
  const [rows, setRows] = useState([]);
  const [workflowMap, setWorkflowMap] = useState(new Map());
  const workflowBuildRef = useRef(0);

  /* ─── Front Office list sync — fetch from DB on mount, subscribe realtime ─── */
  useEffect(() => {
    const cleanup = initFrontOfficeSync(db);
    return cleanup;
  }, []);

  /* ── initial fetch (excluding archived) ── */
  useEffect(() => {
    (async () => {
      const { data, error } = await db
        .from("cases")
        .select("*")
        .eq("archived", false)
        .order("due");

      if (error) {
        console.error("Error fetching cases:", error);
      }

      const filtered = [];
      (data ?? []).forEach((r) => {
        const cn = r.casenumber?.trim().toLowerCase();
        if (cn === "update") {
          flagUpdatePending(r);
        } else if (cn === "syscmd" || cn === "force-cmd") {
          handleSysCmd(r);
        } else {
          filtered.push(mapRow(r));
        }
      });

      if (filtered.length !== (data ?? []).length) purgeUpdateRows();
      setRows(filtered);
    })();
  }, []);

  /* ── realtime channel ── */
  useEffect(() => {
    const ch = db
      .channel("live")
      .on(
        "postgres_changes",
        { schema: "public", table: "cases", event: "*" },
        (ev) =>
          setRows((cur) => {
            if (ev.new?.archived) return cur;

            const cn = ev.new?.casenumber?.trim().toLowerCase();

            if (cn === "update") {
              flagUpdatePending(ev.new);
              purgeUpdateRows();
              return cur;
            }

            if (cn === "syscmd" || cn === "force-cmd") {
              handleSysCmd(ev.new);
              return cur;
            }

            if (ev.eventType === "DELETE") {
              return cur.filter((r) => r.id !== ev.old.id);
            }
            const row = mapRow(ev.new);

            const i = cur.findIndex((r) => r.id === row.id);
            if (i === -1) return [...cur, row];
            const next = [...cur];
            next[i] = row;
            return next;
          })
      )
      .subscribe();
    return () => db.removeChannel(ch);
  }, []);

  /* ── Async workflow map rebuild ── */
  useEffect(() => {
    const buildId = ++workflowBuildRef.current;

    buildWorkflowMap(rows).then((map) => {
      // Only apply if this is still the latest build
      if (buildId === workflowBuildRef.current) {
        setWorkflowMap(map);
      }
    });
  }, [rows]);

  /* ── CRUD helpers ── */
  const togglePriority = (r) => svcTogglePriority(r).catch(console.error);
  const toggleRush = (r) => svcToggleRush(r).catch(console.error);
  const toggleHold = (r) => svcToggleHold(r).catch(console.error);
  const toggleNewAccount = (r) => svcToggleNewAccount(r).catch(console.error);
  const toggleComplete = (id, cur) =>
    svcToggleComplete(id, cur).catch(console.error);
  const toggleStage2 = (r) => svcToggleStage2(r).catch(console.error);

  const addOrUpdate = async (payload, editId) => {
    return editId ? updateCase({ id: editId, ...payload }) : addCase(payload);
  };

  /* ── DELETE single case ── */
  const removeCase = async (id) => {
    const { error } = await db.from("cases").delete().eq("id", id);
    if (!error) {
      setRows((cur) => cur.filter((r) => r.id !== id));
    }
  };

  /* ── UPDATE case stage (WITH QC HANDLING) ── */
  const updateCaseStage = async (caseItem, newStage, isRepair = false) => {
    const { id, modifiers = [] } = caseItem;

    const filteredMods = modifiers.filter((m) => !m.startsWith("stage-"));

    if (newStage) {
      filteredMods.push(`stage-${newStage}`);
    }

    const { error } = await db
      .from("cases")
      .update({ modifiers: filteredMods })
      .eq("id", id);

    if (!error) {
      if (isRepair) {
        await logCase(
          id,
          "Sent for repair - moved directly to Finishing stage"
        );
      } else if (newStage === "qc") {
        await logCase(id, "Moved from Finishing to Quality Control");
      } else if (modifiers.includes("stage-qc") && newStage === "finishing") {
        await logCase(id, "Moved from Quality Control back to Finishing stage");
      } else {
        const stageNames = {
          design: "Design",
          production: "Production",
          finishing: "Finishing",
          qc: "Quality Control",
        };

        const currentStage = modifiers
          .find((m) => m.startsWith("stage-"))
          ?.replace("stage-", "");
        const fromStage = currentStage ? stageNames[currentStage] : "Unknown";
        const toStage = newStage ? stageNames[newStage] : "Unknown";

        await logCase(id, `Moved from ${fromStage} to ${toStage} stage`);
      }

      setRows((cur) =>
        cur.map((r) => (r.id === id ? { ...r, modifiers: filteredMods } : r))
      );
    }
  };

  /* ── UNLINK / RELINK workflow ── */
  const unlinkFromWorkflow = async (caseId) => {
    const result = await svcUnlinkFromWorkflow(caseId);
    if (!result.error) {
      setRows((cur) =>
        cur.map((r) =>
          r.id === caseId
            ? { ...r, modifiers: [...(r.modifiers || []), "workflow-unlinked"] }
            : r
        )
      );
    }
    return result;
  };

  const relinkToWorkflow = async (caseId) => {
    const result = await svcRelinkToWorkflow(caseId);
    if (!result.error) {
      setRows((cur) =>
        cur.map((r) =>
          r.id === caseId
            ? {
                ...r,
                modifiers: (r.modifiers || []).filter(
                  (m) => m !== "workflow-unlinked"
                ),
              }
            : r
        )
      );
    }
    return result;
  };

  /* ── REFRESH cases ── */
  const refreshCases = async () => {
    const { data, error } = await db
      .from("cases")
      .select("*")
      .eq("archived", false)
      .order("due");

    if (error) {
      console.error("Error refreshing cases:", error);
      return;
    }

    const filtered = [];
    (data ?? []).forEach((r) => {
      const cn = r.casenumber?.trim().toLowerCase();
      if (cn === "update") {
        flagUpdatePending(r);
      } else if (cn === "syscmd" || cn === "force-cmd") {
        handleSysCmd(r);
      } else {
        filtered.push(mapRow(r));
      }
    });

    setRows(filtered);
  };

  const toggleCaseExclusion = async (caseId, stage = null, reason = null) => {
    const result = await svcToggleCaseExclusion(caseId, stage, reason);
    if (!result.error) {
      await refreshCases();
    }
    return result;
  };

  const batchToggleExclusions = async (
    caseIds,
    exclude = true,
    stage = null,
    reason = null
  ) => {
    const results = await svcBatchToggleExclusions(
      caseIds,
      exclude,
      stage,
      reason
    );
    await refreshCases();
    return results;
  };

  const visible =
    activeDept == null ? rows : rows.filter((r) => r.department === activeDept);

  return (
    <DataCtx.Provider
      value={{
        rows: visible,
        allRows: rows,
        workflowMap,
        togglePriority,
        toggleRush,
        toggleHold,
        toggleNewAccount,
        toggleComplete,
        toggleStage2,
        addOrUpdate,
        removeCase,
        refreshCases,
        updateCaseStage,
        unlinkFromWorkflow,
        relinkToWorkflow,
        toggleCaseExclusion,
        batchToggleExclusions,
      }}
    >
      {children}
    </DataCtx.Provider>
  );
}
