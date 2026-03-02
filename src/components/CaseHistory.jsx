import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { db, parseNoteTime } from "../services/caseService";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { useMut } from "../context/DataContext";
import { getWorkflowStatus } from "../utils/workflowDetection";
import { formatHistoryAction } from "../utils/historyActionFormatter";
import clsx from "clsx";

/* ══════════════════════════════════════════════ */
/*  Helpers                                       */
/* ══════════════════════════════════════════════ */

const fmtTs = (ts) =>
  new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Denver",
  });

const fmtTsShort = (ts) =>
  new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Denver",
  });

const fmtDateOnly = (dateStr) => {
  const [y, m, d] = dateStr.split("T")[0].split("-");
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const fmtDateCompact = (dateStr) => {
  const [y, m, d] = dateStr.split("T")[0].split("-");
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

const fmtDur = (ms) => {
  if (ms <= 0) return "—";
  const mins = Math.floor(ms / 6e4);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  if (d > 0) return `${d}d ${rh}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const getBusinessDays = (s, e) => {
  let count = 0;
  const start = new Date(s);
  const end = new Date(e);
  while (start <= end) {
    const dow = start.getDay();
    if (dow !== 0 && dow !== 6) count++;
    start.setDate(start.getDate() + 1);
  }
  return count;
};

const splitCase = (cn = "") => {
  const t = cn
    .replace(/[()]/g, "")
    .replace(/\s*-\s*/, " ")
    .trim()
    .split(/\s+/);
  return [t.shift() || "", t.join(" ")];
};

const normDept = (d) => (!d ? "Unknown" : d === "General" ? "Digital" : d);

/**
 * Returns the due hour (local, 0–23) for a case.
 * If a noteHour was parsed from the case note it takes precedence;
 * otherwise falls back to noon for priority cases and 5 pm for normal.
 */
const getDueHour = (isPriority, noteHour = null) =>
  noteHour !== null ? noteHour : isPriority ? 12 : 17;

/** Format a local 0-23 hour as "8:00 AM", "2:00 PM", etc. */
const fmtHour12 = (h) => {
  if (h === 0) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
};

/* ══════════════════════════════════════════════ */
/*  Action classification                         */
/* ══════════════════════════════════════════════ */

const ACTION_TYPE_MAP = {
  "marked done": "complete",
  "undo done": "undo",
  priority: "priority",
  rush: "rush",
  hold: "hold",
  "due changed": "edit",
  "due date changed": "edit",
  "due time changed": "edit",
  "note changed": "note",
  "note added": "note",
  "note removed": "note",
  changed: "edit",
  deleted: "delete",
  removed: "delete",
  stage: "stage",
  bbs: "type",
  flex: "type",
  "design stage": "stage",
  "production stage": "stage",
  "finishing stage": "stage",
  "quality control": "stage",
  "new account": "newaccount",
  "unlinked from": "workflow",
  "re-linked to": "workflow",
  "case created": "create",
  "sent for repair": "stage",
  "moved from": "stage",
  "moved to": "stage",
  excluded: "exclude",
  included: "exclude",
};

const getActionType = (action) => {
  const low = action.toLowerCase();
  for (const [k, v] of Object.entries(ACTION_TYPE_MAP)) {
    if (low.includes(k)) return v;
  }
  return "default";
};

const processActionText = formatHistoryAction;

const actionColors = {
  complete: "text-blue-600 bg-blue-50 border-blue-200",
  undo: "text-purple-600 bg-purple-50 border-purple-200",
  priority: "text-red-600 bg-red-50 border-red-200",
  rush: "text-orange-600 bg-orange-50 border-orange-200",
  hold: "text-amber-600 bg-amber-50 border-amber-200",
  edit: "text-purple-600 bg-purple-50 border-purple-200",
  note: "text-teal-600 bg-teal-50 border-teal-200",
  delete: "text-gray-600 bg-gray-50 border-gray-200",
  stage: "text-indigo-600 bg-indigo-50 border-indigo-200",
  type: "text-pink-600 bg-pink-50 border-pink-200",
  newaccount: "text-pink-600 bg-pink-50 border-pink-200",
  create: "text-emerald-600 bg-emerald-50 border-emerald-200",
  workflow: "text-cyan-600 bg-cyan-50 border-cyan-200",
  exclude: "text-gray-600 bg-gray-50 border-gray-200",
  default: "text-gray-600 bg-gray-50 border-gray-200",
};

/* ══════════════════════════════════════════════ */
/*  Icons (hoisted — allocated once)              */
/* ══════════════════════════════════════════════ */

const ACTION_ICONS = {
  complete: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  ),
  undo: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
      />
    </svg>
  ),
  priority: (
    <svg
      className="w-4 h-4"
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
  ),
  rush: (
    <svg
      className="w-4 h-4"
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
  ),
  hold: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  edit: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  ),
  note: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
      />
    </svg>
  ),
  delete: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  ),
  stage: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
      />
    </svg>
  ),
  type: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
      />
    </svg>
  ),
  newaccount: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
      />
    </svg>
  ),
  create: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 6v6m0 0v6m0-6h6m-6 0H6"
      />
    </svg>
  ),
  workflow: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
      />
    </svg>
  ),
  exclude: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
      />
    </svg>
  ),
  default: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
};

/* ══════════════════════════════════════════════ */
/*  Tiny components                               */
/* ══════════════════════════════════════════════ */

const LoadingSpinner = () => (
  <div className="flex items-center justify-center py-12">
    <svg
      className="animate-spin h-8 w-8 text-gray-400"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  </div>
);

const ActionIcon = React.memo(
  ({ type }) => ACTION_ICONS[type] || ACTION_ICONS.default
);
ActionIcon.displayName = "ActionIcon";

const CountdownTimer = React.memo(({ dueDate, isPriority, noteHour = null }) => {
  const computeDisplay = useCallback(() => {
    const now = new Date();
    const [y, m, d] = dueDate.split("T")[0].split("-");
    const due = new Date(y, m - 1, d);
    due.setHours(getDueHour(isPriority, noteHour), 0, 0, 0);
    const diff = due - now;
    const abs = Math.abs(diff);
    const dd = Math.floor(abs / 864e5);
    const hh = Math.floor((abs % 864e5) / 36e5);
    const mm = Math.floor((abs % 36e5) / 6e4);
    const ss = Math.floor((abs % 6e4) / 1000);
    let display;
    if (dd > 1) display = `${dd} days`;
    else if (dd === 1) display = `1 day ${hh}h`;
    else
      display = `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(
        2,
        "0"
      )}`;
    if (diff < 0) display = `-${display}`;
    return display;
  }, [dueDate, isPriority, noteHour]);

  const [timeLeft, setTimeLeft] = useState(computeDisplay);

  useEffect(() => {
    const iv = setInterval(() => setTimeLeft(computeDisplay()), 1000);
    return () => clearInterval(iv);
  }, [computeDisplay]);

  return <span className="font-mono tabular-nums">{timeLeft}</span>;
});
CountdownTimer.displayName = "CountdownTimer";

/* ══════════════════════════════════════════════ */
/*  Stage parsing                                 */
/* ══════════════════════════════════════════════ */

const parseDigitalStages = (
  hist,
  curStage,
  isComplete,
  isInQC,
  offsetTs = null
) => {
  const data = {
    design: {
      entries: [],
      totalDuration: 0,
      isActive: false,
      wasVisited: false,
    },
    production: {
      entries: [],
      totalDuration: 0,
      isActive: false,
      wasVisited: false,
    },
    finishing: {
      entries: [],
      totalDuration: 0,
      isActive: false,
      wasVisited: false,
    },
  };
  const sorted = [...hist].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );
  let active = null;
  sorted.forEach((entry) => {
    const act = entry.action.toLowerCase();
    if (act.includes("sent for repair")) {
      if (active && data[active]?.entries.length) {
        const l = data[active].entries.at(-1);
        if (!l.exited) l.exited = entry.created_at;
      }
      data.finishing.entries.push({
        entered: entry.created_at,
        exited: null,
        isRepair: true,
      });
      data.finishing.wasVisited = true;
      active = "finishing";
      return;
    }
    if (
      act.includes("case created") &&
      !sorted.some((h) => h.action.toLowerCase().includes("sent for repair"))
    ) {
      const next = sorted[sorted.indexOf(entry) + 1];
      if (!next || !next.action.toLowerCase().includes("sent for repair")) {
        data.design.entries.push({ entered: entry.created_at, exited: null });
        data.design.wasVisited = true;
        active = "design";
      }
      return;
    }
    if (act.includes("moved from") && act.includes("to")) {
      let fromS = null,
        toS = null;
      if (act.includes("from design")) fromS = "design";
      else if (act.includes("from production")) fromS = "production";
      else if (act.includes("from finishing")) fromS = "finishing";
      if (act.includes("to design")) toS = "design";
      else if (act.includes("to production")) toS = "production";
      else if (act.includes("to finishing")) toS = "finishing";
      else if (act.includes("to quality control")) toS = "qc";
      if (fromS && data[fromS]?.entries.length) {
        const l = data[fromS].entries.at(-1);
        if (!l.exited) l.exited = entry.created_at;
      }
      if (toS && toS !== "qc" && data[toS]) {
        data[toS].entries.push({ entered: entry.created_at, exited: null });
        data[toS].wasVisited = true;
        active = toS;
      } else if (toS === "qc") active = null;
    }
    if (
      act.includes("moved from quality control") &&
      act.includes("back to finishing")
    ) {
      data.finishing.entries.push({ entered: entry.created_at, exited: null });
      data.finishing.wasVisited = true;
      active = "finishing";
    }
    if (act === "marked done" && active && data[active]?.entries.length) {
      const l = data[active].entries.at(-1);
      if (!l.exited) l.exited = entry.created_at;
      active = null;
    }
  });
  ["design", "production", "finishing"].forEach((stage) => {
    let totalMs = 0;
    data[stage].entries.forEach((e) => {
      let start = new Date(e.entered).getTime();
      const end = e.exited ? new Date(e.exited).getTime() : Date.now();
      if (offsetTs && start < offsetTs) start = offsetTs;
      totalMs += Math.max(0, end - start);
    });
    data[stage].totalDuration = totalMs;
    if (data[stage].entries.length) {
      const l = data[stage].entries.at(-1);
      data[stage].isActive =
        !l.exited && stage === curStage && !isComplete && !isInQC;
    }
  });
  const qcEntry = sorted.find((h) =>
    h.action.toLowerCase().includes("moved from finishing to quality control")
  );
  return { ...data, isInQC, qcEnteredAt: qcEntry?.created_at };
};

const parseMetalStages = (hist, isStage2, isComplete, offsetTs = null) => {
  const sorted = [...hist].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );
  let s1Start = null,
    s1End = null,
    s2Start = null,
    s2End = null;
  const creation = sorted.find((e) =>
    e.action.toLowerCase().includes("case created")
  );
  if (creation) s1Start = new Date(creation.created_at);
  for (const entry of sorted) {
    const act = entry.action.toLowerCase();
    if (
      act.includes("moved to stage 2") ||
      (act.includes("stage 2") && !act.includes("back"))
    ) {
      if (!s1End) s1End = new Date(entry.created_at);
      if (!s2Start) s2Start = new Date(entry.created_at);
    }
    if (act.includes("moved back to stage 1")) {
      s2End = new Date(entry.created_at);
      s1Start = new Date(entry.created_at);
      s1End = null;
    }
    if (act === "marked done") {
      if (isStage2 && s2Start && !s2End) s2End = new Date(entry.created_at);
      else if (s1Start && !s1End) s1End = new Date(entry.created_at);
    }
  }
  const now = Date.now();
  let s1Dur = 0;
  if (s1Start) {
    let start = s1Start.getTime();
    if (offsetTs && start < offsetTs) start = offsetTs;
    const end = s1End
      ? s1End.getTime()
      : !isStage2 && !isComplete
      ? now
      : s1End?.getTime() || now;
    s1Dur = Math.max(0, end - start);
  }
  let s2Dur = 0;
  if (s2Start) {
    const end = s2End ? s2End.getTime() : now;
    s2Dur = Math.max(0, end - s2Start.getTime());
  }
  return {
    s1: {
      duration: s1Dur,
      isActive: !isStage2 && !isComplete,
      wasVisited: !!s1Start,
    },
    s2: {
      duration: s2Dur,
      isActive: isStage2 && !isComplete,
      wasVisited: isStage2 || (isComplete && !!s2Start),
    },
  };
};

const buildDigitalStages = (
  hist,
  curStage,
  cd,
  offsetTs = null,
  isPendingUpstream = false
) => {
  const isInQC = cd.modifiers?.includes("stage-qc");
  const parsed = parseDigitalStages(
    hist,
    curStage,
    cd.completed,
    isInQC,
    offsetTs
  );
  return {
    stages: ["design", "production", "finishing"].map((s) => {
      const suppressed = isPendingUpstream && !cd.completed;
      return {
        key: s,
        label: s.charAt(0).toUpperCase() + s.slice(1),
        duration: suppressed ? 0 : parsed[s].totalDuration,
        isActive: suppressed ? false : parsed[s].isActive,
        isCompleted: cd.completed && parsed[s].wasVisited,
        wasVisited: suppressed ? false : parsed[s].wasVisited,
        visits: parsed[s].entries.length,
        isRepair: parsed[s].entries.some((e) => e.isRepair),
        isQC: s === "finishing" && isInQC,
        isWaiting: suppressed && s === "design",
      };
    }),
    isInQC,
    qcEnteredAt: parsed.qcEnteredAt,
  };
};

const buildMetalStages = (
  hist,
  cd,
  offsetTs = null,
  isPendingUpstream = false
) => {
  const isStage2 = cd.stage2 || cd.modifiers?.includes("stage2");
  const parsed = parseMetalStages(hist, isStage2, cd.completed, offsetTs);
  const suppressed = isPendingUpstream && !cd.completed;
  return [
    {
      key: "metal-s1",
      label: "Stage 1",
      duration: suppressed ? 0 : parsed.s1.duration,
      isActive: suppressed ? false : parsed.s1.isActive,
      isCompleted: (isStage2 || cd.completed) && parsed.s1.wasVisited,
      wasVisited: suppressed ? false : parsed.s1.wasVisited,
      isWaiting: suppressed,
    },
    {
      key: "metal-s2",
      label: "Stage 2",
      duration: suppressed ? 0 : parsed.s2.duration,
      isActive: suppressed ? false : parsed.s2.isActive,
      isCompleted: cd.completed && parsed.s2.wasVisited,
      wasVisited: suppressed ? false : parsed.s2.wasVisited,
    },
  ];
};

const computeLateness = (completedAt, dueStr, isPriority = false, noteHour = null) => {
  if (!completedAt || !dueStr) return null;
  const done = new Date(completedAt);
  const [y, m, d] = dueStr.split("T")[0].split("-").map(Number);
  const due = new Date(y, m - 1, d);
  due.setHours(getDueHour(isPriority, noteHour), 0, 0, 0);
  const diff = done - due;
  if (diff <= 0) return null;
  const totalH = diff / 36e5;
  const days = Math.floor(totalH / 24);
  const hours = Math.floor(totalH % 24);
  return {
    days,
    hours,
    text: days > 0 ? `${days}d ${hours}h late` : `${hours}h late`,
  };
};

const mapCaseRow = (c) => {
  const d = c.department === "General" ? "Digital" : c.department;
  const stageMod = c.modifiers?.find((m) => m.startsWith("stage-"));
  return {
    ...c,
    caseNumber: c.casenumber,
    department: d,
    rush: c.modifiers?.includes("rush") || false,
    hold: c.modifiers?.includes("hold") || false,
    stage2: c.modifiers?.includes("stage2") || false,
    priority: c.priority || false,
    newAccount: c.modifiers?.includes("newaccount") || false,
    caseType: c.modifiers?.includes("bbs")
      ? "bbs"
      : c.modifiers?.includes("flex")
      ? "flex"
      : "general",
    digitalStage: d === "Digital" && stageMod ? stageMod.split("-")[1] : null,
  };
};

const DUE_PAT = /Due changed from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/i;
const filterHistRows = (hist, dept) =>
  hist
    .filter((h) => {
      if (h.action.toLowerCase().includes("case created")) return false;
      const match = h.action.match(DUE_PAT);
      return !(match && match[1] === match[2]);
    })
    .map((h) => {
      const processed = processActionText(h.action);
      return {
        ...h,
        action: processed,
        user_name: h.user_name?.trim() || "—",
        actionType: getActionType(processed),
        department: dept,
      };
    });

/* ══════════════════════════════════════════════ */
/*  Spring configs                                */
/* ══════════════════════════════════════════════ */

const smoothSpring = { type: "spring", stiffness: 300, damping: 30 };
const snappySpring = { type: "spring", stiffness: 400, damping: 28 };
const gentleSpring = { type: "spring", stiffness: 200, damping: 26 };

const stageDotSpring = {
  type: "spring",
  stiffness: 170,
  damping: 26,
  mass: 1.1,
};

const fillSpring = { type: "spring", stiffness: 100, damping: 20, mass: 1.4 };

/* ══════════════════════════════════════════════ */
/*  Dot sizing constants                          */
/* ══════════════════════════════════════════════ */

const DOT_PX = 36;
const TRACK_H = 6;
const TRACK_PAD = 10;

/* ══════════════════════════════════════════════ */
/*  Animated Stage Dot                            */
/* ══════════════════════════════════════════════ */

const StageDot = React.memo(({ stage, index, stableKey, skipLayout }) => {
  const status = stage.isCompleted
    ? "completed"
    : stage.isActive
    ? "active"
    : stage.wasVisited
    ? "visited"
    : "unvisited";

  return (
    <motion.div
      key={stableKey}
      layout={!skipLayout ? "position" : false}
      className="flex flex-col items-center"
      style={{ flex: "1 1 0%", minWidth: 0 }}
      transition={stageDotSpring}
    >
      <div
        className="relative flex items-center justify-center"
        style={{ width: DOT_PX, height: DOT_PX }}
      >
        {status === "active" && (
          <motion.div
            className="absolute inset-[-4px] rounded-full"
            initial={{ opacity: 0 }}
            animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            style={{
              background:
                "radial-gradient(circle, rgba(79,70,229,0.25) 0%, transparent 70%)",
            }}
          />
        )}

        <motion.div
          className={clsx(
            "rounded-full flex items-center justify-center",
            status === "active" &&
              "bg-indigo-600 shadow-[0_0_0_3px_rgba(79,70,229,0.12),0_2px_8px_rgba(79,70,229,0.3)]",
            status === "completed" &&
              "bg-green-600 shadow-[0_1px_4px_rgba(22,163,74,0.2)]",
            status === "visited" && "bg-gray-400",
            status === "unvisited" && "bg-white border-[2.5px] border-gray-200"
          )}
          style={{ width: DOT_PX, height: DOT_PX }}
          transition={stageDotSpring}
        >
          {status === "completed" ? (
            <svg
              className="w-[18px] h-[18px] text-white"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <span
              className={clsx(
                "text-xs font-bold leading-none",
                status === "active" || status === "visited"
                  ? "text-white"
                  : "text-gray-400"
              )}
            >
              {index + 1}
            </span>
          )}
        </motion.div>
      </div>

      <motion.div
        layout={!skipLayout}
        className="mt-1.5 text-center w-full"
        transition={stageDotSpring}
      >
        <p
          className={clsx(
            "text-[11px] sm:text-xs font-semibold leading-tight tracking-wide",
            status === "active" ? "text-indigo-600" : "text-gray-700"
          )}
        >
          {stage.label}
        </p>
        {stage.dept && (
          <p className="text-[9px] sm:text-[10px] text-gray-400 leading-tight mt-px">
            {stage.dept}
          </p>
        )}
        {stage.duration > 0 && (
          <p
            className={clsx(
              "text-[10px] sm:text-xs mt-0.5 leading-tight tabular-nums",
              stage.isActive ? "text-indigo-600 font-semibold" : "text-gray-400"
            )}
          >
            {fmtDur(stage.duration)}
          </p>
        )}
        {stage.isActive && (
          <p className="text-[10px] text-indigo-500 mt-0.5 font-medium animate-pulse leading-tight">
            In Progress
          </p>
        )}
        {stage.isWaiting && (
          <p className="text-[10px] text-gray-300 mt-0.5 font-medium leading-tight">
            Waiting
          </p>
        )}
        {stage.visits > 1 && (
          <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
            {stage.visits} visits
          </p>
        )}
        {stage.isRepair && (
          <p className="text-[10px] text-amber-500 mt-0.5 font-medium leading-tight">
            Repair
          </p>
        )}
        {stage.isQC && (
          <p className="text-[10px] text-green-600 mt-0.5 font-medium leading-tight">
            In QC
          </p>
        )}
      </motion.div>
    </motion.div>
  );
});
StageDot.displayName = "StageDot";

/* ══════════════════════════════════════════════ */
/*  Stage Progress Bar                            */
/* ══════════════════════════════════════════════ */

const StageProgressBar = React.memo(
  ({ stages, title, stableIds, allDone, skipLayout }) => {
    const n = stages.length;
    const allCompleted = n > 0 && stages.every((s) => s.isCompleted);
    const activeIdx = stages.findIndex((s) => s.isActive);

    let targetIdx = -1;
    if (allCompleted || allDone) {
      targetIdx = n;
    } else if (activeIdx >= 0) {
      targetIdx = activeIdx;
    } else {
      for (let i = n - 1; i >= 0; i--) {
        if (stages[i].isCompleted || stages[i].wasVisited) {
          targetIdx = i;
          break;
        }
      }
    }

    const dotCenter = DOT_PX / 2;

    const interDotPct =
      targetIdx < 0
        ? -1
        : targetIdx >= n
        ? 100
        : n <= 1
        ? 100
        : (targetIdx / (n - 1)) * 100;

    const fillPastEnd = targetIdx >= n;

    return (
      <motion.div
        layout={!skipLayout}
        transition={stageDotSpring}
        className="mb-5 sm:mb-7"
      >
        <motion.h3
          layout={!skipLayout ? "position" : false}
          transition={stageDotSpring}
          className="text-[11px] sm:text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4 sm:mb-5"
        >
          {title}
        </motion.h3>

        <motion.div
          layout={!skipLayout}
          transition={stageDotSpring}
          className="relative"
        >
          <div
            className="absolute rounded-full bg-gray-100"
            style={{
              left: dotCenter - TRACK_PAD,
              right: dotCenter - TRACK_PAD,
              top: dotCenter - TRACK_H / 2,
              height: TRACK_H,
            }}
          />

          {interDotPct >= 0 && (
            <motion.div
              className="absolute rounded-full"
              style={{
                left: dotCenter - TRACK_PAD,
                top: dotCenter - TRACK_H / 2,
                height: TRACK_H,
                background:
                  "linear-gradient(90deg, #22c55e 0%, #16a34a 70%, #15803d 100%)",
                boxShadow: "0 1px 4px rgba(22,163,74,0.2)",
              }}
              animate={{
                right: fillPastEnd
                  ? `${dotCenter - TRACK_PAD}px`
                  : `calc(${((2 * n - 2 * targetIdx - 1) / (2 * n)) * 100}%)`,
              }}
              initial={false}
              transition={fillSpring}
            />
          )}

          <div
            className="relative"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${n}, 1fr)`,
            }}
          >
            {stages.map((stage, i) => (
              <StageDot
                key={stableIds?.[i] || stage.key}
                stableKey={stableIds?.[i] || stage.key}
                stage={stage}
                index={i}
                skipLayout={skipLayout}
              />
            ))}
          </div>
        </motion.div>
      </motion.div>
    );
  }
);
StageProgressBar.displayName = "StageProgressBar";

