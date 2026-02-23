/* ──────────────────────────────────────────────────────────────
   Supabase client
   ─────────────────────────────────────────────────────────── */
import { createClient } from "@supabase/supabase-js";
import { v4 as uuid } from "uuid";

/* Supabase creds (env first, then hard-coded fallback) */
export const URL =
  process.env.REACT_APP_SUPABASE_URL ??
  "https://SUPABASE_PROJECT_REF_REMOVED.supabase.co";

export const KEY =
  process.env.REACT_APP_SUPABASE_ANON_KEY ??
  "SUPABASE_ANON_KEY_PART1_REMOVED" +
    "SUPABASE_ANON_KEY_PART2_REMOVED" +
    "SUPABASE_ANON_KEY_PART3_REMOVED";

export const db = createClient(URL, KEY, { auth: { persistSession: false } });

/* ──────────────────────────────────────────────────────────────
      Helpers – current user name
      ─────────────────────────────────────────────────────────── */
const getCurrentUserName = () => {
  const tmp = sessionStorage.getItem("tempUserName");
  if (tmp !== null) return tmp;
  const perm = localStorage.getItem("userName");
  if (perm !== null) return perm;
  if (sessionStorage.getItem("bypassUser") !== null) return "";
  return "Unknown";
};

/* ──────────────────────────────────────────────────────────────
      History logger
      ─────────────────────────────────────────────────────────── */
export const logCase = async (caseId, action) =>
  db.from("case_history").insert({
    id: uuid(),
    case_id: caseId,
    action,
    user_name: getCurrentUserName(),
  });

/* ──────────────────────────────────────────────────────────────
      CRUD helpers
      ─────────────────────────────────────────────────────────── */

/* ---------- Add (UPDATED WITH REPAIR OPTION) ---------- */
export const addCase = async ({
  caseNumber,
  department,
  due,
  priority,
  rush,
  hold,
  caseType,
  newAccount = false,
  needsRepair = false,
}) => {
  const modifiers = [
    ...(rush ? ["rush"] : []),
    ...(hold ? ["hold"] : []),
    ...(newAccount ? ["newaccount"] : []),
    ...(caseType === "bbs" ? ["bbs"] : []),
    ...(caseType === "flex" ? ["flex"] : []),
    ...(department === "Digital"
      ? [needsRepair ? "stage-finishing" : "stage-design"]
      : []),
  ];

  const { data, error } = await db
    .from("cases")
    .insert({
      id: uuid(),
      casenumber: caseNumber.trim(),
      department: department === "Digital" ? "General" : department,
      priority,
      modifiers,
      due: `${due}T00:00:00Z`,
      completed: false,
      archived: false,
    })
    .select()
    .single();

  if (!error && data?.id) {
    if (needsRepair && department === "Digital") {
      await logCase(
        data.id,
        "Case created and sent directly to Finishing for repair"
      );
    } else {
      await logCase(data.id, "Case created");
    }
  }
  return { data, error };
};

/* ---------- Update (with diff logging) ---------- */
export const updateCase = async (payload) => {
  const { id } = payload;
  const { data: prev } = await db
    .from("cases")
    .select("casenumber,department,due,priority,modifiers")
    .eq("id", id)
    .single();
  if (!prev) return { error: new Error("Row not found") };

  const prevNewAccount = prev.modifiers?.includes("newaccount") ?? false;
  const nextNewAccount =
    payload.newAccount != null ? payload.newAccount : prevNewAccount;
  const existingStageModifiers =
    prev.modifiers?.filter(
      (m) =>
        m.startsWith("stage-") ||
        m.startsWith("stats-exclude") ||
        m === "workflow-unlinked"
    ) || [];

  const nextMods = payload.modifiers ?? [
    ...(payload.rush ? ["rush"] : []),
    ...(payload.hold ? ["hold"] : []),
    ...(nextNewAccount ? ["newaccount"] : []),
    ...(payload.caseType === "bbs" ? ["bbs"] : []),
    ...(payload.caseType === "flex" ? ["flex"] : []),
    ...(prev.modifiers?.includes("stage2") ? ["stage2"] : []),
    ...existingStageModifiers,
  ];

  const nextRow = {
    casenumber: (payload.caseNumber ?? prev.casenumber).trim(),
    department:
      payload.department != null
        ? payload.department === "Digital"
          ? "General"
          : payload.department
        : prev.department,
    priority: payload.priority != null ? payload.priority : prev.priority,
    modifiers: nextMods,
    due: `${payload.due ?? prev.due.slice(0, 10)}T00:00:00Z`,
  };

  const { error } = await db.from("cases").update(nextRow).eq("id", id);
  if (error) return { error };

  /* ----- diff → history rows ----- */
  const logs = [];
  const diff = (flag) => ({
    was: prev.modifiers?.includes(flag) ?? false,
    now: nextMods.includes(flag),
  });

  const stage2Diff = diff("stage2");
  if (stage2Diff.was !== stage2Diff.now)
    logs.push(stage2Diff.now ? "Moved to Stage 2" : "Moved back to Stage 1");

  const modifierLabels = {
    rush: "Rush",
    hold: "Hold",
    bbs: "BBS",
    flex: "Flex",
    newaccount: "New Account",
  };

  ["rush", "hold", "bbs", "flex", "newaccount"].forEach((f) => {
    const d = diff(f);
    if (d.was !== d.now) {
      logs.push(
        d.now ? `${modifierLabels[f]} added` : `${modifierLabels[f]} removed`
      );
    }
  });

  if (prev.priority !== nextRow.priority)
    logs.push(nextRow.priority ? "Priority added" : "Priority removed");

  if (prev.casenumber !== nextRow.casenumber)
    logs.push(
      `Case # changed from ${prev.casenumber} to ${nextRow.casenumber}`
    );

  if (prev.department !== nextRow.department)
    logs.push(
      `Department changed from ${prev.department} to ${nextRow.department}`
    );

  if (prev.due !== nextRow.due)
    logs.push(
      `Due changed from ${prev.due.slice(0, 10)} to ${nextRow.due.slice(0, 10)}`
    );

  for (const l of logs) await logCase(id, l);
  return { error: null };
};