/* ══════════════════════════════════════════════ */
/*  Compact Chain Info (single view only)         */
/* ══════════════════════════════════════════════ */

const CompactChainInfo = React.memo(({ workflowStatus }) => {
  if (!workflowStatus?.isWorkflow) return null;
  const { chain } = workflowStatus;
  const activeIdx = chain.findIndex((c) => !c.completed);
  const allDone = chain.every((c) => c.completed);

  return (
    <div className="bg-gray-50 rounded-lg p-2.5 sm:p-3">
      <div className="text-xs text-gray-500 mb-0.5 sm:mb-1">Chain</div>
      <div className="flex items-center gap-1.5">
        {chain.map((c, i) => {
          const isCompleted = c.completed;
          const isActive = i === activeIdx;
          const dept = normDept(c.department);
          return (
            <React.Fragment key={c.id}>
              {i > 0 && (
                <svg
                  className={clsx(
                    "w-3 h-3 flex-shrink-0",
                    chain[i - 1]?.completed ? "text-green-400" : "text-gray-300"
                  )}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              )}
              <div
                className={clsx(
                  "flex items-center justify-center rounded-full text-[9px] font-bold flex-shrink-0",
                  isCompleted
                    ? "bg-green-500 text-white"
                    : isActive
                    ? "bg-indigo-500 text-white"
                    : "bg-gray-200 text-gray-500"
                )}
                style={{ width: 20, height: 20 }}
                title={`${dept}${
                  isCompleted
                    ? " — Done"
                    : isActive
                    ? " — Active"
                    : " — Waiting"
                }`}
              >
                {isCompleted ? (
                  <svg
                    className="w-2.5 h-2.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div className="text-[10px] text-gray-400 mt-1 leading-tight">
        {allDone ? (
          <span className="text-green-600 font-medium">All complete</span>
        ) : activeIdx >= 0 ? (
          <span>
            In{" "}
            <span className="text-indigo-500 font-medium">
              {normDept(chain[activeIdx].department)}
            </span>
          </span>
        ) : (
          "Pending"
        )}
      </div>
    </div>
  );
});
CompactChainInfo.displayName = "CompactChainInfo";

/* ══════════════════════════════════════════════ */
/*  History Item                                  */
/* ══════════════════════════════════════════════ */

const HistoryItem = React.memo(({ item, showDept }) => (
  <motion.div
    layout="position"
    initial={{ opacity: 0, scale: 0.95, x: -12 }}
    animate={{ opacity: 1, scale: 1, x: 0 }}
    exit={{ opacity: 0, scale: 0.92, x: 12, transition: { duration: 0.15 } }}
    transition={snappySpring}
    className={clsx(
      "flex items-start space-x-2 sm:space-x-3 p-2 sm:p-3 rounded-lg border",
      actionColors[item.actionType]
    )}
  >
    <div className="flex-shrink-0 mt-0.5">
      <ActionIcon type={item.actionType} />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-xs sm:text-sm font-medium text-gray-900">
        {item.action}
      </p>
      <div className="mt-0.5 sm:mt-1 flex items-center gap-1.5 text-xs text-gray-500 flex-wrap">
        {showDept && item.department && (
          <>
            <span className="font-semibold text-gray-600">
              {item.department}
            </span>
            <span className="text-gray-300">·</span>
          </>
        )}
        <span className="font-mono">{fmtTs(item.created_at)}</span>
        <span className="text-gray-300">·</span>
        <span>by {item.user_name}</span>
      </div>
    </div>
  </motion.div>
));
HistoryItem.displayName = "HistoryItem";

/* ══════════════════════════════════════════════ */
/*  MAIN                                          */
/* ══════════════════════════════════════════════ */

export default function CaseHistory({ id, caseNumber, onClose }) {
  const [rows, setRows] = useState([]);
  const [caseData, setCaseData] = useState(null);
  const [insights, setInsights] = useState(null);
  const [completionTime, setCompletionTime] = useState(null);
  const [creationInfo, setCreationInfo] = useState(null);
  const [stageHistory, setStageHistory] = useState([]);
  const [workflowStatus, setWorkflowStatus] = useState(null);

  const [chainHistories, setChainHistories] = useState({});
  const [chainCompletionDates, setChainCompletionDates] = useState({});
  const [chainCaseData, setChainCaseData] = useState({});
  const [unifiedRows, setUnifiedRows] = useState([]);
  const [chainLoaded, setChainLoaded] = useState(false);

  const [isClosing, setIsClosing] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [isUnifiedView, setIsUnifiedView] = useState(true);
  const [coreLoaded, setCoreLoaded] = useState(false);

  const [viewTransitioning, setViewTransitioning] = useState(false);
  const viewTransitionTimer = useRef(null);

  const popupRef = useRef(null);
  const mountedRef = useRef(true);
  const loadingStartRef = useRef(null);
  const timersRef = useRef([]);
  const scrollRef = useRef(null);

  const defer = useCallback((fn, ms) => {
    const t = setTimeout(fn, ms);
    timersRef.current.push(t);
    return t;
  }, []);

  const { allRows, workflowMap } = useMut();
  const [caseNum, caseNotes] = useMemo(
    () => splitCase(caseNumber),
    [caseNumber]
  );

  /** Hour (0-23) parsed from the case note, or null if no time is present. */
  const noteHour = useMemo(() => parseNoteTime(caseNumber), [caseNumber]);

  const isWorkflow = workflowStatus?.isWorkflow;
  const chainCases = useMemo(
    () =>
      (workflowStatus?.chain || []).sort(
        (a, b) => new Date(a.due) - new Date(b.due)
      ),
    [workflowStatus]
  );
  const showUnified = isWorkflow && isUnifiedView && chainLoaded;

  const handleViewSwitch = useCallback((unified) => {
    setViewTransitioning(true);
    if (viewTransitionTimer.current) clearTimeout(viewTransitionTimer.current);
    viewTransitionTimer.current = setTimeout(
      () => setViewTransitioning(false),
      650
    );
    setIsUnifiedView(unified);
    if (scrollRef.current)
      scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timersRef.current.forEach(clearTimeout);
      if (viewTransitionTimer.current)
        clearTimeout(viewTransitionTimer.current);
    };
  }, []);

  useEffect(() => {
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    const b = document.body;
    const h = document.documentElement;
    const prevOverflow = b.style.overflow;
    const prevPaddingRight = b.style.paddingRight;
    const prevHtmlOverflow = h.style.overflow;
    b.style.overflow = "hidden";
    h.style.overflow = "hidden";
    if (scrollbarWidth > 0) b.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      b.style.overflow = prevOverflow;
      b.style.paddingRight = prevPaddingRight;
      h.style.overflow = prevHtmlOverflow;
    };
  }, []);

  useEffect(() => {
    defer(() => mountedRef.current && setIsReady(true), 50);
  }, [defer]);
  useEffect(() => {
    defer(() => {
      if (!mountedRef.current || isExpanded) return;
      setShowLoading(true);
      loadingStartRef.current = Date.now();
    }, 200);
  }, [defer, isExpanded]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const [caseRes, histRes] = await Promise.all([
        db.from("cases").select("*").eq("id", id).single(),
        db
          .from("case_history")
          .select("*")
          .eq("case_id", id)
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const { data: rawCase, error: caseErr } = caseRes;
      const { data: hist = [] } = histRes;
      if (caseErr || !rawCase) {
        setCoreLoaded(true);
        return;
      }

      const mapped = mapCaseRow(rawCase);
      setCaseData(mapped);

      const now = new Date();
      const created = new Date(rawCase.created_at);
      const [dueY, dueM, dueD] = rawCase.due.split("T")[0].split("-");
      const due = new Date(dueY, dueM - 1, dueD);
      const daysUntilDue = Math.floor((due - now) / 864e5);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      setInsights({
        daysActive: Math.floor((now - created) / 864e5),
        daysUntilDue,
        businessDaysUntilDue: getBusinessDays(now, due),
        totalHoldTime: rawCase.hold_started
          ? Math.floor((now - new Date(rawCase.hold_started)) / 36e5)
          : 0,
        isOverdue: due < todayStart && !rawCase.completed,
        isUrgent:
          (rawCase.priority || rawCase.modifiers?.includes("rush")) &&
          daysUntilDue <= 1,
      });

      const creationEntry = hist.find((h) =>
        h.action.toLowerCase().includes("case created")
      );
      if (creationEntry)
        setCreationInfo({
          timestamp: creationEntry.created_at,
          user: creationEntry.user_name || "Unknown",
        });

      setStageHistory(
        hist.filter(
          (h) =>
            h.action.includes("stage") ||
            h.action === "Case created" ||
            h.action === "Marked done" ||
            h.action.includes("Assigned to") ||
            h.action.includes("Moved from") ||
            h.action.includes("repair") ||
            h.action.includes("Quality Control") ||
            h.action.includes("quality control")
        )
      );

      const filtered = filterHistRows(hist, mapped.department);
      const doneEntry = filtered.find((h) =>
        h.action.toLowerCase().includes("marked done")
      );
      if (doneEntry) {
        const doneDate = new Date(doneEntry.created_at);
        const dueDate = new Date(dueY, dueM - 1, dueD);
        dueDate.setHours(
          getDueHour(rawCase.priority, parseNoteTime(rawCase.casenumber)),
          0, 0, 0
        );
        const diff = doneDate - dueDate;
        if (diff < 0) {
          const abs = Math.abs(diff);
          const d = Math.floor(abs / 864e5),
            h = Math.floor((abs % 864e5) / 36e5),
            m = Math.floor((abs % 36e5) / 6e4);
          let text;
          if (d > 0)
            text = `${d} day${d > 1 ? "s" : ""} ${h} hour${
              h !== 1 ? "s" : ""
            } early`;
          else if (h > 0)
            text = `${h} hour${h !== 1 ? "s" : ""} ${m} minute${
              m !== 1 ? "s" : ""
            } early`;
          else text = `${m} minute${m !== 1 ? "s" : ""} early`;
          setCompletionTime({ status: "early", text, color: "text-green-600" });
        } else {
          const d = Math.floor(diff / 864e5),
            h = Math.floor((diff % 864e5) / 36e5),
            m = Math.floor((diff % 36e5) / 6e4);
          if (d === 0 && h < 2)
            setCompletionTime({
              status: "onTime",
              text: "On time",
              color: "text-blue-600",
            });
          else {
            let text;
            if (d > 0)
              text = `${d} day${d > 1 ? "s" : ""} ${h} hour${
                h !== 1 ? "s" : ""
              } late`;
            else if (h > 0)
              text = `${h} hour${h !== 1 ? "s" : ""} ${m} minute${
                m !== 1 ? "s" : ""
              } late`;
            else text = `${m} minute${m !== 1 ? "s" : ""} late`;
            setCompletionTime({ status: "late", text, color: "text-red-600" });
          }
        }
      }
      setRows(filtered);

      const wf = workflowMap?.has(mapped.id)
        ? workflowMap.get(mapped.id)
        : allRows?.length
        ? getWorkflowStatus(mapped, allRows)
        : null;
      setWorkflowStatus(wf);

      if (!wf?.isWorkflow || !wf.chain || wf.chain.length < 2) {
        setCoreLoaded(true);
        return;
      }

      const chain = [...wf.chain].sort(
        (a, b) => new Date(a.due) - new Date(b.due)
      );
      const allIds = chain.map((c) => c.id);
      const otherIds = allIds.filter((cid) => cid !== id);

      const [casesRes, chainHistRes, doneRes] = await Promise.all([
        otherIds.length
          ? db.from("cases").select("*").in("id", otherIds)
          : { data: [] },
        db
          .from("case_history")
          .select("*")
          .in("case_id", allIds)
          .order("created_at", { ascending: false }),
        db
          .from("case_history")
          .select("case_id, created_at")
          .in("case_id", allIds)
          .ilike("action", "%marked done%")
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;

      const cMap = {};
      (casesRes.data || []).forEach((c) => {
        cMap[c.id] = mapCaseRow(c);
      });
      cMap[id] = mapped;
      setChainCaseData(cMap);
      const hMap = {};
      (chainHistRes.data || []).forEach((h) => {
        if (!hMap[h.case_id]) hMap[h.case_id] = [];
        hMap[h.case_id].push(h);
      });
      setChainHistories(hMap);
      const dMap = {};
      (doneRes.data || []).forEach((r) => {
        if (!dMap[r.case_id]) dMap[r.case_id] = r.created_at;
      });
      setChainCompletionDates(dMap);

      const unified = [];
      for (const c of chain) {
        const dept = normDept(c.department);
        (hMap[c.id] || []).forEach((h) => {
          if (h.action.toLowerCase().includes("case created")) return;
          const match = h.action.match(DUE_PAT);
          if (match && match[1] === match[2]) return;
          const processed = processActionText(h.action);
          unified.push({
            ...h,
            action: processed,
            user_name: h.user_name?.trim() || "—",
            actionType: getActionType(processed),
            department: dept,
          });
        });
      }
      unified.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setUnifiedRows(unified);
      setChainLoaded(true);
      setCoreLoaded(true);
    };
    run().catch((err) => {
      console.error(err);
      if (!cancelled) setCoreLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id, allRows, workflowMap]);

  useEffect(() => {
    if (!coreLoaded || !mountedRef.current) return;
    const go = () => mountedRef.current && setIsExpanded(true);
    if (showLoading && loadingStartRef.current)
      defer(go, Math.max(0, 500 - (Date.now() - loadingStartRef.current)));
    else go();
  }, [coreLoaded, showLoading, defer]);

  const handleClose = useCallback(() => {
    if (!mountedRef.current) return;
    setIsClosing(true);
  }, []);

  useEffect(() => {
    const onEsc = (e) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [handleClose]);
  useEffect(() => {
    const onClick = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target))
        handleClose();
    };
    const t = defer(
      () => window.addEventListener("mousedown", onClick, true),
      100
    );
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onClick, true);
    };
  }, [handleClose, defer]);

  /* ── Stage progress with upstream-awareness ── */
  const stageProgressData = useMemo(() => {
    if (!caseData) return null;
    if (showUnified && chainCases.length >= 2) {
      const allStages = [];
      const stableIds = [];
      const workflowAllDone = chainCases.every((c) => c.completed);
      for (let ci = 0; ci < chainCases.length; ci++) {
        const c = chainCases[ci];
        const cd = chainCaseData[c.id] || c;
        const dept = normDept(cd.department);
        const hist = chainHistories[c.id] || [];
        const upId = ci > 0 ? chainCases[ci - 1]?.id : null;
        const upTs =
          upId && chainCompletionDates[upId]
            ? new Date(chainCompletionDates[upId]).getTime()
            : null;
        const isPendingUpstream = ci > 0 && !chainCases[ci - 1].completed;
        if (dept === "Metal") {
          const ms = buildMetalStages(hist, cd, upTs, isPendingUpstream);
          ms.forEach((s) => {
            s.dept = "Metal";
            s.key = `${c.id}-${s.key}`;
          });
          allStages.push(...ms);
          stableIds.push(`metal-s1-${c.id}`, `metal-s2-${c.id}`);
        } else if (dept === "Digital") {
          const { stages: ds } = buildDigitalStages(
            hist,
            cd.digitalStage,
            cd,
            upTs,
            isPendingUpstream
          );
          ds.forEach((s) => {
            s.dept = "Digital";
            s.key = `${c.id}-${s.key}`;
          });
          allStages.push(...ds);
          stableIds.push(
            `digital-design-${c.id}`,
            `digital-production-${c.id}`,
            `digital-finishing-${c.id}`
          );
        } else {
          const doneTs = chainCompletionDates[c.id];
          let startT = new Date(c.created_at).getTime();
          if (upTs && startT < upTs) startT = upTs;
          const endT =
            c.completed && doneTs ? new Date(doneTs).getTime() : Date.now();
          const suppressed = isPendingUpstream && !c.completed;
          allStages.push({
            key: `${c.id}-cb`,
            label: "C&B",
            dept: "C&B",
            duration: suppressed ? 0 : Math.max(0, endT - startT),
            isActive: suppressed ? false : !c.completed,
            isCompleted: c.completed,
            wasVisited: !suppressed || c.completed,
            isWaiting: suppressed,
          });
          stableIds.push(`cb-${c.id}`);
        }
      }
      return {
        stages: allStages,
        title: "Workflow Progress",
        stableIds,
        allDone: workflowAllDone,
      };
    }
    if (caseData.department === "Metal") {
      const stages = buildMetalStages(stageHistory, caseData, null, false);
      return {
        stages,
        title: "Stage Progress",
        stableIds: [`metal-s1-${id}`, `metal-s2-${id}`],
        allDone: !!caseData.completed,
      };
    }
    if (caseData.department === "Digital" && caseData.digitalStage) {
      const { stages, isInQC, qcEnteredAt } = buildDigitalStages(
        stageHistory,
        caseData.digitalStage,
        caseData,
        null,
        false
      );
      const allDone = !!caseData.completed || isInQC;
      return {
        stages,
        title: "Stage Progress",
        isInQC,
        qcEnteredAt,
        stableIds: [
          `digital-design-${id}`,
          `digital-production-${id}`,
          `digital-finishing-${id}`,
        ],
        allDone,
      };
    }
    return null;
  }, [
    caseData,
    showUnified,
    chainCases,
    chainCaseData,
    chainHistories,
    chainCompletionDates,
    stageHistory,
    id,
  ]);

  const activeRows = showUnified ? unifiedRows : rows;

  const activityStats = useMemo(
    () =>
      activeRows.reduce(
        (a, r) => {
          if (r.action.toLowerCase().includes("hold added")) a.holdCount++;
          if (r.action.toLowerCase().includes("priority added"))
            a.priorityCount++;
          if (r.action.toLowerCase().includes("rush added")) a.rushCount++;
          if (r.actionType === "edit") a.editCount++;
          if (r.actionType === "note") a.noteCount++;
          if (r.actionType === "stage") a.stageCount++;
          return a;
        },
        {
          holdCount: 0,
          priorityCount: 0,
          rushCount: 0,
          editCount: 0,
          noteCount: 0,
          stageCount: 0,
        }
      ),
    [activeRows]
  );

  const modalStyle = useMemo(
    () => ({
      maxHeight: "95vh",
      boxShadow:
        "0 0 0 1px rgba(0,0,0,0.05),0 0 40px rgba(0,0,0,0.15),0 0 80px rgba(0,0,0,0.1),inset 0 0 0 1px rgba(255,255,255,0.1)",
    }),
    []
  );

  const hasBadges =
    caseData &&
    (caseData.priority ||
      caseData.rush ||
      caseData.hold ||
      caseData.newAccount);

  const unifiedStatus = useMemo(() => {
    if (!showUnified || !chainCases.length) return null;
    const allDone = chainCases.every((c) => c.completed);
    const last = chainCases[chainCases.length - 1];
    if (allDone) {
      const lastDoneTs = chainCompletionDates[last.id];
      const lastNoteHour = parseNoteTime(last.casenumber ?? last.caseNumber ?? "");
      const lateness = computeLateness(lastDoneTs, last.due, last.priority, lastNoteHour);
      if (lateness)
        return {
          label: "Complete",
          sub: `Delivered ${lateness.text}`,
          color: "text-red-600",
          subColor: "text-red-600",
        };
      if (lastDoneTs) {
        const done = new Date(lastDoneTs);
        const [y, m, d] = last.due.split("T")[0].split("-").map(Number);
        const due = new Date(y, m - 1, d);
        due.setHours(getDueHour(last.priority, lastNoteHour), 0, 0, 0);
        const diff = done - due;
        if (diff < 0) {
          const abs = Math.abs(diff);
          const dd = Math.floor(abs / 864e5);
          const hh = Math.floor((abs % 864e5) / 36e5);
          return {
            label: "Complete",
            sub:
              dd > 0
                ? `Delivered ${dd}d ${hh}h early`
                : `Delivered ${hh}h early`,
            color: "text-green-600",
            subColor: "text-green-600",
          };
        }
        return {
          label: "Complete",
          sub: "Delivered on time",
          color: "text-green-600",
          subColor: "text-blue-600",
        };
      }
      return { label: "Complete", sub: null, color: "text-green-600" };
    }
    const aIdx = chainCases.findIndex((c) => !c.completed);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const activeCase = aIdx >= 0 ? chainCases[aIdx] : last;
    const [y, m, d] = activeCase.due.split("T")[0].split("-").map(Number);
    const activeDue = new Date(y, m - 1, d);
    const isOverdue = activeDue < todayStart;
    if (isOverdue)
      return {
        label: "Late",
        color: "text-red-600",
        sub: null,
        showCountdown: true,
        countdownDue: activeCase.due,
        countdownPriority: activeCase.priority,
      };
    const daysLeft = Math.floor((activeDue - new Date()) / 864e5);
    return {
      label: "In Progress",
      sub: null,
      color: daysLeft <= 1 ? "text-orange-600" : "text-blue-600",
      showCountdown: daysLeft <= 1,
      countdownDue: activeCase.due,
      countdownPriority: activeCase.priority,
    };
  }, [showUnified, chainCases, chainCompletionDates]);

  const chainDetail = useMemo(() => {
    if (!showUnified || !chainCases.length) return null;
    return chainCases.map((c, ci) => {
      const cd = chainCaseData[c.id] || c;
      const dept = normDept(cd.department);
      const hist = chainHistories[c.id] || [];
      const creationEntry = hist.find((h) =>
        h.action.toLowerCase().includes("case created")
      );
      const doneTs = chainCompletionDates[c.id];
      const isPendingUpstream = ci > 0 && !chainCases[ci - 1].completed;
      const type =
        dept === "Metal"
          ? cd.stage2 || cd.modifiers?.includes("stage2")
            ? "Stage 2"
            : "Stage 1"
          : dept === "Digital"
          ? cd.modifiers?.includes("bbs")
            ? "BBS"
            : cd.modifiers?.includes("flex")
            ? "3D Flex"
            : "General"
          : "C&B";
      return {
        id: c.id,
        dept,
        type,
        created: c.created_at,
        createdBy: creationEntry?.user_name || "Unknown",
        due: c.due,
        priority: c.priority,
        completed: c.completed,
        completedAt: doneTs,
        isPendingUpstream,
      };
    });
  }, [
    showUnified,
    chainCases,
    chainCaseData,
    chainHistories,
    chainCompletionDates,
  ]);

  const statusDisplay = useMemo(() => {
    if (!caseData || !insights) return null;
    if (showUnified && unifiedStatus)
      return { ...unifiedStatus, type: "unified" };
    if (caseData.completed)
      return {
        label: "Complete",
        color: "text-green-600",
        sub: completionTime ? `Delivered ${completionTime.text}` : null,
        subColor: completionTime?.color,
        type: "single",
      };
    if (insights.isOverdue)
      return {
        label: "Late",
        color: "text-red-600",
        sub: null,
        showCountdown: true,
        countdownDue: caseData.due,
        countdownPriority: caseData.priority,
        countdownNoteHour: noteHour,
        type: "single",
      };
    return {
      label: "Active",
      sub: null,
      color: insights.daysUntilDue <= 1 ? "text-orange-600" : "text-blue-600",
      showCountdown: insights.daysUntilDue <= 1,
      countdownDue: caseData.due,
      countdownPriority: caseData.priority,
      countdownNoteHour: noteHour,
      type: "single",
    };
  }, [caseData, insights, showUnified, unifiedStatus, completionTime, noteHour]);

  return createPortal(
    <AnimatePresence onExitComplete={onClose}>
      {!isClosing && (
        <motion.div
          className="fixed inset-0 z-[300] pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 pointer-events-auto backdrop-blur-sm"
            onClick={handleClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            style={{ backgroundColor: "rgba(0,0,0,0.2)" }}
          />
          <AnimatePresence>
            {isReady && (
              <motion.div className="fixed inset-0 flex items-center justify-center pointer-events-none p-2 sm:p-4">
                <motion.div
                  ref={popupRef}
                  className="case-history-popup glass-panel max-w-2xl w-full pointer-events-auto overflow-hidden flex flex-col bg-white"
                  layout
                  initial={{ scale: 0, opacity: 0, borderRadius: "100%" }}
                  animate={{ scale: 1, opacity: 1, borderRadius: "1rem" }}
                  exit={{ scale: 0, opacity: 0, borderRadius: "100%" }}
                  transition={{
                    scale: {
                      type: "spring",
                      stiffness: 400,
                      damping: 25,
                      duration: 0.3,
                    },
                    opacity: { duration: 0.2, ease: "easeOut" },
                    borderRadius: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
                    layout: { ...gentleSpring, duration: 0.4 },
                  }}
                  style={modalStyle}
                >
                  <LayoutGroup>
                    <motion.div
                      layout="position"
                      className="flex flex-col h-full max-h-[95vh] overflow-hidden"
                    >
                      {!isExpanded ? (
                        <motion.div
                          layout
                          className="flex flex-col items-center justify-center py-12"
                        >
                          {showLoading ? (
                            <>
                              <LoadingSpinner />
                              <p className="mt-2 text-sm text-gray-500">
                                Loading case history…
                              </p>
                            </>
                          ) : (
                            <div className="h-8" />
                          )}
                        </motion.div>
                      ) : (
                        <>
                          {/* ═══ Header ═══ */}
                          <motion.div
                            layout="position"
                            className="flex-shrink-0 p-4 sm:p-6 pb-0"
                          >
                            <div className="flex items-start justify-between mb-1">
                              <motion.h2
                                layoutId="case-title"
                                className="text-xl sm:text-2xl font-semibold text-gray-900"
                              >
                                Case {caseNum}
                              </motion.h2>
                              <div className="flex items-center gap-2">
                                {isWorkflow && chainLoaded && (
                                  <motion.div
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="flex items-center bg-gray-100 rounded-md p-0.5"
                                  >
                                    <button
                                      onClick={() => handleViewSwitch(true)}
                                      className={clsx(
                                        "px-2 py-1 rounded text-[10px] sm:text-xs font-medium transition-all duration-200",
                                        isUnifiedView
                                          ? "bg-white text-gray-900 shadow-sm"
                                          : "text-gray-400 hover:text-gray-600"
                                      )}
                                    >
                                      All
                                    </button>
                                    <button
                                      onClick={() => handleViewSwitch(false)}
                                      className={clsx(
                                        "px-2 py-1 rounded text-[10px] sm:text-xs font-medium transition-all duration-200",
                                        !isUnifiedView
                                          ? "bg-white text-gray-900 shadow-sm"
                                          : "text-gray-400 hover:text-gray-600"
                                      )}
                                    >
                                      {normDept(caseData?.department)}
                                    </button>
                                  </motion.div>
                                )}
                                <button
                                  onClick={handleClose}
                                  className="p-1 sm:p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                                >
                                  <svg
                                    className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400"
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
                            {caseNotes && (
                              <p className="text-xs sm:text-sm text-gray-500 italic mb-3">
                                "{caseNotes}"
                              </p>
                            )}
                            {!caseNotes && <div className="mb-2" />}
                          </motion.div>

                          {/* ═══ Content ═══ */}
                          <motion.div
                            layout="position"
                            ref={scrollRef}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.1, duration: 0.3 }}
                            className={clsx(
                              "flex-1 px-4 sm:px-6 pb-4 sm:pb-6",
                              viewTransitioning
                                ? "overflow-hidden"
                                : "overflow-y-auto"
                            )}
                          >
                            {/* ── Status Card ── */}
                            {statusDisplay && (
                              <motion.div
                                layoutId="status-card"
                                transition={smoothSpring}
                                className="mb-4 sm:mb-6"
                              >
                                <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl p-4 sm:p-6 shadow-sm border border-gray-200">
                                  <div className="flex items-start justify-between">
                                    <div>
                                      <motion.div
                                        key={statusDisplay.label}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.25 }}
                                        className={`text-2xl sm:text-3xl font-bold ${statusDisplay.color} mb-0.5`}
                                      >
                                        {statusDisplay.label}
                                      </motion.div>
                                      <AnimatePresence mode="wait">
                                        {statusDisplay.sub && (
                                          <motion.div
                                            key={statusDisplay.sub}
                                            initial={{ opacity: 0, y: 4 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -4 }}
                                            transition={{ duration: 0.2 }}
                                            className={`text-xs sm:text-sm ${
                                              statusDisplay.subColor ||
                                              statusDisplay.color
                                            } font-medium`}
                                          >
                                            {statusDisplay.sub}
                                          </motion.div>
                                        )}
                                      </AnimatePresence>
                                      {statusDisplay.showCountdown && (
                                        <div
                                          className={`text-base sm:text-lg ${statusDisplay.color} font-mono tabular-nums mt-0.5`}
                                        >
                                          <CountdownTimer
                                            dueDate={statusDisplay.countdownDue}
                                            isPriority={
                                              statusDisplay.countdownPriority
                                            }
                                            noteHour={statusDisplay.countdownNoteHour ?? null}
                                          />
                                        </div>
                                      )}
                                    </div>
                                    {hasBadges && (
                                      <div className="flex flex-wrap gap-1.5 sm:gap-2">
                                        {caseData.priority && (
                                          <span className="inline-flex items-center px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs font-semibold bg-red-500 text-white shadow-sm">
                                            Priority
                                          </span>
                                        )}
                                        {caseData.rush && (
                                          <span className="inline-flex items-center px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs font-semibold bg-orange-500 text-white shadow-sm">
                                            Rush
                                          </span>
                                        )}
                                        {caseData.hold && (
                                          <span className="inline-flex items-center px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs font-semibold bg-amber-500 text-white shadow-sm">
                                            Hold
                                          </span>
                                        )}
                                        {caseData.newAccount && (
                                          <span className="inline-flex items-center px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs font-semibold bg-pink-500 text-white shadow-sm">
                                            New Account
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </motion.div>
                            )}

                            {/* ── Stage Progress ── */}
                            {stageProgressData && (
                              <>
                                <StageProgressBar
                                  stages={stageProgressData.stages}
                                  title={stageProgressData.title}
                                  stableIds={stageProgressData.stableIds}
                                  allDone={stageProgressData.allDone}
                                  skipLayout={viewTransitioning}
                                />
                                <AnimatePresence>
                                  {stageProgressData.isInQC && (
                                    <motion.div
                                      initial={{ opacity: 0, height: 0 }}
                                      animate={{ opacity: 1, height: "auto" }}
                                      exit={{ opacity: 0, height: 0 }}
                                      transition={smoothSpring}
                                      className="-mt-2 mb-4 sm:mb-6 overflow-hidden"
                                    >
                                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                                        <div className="flex items-center gap-2">
                                          <svg
                                            className="w-5 h-5 text-green-600"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth={2}
                                              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                            />
                                          </svg>
                                          <span className="text-sm font-medium text-green-800">
                                            In Quality Control
                                          </span>
                                          {stageProgressData.qcEnteredAt && (
                                            <span className="text-xs text-green-600 ml-auto">
                                              Since{" "}
                                              {fmtTs(
                                                stageProgressData.qcEnteredAt
                                              )}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </>
                            )}

                            {/* ── Info Section ── */}
                            {caseData && (
                              <motion.div
                                layoutId="info-section"
                                transition={smoothSpring}
                                className="mb-4 sm:mb-6"
                              >
                                <AnimatePresence
                                  mode="popLayout"
                                  initial={false}
                                >
                                  {showUnified && chainDetail ? (
                                    <motion.div
                                      key="unified-table"
                                      initial={{ opacity: 0, y: 8 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{
                                        opacity: 0,
                                        y: -8,
                                        transition: { duration: 0.12 },
                                      }}
                                      transition={{
                                        duration: 0.25,
                                        ease: "easeInOut",
                                      }}
                                    >
                                      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                        <table className="w-full text-left">
                                          <thead>
                                            <tr className="bg-gray-50 border-b border-gray-200">
                                              <th className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 sm:px-4 py-2 w-[22%]">
                                                Dept
                                              </th>
                                              <th className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 sm:px-4 py-2 w-[30%]">
                                                Created
                                              </th>
                                              <th className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 sm:px-4 py-2 w-[18%]">
                                                Due
                                              </th>
                                              <th className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 sm:px-4 py-2 w-[30%] text-right">
                                                Status
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {chainDetail.map((d, i) => {
                                              const lateness = d.completed
                                                ? computeLateness(
                                                    d.completedAt,
                                                    d.due,
                                                    d.priority
                                                  )
                                                : null;
                                              let statusEl;
                                              if (d.completed && lateness)
                                                statusEl = (
                                                  <div>
                                                    <div className="text-xs sm:text-sm font-semibold text-red-600 leading-tight">
                                                      Late
                                                    </div>
                                                    <div className="text-[11px] sm:text-xs text-red-500 leading-tight">
                                                      {lateness.text}
                                                    </div>
                                                  </div>
                                                );
                                              else if (
                                                d.completed &&
                                                d.completedAt
                                              )
                                                statusEl = (
                                                  <div>
                                                    <div className="text-xs sm:text-sm font-semibold text-green-600 leading-tight">
                                                      Done
                                                    </div>
                                                    <div className="text-[11px] sm:text-xs text-gray-400 leading-tight">
                                                      {fmtDateCompact(
                                                        d.completedAt
                                                      )}
                                                    </div>
                                                  </div>
                                                );
                                              else if (d.completed)
                                                statusEl = (
                                                  <span className="text-xs sm:text-sm font-semibold text-green-600">
                                                    Done
                                                  </span>
                                                );
                                              else if (d.isPendingUpstream)
                                                statusEl = (
                                                  <span className="text-xs sm:text-sm font-semibold text-gray-400">
                                                    Waiting
                                                  </span>
                                                );
                                              else
                                                statusEl = (
                                                  <span className="text-xs sm:text-sm font-semibold text-indigo-600">
                                                    Active
                                                  </span>
                                                );
                                              return (
                                                <motion.tr
                                                  key={d.id}
                                                  initial={{
                                                    opacity: 0,
                                                    x: -8,
                                                  }}
                                                  animate={{ opacity: 1, x: 0 }}
                                                  transition={{
                                                    delay: i * 0.05,
                                                    ...snappySpring,
                                                  }}
                                                  className={clsx(
                                                    i > 0 &&
                                                      "border-t border-gray-100"
                                                  )}
                                                >
                                                  <td className="px-3 sm:px-4 py-2.5 align-top">
                                                    <div
                                                      className={clsx(
                                                        "text-sm sm:text-base font-semibold leading-tight",
                                                        d.isPendingUpstream &&
                                                          !d.completed
                                                          ? "text-gray-400"
                                                          : "text-gray-800"
                                                      )}
                                                    >
                                                      {d.dept}
                                                    </div>
                                                    <div className="text-[11px] sm:text-xs text-gray-400 leading-tight">
                                                      {d.type}
                                                    </div>
                                                  </td>
                                                  <td className="px-3 sm:px-4 py-2.5 align-top">
                                                    <div className="text-xs sm:text-sm text-gray-700 leading-tight">
                                                      {fmtTsShort(d.created)}
                                                    </div>
                                                    <div className="text-[11px] sm:text-xs text-gray-400 leading-tight">
                                                      by {d.createdBy}
                                                    </div>
                                                  </td>
                                                  <td className="px-3 sm:px-4 py-2.5 align-top">
                                                    <div className="text-xs sm:text-sm text-gray-700 leading-tight">
                                                      {fmtDateCompact(d.due)}
                                                    </div>
                                                    <div className="text-[11px] sm:text-xs text-gray-400 leading-tight">
                                                      {d.priority
                                                        ? "12 PM"
                                                        : "5 PM"}
                                                    </div>
                                                  </td>
                                                  <td className="px-3 sm:px-4 py-2.5 align-top text-right">
                                                    {statusEl}
                                                  </td>
                                                </motion.tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    </motion.div>
                                  ) : (
                                    <motion.div
                                      key="single-cards"
                                      initial={{ opacity: 0, y: 8 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{
                                        opacity: 0,
                                        y: -8,
                                        transition: { duration: 0.12 },
                                      }}
                                      transition={{
                                        duration: 0.25,
                                        ease: "easeInOut",
                                      }}
                                    >
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4 sm:mb-6">
                                        <motion.div
                                          layout
                                          className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4"
                                          transition={smoothSpring}
                                        >
                                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 sm:mb-2">
                                            Created
                                          </div>
                                          <div className="text-xs sm:text-sm font-semibold text-gray-900">
                                            {fmtTs(
                                              creationInfo?.timestamp ||
                                                caseData.created_at
                                            )}
                                          </div>
                                          <div className="text-xs text-gray-500 mt-0.5 sm:mt-1">
                                            by {creationInfo?.user || "Unknown"}
                                          </div>
                                        </motion.div>
                                        <motion.div
                                          layout
                                          className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4"
                                          transition={smoothSpring}
                                        >
                                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 sm:mb-2">
                                            Due
                                          </div>
                                          <div className="text-xs sm:text-sm font-semibold text-gray-900">
                                            {fmtDateOnly(caseData.due)}
                                          </div>
                                          <div className="text-xs text-gray-500 mt-0.5 sm:mt-1">
                                            {noteHour !== null
                                              ? fmtHour12(noteHour)
                                              : caseData.priority
                                              ? "12:00 PM"
                                              : "5:00 PM"}{" "}
                                            MST
                                          </div>
                                        </motion.div>
                                      </div>
                                      <div
                                        className={clsx(
                                          "grid gap-2 sm:gap-3",
                                          workflowStatus?.isWorkflow
                                            ? "grid-cols-3"
                                            : "grid-cols-2"
                                        )}
                                      >
                                        <div className="bg-gray-50 rounded-lg p-2.5 sm:p-3">
                                          <div className="text-xs text-gray-500 mb-0.5 sm:mb-1">
                                            Department
                                          </div>
                                          <div
                                            className={clsx(
                                              "text-xs sm:text-sm font-semibold",
                                              caseData.department === "Digital"
                                                ? "text-blue-600"
                                                : caseData.department === "C&B"
                                                ? "text-purple-600"
                                                : "text-gray-700"
                                            )}
                                          >
                                            {caseData.department}
                                          </div>
                                        </div>
                                        <div className="bg-gray-50 rounded-lg p-2.5 sm:p-3">
                                          <div className="text-xs text-gray-500 mb-0.5 sm:mb-1">
                                            Type
                                          </div>
                                          <div className="text-xs sm:text-sm font-semibold text-gray-700">
                                            {caseData.department === "Metal"
                                              ? caseData.stage2
                                                ? "Stage 2"
                                                : "Stage 1"
                                              : caseData.caseType === "bbs"
                                              ? "BBS"
                                              : caseData.caseType === "flex"
                                              ? "3D Flex"
                                              : "General"}
                                          </div>
                                        </div>
                                        {workflowStatus?.isWorkflow && (
                                          <CompactChainInfo
                                            workflowStatus={workflowStatus}
                                          />
                                        )}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </motion.div>
                            )}

                            <motion.div
                              layoutId="divider"
                              transition={smoothSpring}
                              className="border-t border-gray-200 mb-4"
                            />

                            {/* ── Activity History ── */}
                            <div>
                              <motion.div
                                layout="position"
                                transition={smoothSpring}
                                className="mb-3 sm:mb-4"
                              >
                                <div className="flex items-center justify-between">
                                  <h3 className="text-xs sm:text-sm font-semibold text-gray-700 uppercase tracking-wider">
                                    <AnimatePresence mode="wait">
                                      <motion.span
                                        key={showUnified ? "unified" : "single"}
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -6 }}
                                        transition={{ duration: 0.15 }}
                                      >
                                        {showUnified
                                          ? "Unified Activity"
                                          : "Activity History"}
                                      </motion.span>
                                    </AnimatePresence>
                                  </h3>
                                  {activeRows.length > 0 && (
                                    <motion.div
                                      key={activeRows.length}
                                      initial={{ opacity: 0 }}
                                      animate={{ opacity: 1 }}
                                      className="flex items-center gap-2 sm:gap-4 text-xs text-gray-500"
                                    >
                                      <span>
                                        <span className="font-semibold text-gray-700">
                                          {activeRows.length}
                                        </span>{" "}
                                        total
                                      </span>
                                      {activityStats.editCount > 0 && (
                                        <span className="hidden sm:inline">
                                          <span className="font-semibold text-purple-700">
                                            {activityStats.editCount}
                                          </span>{" "}
                                          edits
                                        </span>
                                      )}
                                      {activityStats.stageCount > 0 && (
                                        <span className="hidden sm:inline">
                                          <span className="font-semibold text-indigo-700">
                                            {activityStats.stageCount}
                                          </span>{" "}
                                          stage changes
                                        </span>
                                      )}
                                    </motion.div>
                                  )}
                                </div>
                              </motion.div>
                              {activeRows.length > 0 ? (
                                <div className="space-y-1.5 sm:space-y-2">
                                  <AnimatePresence
                                    initial={false}
                                    mode="popLayout"
                                  >
                                    {activeRows.map((item) => (
                                      <HistoryItem
                                        key={
                                          item.id ||
                                          `${item.case_id}-${item.created_at}`
                                        }
                                        item={item}
                                        showDept={showUnified}
                                      />
                                    ))}
                                  </AnimatePresence>
                                </div>
                              ) : (
                                <div className="text-center py-8 sm:py-12">
                                  <svg
                                    className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-gray-300"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                                    />
                                  </svg>
                                  <p className="mt-2 text-xs sm:text-sm text-gray-500">
                                    No activity recorded yet
                                  </p>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        </>
                      )}
                    </motion.div>
                  </LayoutGroup>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