/* ---------- Stage-2 toggle ---------- */
export const toggleStage2 = async ({ id, modifiers = [] }) => {
  const m = new Set(modifiers);
  const nowStage2 = !m.has("stage2");
  nowStage2 ? m.add("stage2") : m.delete("stage2");
  await db
    .from("cases")
    .update({ modifiers: [...m] })
    .eq("id", id);
  await logCase(id, nowStage2 ? "Moved to Stage 2" : "Moved back to Stage 1");
};

/* ---------- Simple toggles ---------- */
export const togglePriority = async ({ id, priority }) => {
  await db.from("cases").update({ priority: !priority }).eq("id", id);
  await logCase(id, !priority ? "Priority added" : "Priority removed");
};

export const toggleRush = async ({ id, modifiers = [] }) => {
  const m = new Set(modifiers);
  m.has("rush") ? m.delete("rush") : m.add("rush");
  await db
    .from("cases")
    .update({ modifiers: [...m] })
    .eq("id", id);
  await logCase(id, m.has("rush") ? "rush added" : "rush removed");
};

export const toggleHold = async ({ id, modifiers = [] }) => {
  const m = new Set(modifiers);
  m.has("hold") ? m.delete("hold") : m.add("hold");
  await db
    .from("cases")
    .update({ modifiers: [...m] })
    .eq("id", id);
  await logCase(id, m.has("hold") ? "hold added" : "hold removed");
};

export const toggleNewAccount = async ({ id, modifiers = [] }) => {
  const m = new Set(modifiers);
  m.has("newaccount") ? m.delete("newaccount") : m.add("newaccount");
  await db
    .from("cases")
    .update({ modifiers: [...m] })
    .eq("id", id);
  await logCase(
    id,
    m.has("newaccount") ? "New Account added" : "New Account removed"
  );
};

export const toggleComplete = async (id, cur) => {
  await db.from("cases").update({ completed: !cur }).eq("id", id);
  await logCase(id, !cur ? "Marked done" : "Undo done");
};

/* ---------- Delete ---------- */
export const removeCase = async (id) => db.from("cases").delete().eq("id", id);

/* ---------- Archive functions ---------- */
export const archiveCases = async (caseIds) => {
  const { error } = await db
    .from("cases")
    .update({
      archived: true,
      archived_at: new Date().toISOString(),
    })
    .in("id", caseIds);

  if (!error) {
    for (const id of caseIds) {
      await logCase(id, "Case archived");
    }
  }

  return { error };
};

export const restoreCase = async (caseId) => {
  const { error } = await db
    .from("cases")
    .update({
      archived: false,
      archived_at: null,
    })
    .eq("id", caseId);

  if (!error) {
    await logCase(caseId, "Case restored from archive");
  }

  return { error };
};

export const fetchArchivedCases = async (searchQuery = "") => {
  let query = db
    .from("cases")
    .select("*")
    .eq("archived", true)
    .order("archived_at", { ascending: false });

  if (searchQuery) {
    query = query.ilike("casenumber", `%${searchQuery}%`);
  }

  return await query;
};

/* ---------- Unlink a case from its workflow chain ---------- */
export const unlinkFromWorkflow = async (caseId) => {
  const { data: currentCase, error: fetchError } = await db
    .from("cases")
    .select("modifiers")
    .eq("id", caseId)
    .single();

  if (fetchError) return { error: fetchError };

  const currentModifiers = currentCase.modifiers || [];

  // Already unlinked — no-op
  if (currentModifiers.includes("workflow-unlinked")) {
    return { error: null };
  }

  const newModifiers = [...currentModifiers, "workflow-unlinked"];

  const { error: updateError } = await db
    .from("cases")
    .update({ modifiers: newModifiers })
    .eq("id", caseId);

  if (!updateError) {
    await logCase(caseId, "Unlinked from workflow chain");
  }

  return { error: updateError };
};

/* ---------- Re-link a case to its workflow chain ---------- */
export const relinkToWorkflow = async (caseId) => {
  const { data: currentCase, error: fetchError } = await db
    .from("cases")
    .select("modifiers")
    .eq("id", caseId)
    .single();

  if (fetchError) return { error: fetchError };

  const currentModifiers = currentCase.modifiers || [];
  const newModifiers = currentModifiers.filter(
    (m) => m !== "workflow-unlinked"
  );

  const { error: updateError } = await db
    .from("cases")
    .update({ modifiers: newModifiers })
    .eq("id", caseId);

  if (!updateError) {
    await logCase(caseId, "Re-linked to workflow chain");
  }

  return { error: updateError };
};

/* ---------- Toggle case exclusion from statistics ---------- */
export const toggleCaseExclusion = async (
  caseId,
  stage = null,
  reason = null
) => {
  const { data: currentCase, error: fetchError } = await db
    .from("cases")
    .select("modifiers")
    .eq("id", caseId)
    .single();

  if (fetchError) return { error: fetchError };

  const currentModifiers = currentCase.modifiers || [];
  const newModifiers = [...currentModifiers];

  const filteredModifiers = newModifiers.filter(
    (m) =>
      !m.startsWith("stats-exclude") && !m.startsWith("stats-exclude-reason:")
  );

  const isCurrentlyExcluded = currentModifiers.some(
    (m) =>
      m === "stats-exclude" ||
      m === "stats-exclude:all" ||
      (stage && m === `stats-exclude:${stage}`)
  );

  let action;
  if (isCurrentlyExcluded) {
    action = stage
      ? `Included in ${stage} stage statistics`
      : "Included in all statistics";
  } else {
    if (stage) {
      filteredModifiers.push(`stats-exclude:${stage}`);
      action = `Excluded from ${stage} stage statistics`;
    } else {
      filteredModifiers.push("stats-exclude:all");
      action = "Excluded from all statistics";
    }

    if (reason) {
      filteredModifiers.push(`stats-exclude-reason:${reason}`);
    }
  }

  const { error: updateError } = await db
    .from("cases")
    .update({ modifiers: filteredModifiers })
    .eq("id", caseId);

  if (!updateError) {
    await logCase(caseId, action);
  }

  return { error: updateError, isExcluded: !isCurrentlyExcluded };
};

/* ---------- Batch toggle exclusions ---------- */
export const batchToggleExclusions = async (
  caseIds,
  exclude = true,
  stage = null,
  reason = null
) => {
  const results = [];

  for (const caseId of caseIds) {
    const { data: currentCase } = await db
      .from("cases")
      .select("modifiers")
      .eq("id", caseId)
      .single();

    if (!currentCase) continue;

    const currentModifiers = currentCase.modifiers || [];
    let newModifiers = currentModifiers.filter(
      (m) =>
        !m.startsWith("stats-exclude") && !m.startsWith("stats-exclude-reason:")
    );

    if (exclude) {
      if (stage) {
        newModifiers.push(`stats-exclude:${stage}`);
      } else {
        newModifiers.push("stats-exclude:all");
      }
      if (reason) {
        newModifiers.push(`stats-exclude-reason:${reason}`);
      }
    }

    const { error } = await db
      .from("cases")
      .update({ modifiers: newModifiers })
      .eq("id", caseId);

    if (!error) {
      const action = exclude
        ? stage
          ? `Excluded from ${stage} stage statistics`
          : "Excluded from all statistics"
        : stage
        ? `Included in ${stage} stage statistics`
        : "Included in all statistics";
      await logCase(caseId, action);
    }

    results.push({ caseId, success: !error, error });
  }

  return results;
};

/* ---------- Check for duplicates ---------- */
export const checkForDuplicates = async (caseNumber, excludeId = null) => {
  const searchTerm = caseNumber.trim().toLowerCase();
  const caseNumPart = searchTerm.split(" ")[0];

  let query = db
    .from("cases")
    .select("id, casenumber, department, due, completed")
    .eq("archived", false)
    .eq("completed", false);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error checking for duplicates:", error);
    return [];
  }

  const duplicates = data.filter((caseItem) => {
    const itemCaseNum = caseItem.casenumber.toLowerCase().split(" ")[0];
    return itemCaseNum === caseNumPart;
  });

  return duplicates;
};

/* ---------- Convenience fetchers ---------- */
export const fetchAllHistory = async () =>
  db
    .from("case_history")
    .select("action,created_at,user_name,cases:case_id(casenumber)")
    .order("created_at", { ascending: false });

export const fetchInitialCases = async () =>
  db
    .from("cases")
    .select("casenumber,created_at")
    .eq("archived", false)
    .order("created_at", { ascending: false });
