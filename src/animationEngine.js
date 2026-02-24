// src/animationEngine.js
import React from "react";
import { motion } from "motion/react";
import clsx from "clsx";
import { parseLocalDate } from "./utils/date";

/* ───────── springs & layout ───────── */
export const SPRING = { type: "spring", stiffness: 500, damping: 40, mass: 2 };
export const FAST_EXIT = {
  type: "spring",
  stiffness: 1800,
  damping: 40,
  mass: 0.1,
};
export const TWEEN = { type: "tween", ease: "easeOut", duration: 0.25 };
export const layout = { layout: true, transition: { layout: SPRING } };

/* 1.5-s master clock → CSS var --pulse-clock */
const CYCLE = 1500;
if (typeof window !== "undefined" && !window.__pulseClockInit) {
  window.__pulseClockInit = true;
  const tick = () =>
    document.documentElement.style.setProperty(
      "--pulse-clock",
      `${-(Date.now() % CYCLE) / 1000}s`
    );
  tick();
  window.__pulseClockInterval = setInterval(tick, CYCLE);
}

/* helper */
export const guard = (k, fn) =>
  fn || (() => console.warn(`[animationEngine] missing: ${k}`));

/* ───────── Column shell ───────── */
export function ColumnShell({ children, isToday, metaColor }) {
  const bg =
    metaColor === "red"
      ? "bg-red-700"
      : metaColor === "amber"
      ? "bg-amber-700"
      : isToday
      ? "bg-yellow-100"
      : "bg-[#16525F]";
  return (
    <motion.div
      {...layout}
      className={clsx("flex-1 flex flex-col p-4 rounded-lg", bg)}
    >
      {children}
    </motion.div>
  );
}

export const ColumnHeader = ({ text, meta, isToday }) => (
  <motion.h2
    layout="position"
    transition={SPRING}
    className={clsx(
      "mb-3 text-center font-semibold",
      meta ? "text-white" : isToday ? "text-black" : "text-white"
    )}
  >
    {text}
  </motion.h2>
);

/* ───────── New Account Sheen Component - Vibrant Aurora ───────── */
function NewAccountSheen() {
  return (
    <>
      <motion.div
        animate={{
          x: ["-10%", "70%", "-10%"],
          y: ["-20%", "20%", "-20%"],
          scale: [1, 1.2, 1],
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          position: "absolute",
          top: "-50%",
          left: "-20%",
          width: "70%",
          height: "200%",
          background:
            "radial-gradient(ellipse at center, rgba(244,114,182,0.5) 0%, rgba(236,72,153,0.25) 40%, transparent 70%)",
          filter: "blur(25px)",
          pointerEvents: "none",
          zIndex: 1,
          willChange: "transform",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
        }}
      />
      <motion.div
        animate={{
          x: ["70%", "-10%", "70%"],
          y: ["20%", "-20%", "20%"],
          scale: [1.2, 1, 1.2],
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          position: "absolute",
          top: "-50%",
          right: "-20%",
          width: "70%",
          height: "200%",
          background:
            "radial-gradient(ellipse at center, rgba(34,211,238,0.45) 0%, rgba(56,189,248,0.2) 40%, transparent 70%)",
          filter: "blur(25px)",
          pointerEvents: "none",
          zIndex: 1,
          willChange: "transform",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
        }}
      />
      <motion.div
        animate={{
          x: ["20%", "80%", "20%"],
          y: ["0%", "0%", "0%"],
          opacity: [0.7, 1, 0.7],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          position: "absolute",
          top: "-30%",
          left: "0%",
          width: "50%",
          height: "160%",
          background:
            "radial-gradient(ellipse at center, rgba(167,139,250,0.4) 0%, rgba(139,92,246,0.15) 50%, transparent 70%)",
          filter: "blur(20px)",
          pointerEvents: "none",
          zIndex: 1,
          willChange: "transform, opacity",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
        }}
      />
      <motion.div
        animate={{
          x: ["50%", "20%", "50%"],
          opacity: [0.5, 0.8, 0.5],
        }}
        transition={{
          duration: 14,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          position: "absolute",
          top: "-20%",
          left: "0%",
          width: "40%",
          height: "140%",
          background:
            "radial-gradient(ellipse at center, rgba(251,191,36,0.3) 0%, transparent 60%)",
          filter: "blur(25px)",
          pointerEvents: "none",
          zIndex: 1,
          willChange: "transform, opacity",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
        }}
      />
      <motion.div
        initial={{ x: "-100%", opacity: 0 }}
        animate={{ x: "200%", opacity: [0, 0.9, 0.9, 0] }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut",
          repeatDelay: 2.5,
        }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "35%",
          height: "100%",
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 35%, rgba(255,255,255,0.45) 50%, rgba(255,255,255,0.2) 65%, transparent 100%)",
          filter: "blur(3px)",
          pointerEvents: "none",
          zIndex: 3,
          willChange: "transform, opacity",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
        }}
      />
      <motion.div
        initial={{ x: "-50%", opacity: 0 }}
        animate={{ x: "250%", opacity: [0, 0.7, 0.7, 0] }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeOut",
          repeatDelay: 4,
          delay: 1.5,
        }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "20%",
          height: "100%",
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)",
          filter: "blur(2px)",
          pointerEvents: "none",
          zIndex: 4,
          willChange: "transform, opacity",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "5%",
          right: "5%",
          height: "1px",
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 30%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0.5) 70%, transparent 100%)",
          pointerEvents: "none",
          zIndex: 5,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          boxShadow:
            "inset 0 2px 4px rgba(255,255,255,0.15), inset 0 -1px 2px rgba(0,0,0,0.1)",
          borderRadius: "inherit",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />
    </>
  );
}

/* ───────── Row shell ───────── */
export function RowShell({
  row,
  open,
  metaColor,
  dayRow,
  className,
  innerRef,
  onClick,
  children,
  workflowPending = false,
}) {
  const isPriority = row?.priority;
  const isRush = row?.rush;
  const isBBS = row?.modifiers?.includes("bbs");
  const isFlex = row?.modifiers?.includes("flex");
  const isStage2 = row?.modifiers?.includes("stage2");
  const isNewAccount = row?.modifiers?.includes("newaccount");

  /* flashing rules - disable for workflow pending */
  const flashBlue =
    !workflowPending && isPriority && !row.completed && inBlueWindow(row.due);
  const flashRed =
    !workflowPending &&
    ((!row.completed && metaColor === "red") ||
      (isPriority && !row.completed && inRedWindow(row.due)));

  /* base tint */
  let bg = "bg-[#4D8490]";
  if (isStage2) bg = "bg-[#6F5BA8]";
  else if (isBBS) bg = "bg-[#55679B]";
  else if (isFlex) bg = "bg-[#C75A9E]";

  /* overlay pulse */
  const flashClass = flashBlue ? "glow" : flashRed ? "pulse-red" : "";
  const baseStyle = flashClass
    ? {
        animationDelay: "var(--pulse-clock)",
        ...(flashRed && { "--pulse-color": "#ff1e1e" }),
      }
    : {};

  /* New account specific styles - disabled when workflow pending */
  const newAccountStyle =
    isNewAccount && !workflowPending
      ? {
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.2), 0 8px 32px -8px rgba(236,72,153,0.4), 0 4px 16px -4px rgba(56,189,248,0.3), 0 0 20px -4px rgba(167,139,250,0.3)",
        }
      : {};

  /* Workflow pending style - grayed out appearance */
  const workflowPendingStyle = workflowPending
    ? {
        opacity: 0.45,
        filter: "grayscale(0.6) brightness(0.85)",
      }
    : {};

  /* rings - muted for pending */
  const ringClass = workflowPending
    ? ""
    : isPriority
    ? "ring-[3px] ring-red-500"
    : isRush
    ? "ring-[3px] ring-orange-400"
    : "";

  const collapsed = !open && dayRow ? "justify-center" : "items-center";

  return (
    <motion.div
      {...layout}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: FAST_EXIT }}
      ref={innerRef}
      className={clsx(
        "relative mb-2 w-full flex px-4 py-2 pr-3 font-mono text-lg rounded",
        collapsed,
        bg,
        ringClass,
        !workflowPending && flashClass,
        open
          ? "cursor-default"
          : workflowPending
          ? "cursor-pointer hover:opacity-60"
          : "cursor-pointer hover:bg-opacity-90",
        "overflow-hidden",
        className
      )}
      style={{ ...baseStyle, ...newAccountStyle, ...workflowPendingStyle }}
      onClick={onClick}
    >
      {isNewAccount && !workflowPending && <NewAccountSheen />}
      {children}
    </motion.div>
  );
}

/* ───────── Reveal button ───────── */
const BTN_W = 76;
const BTN_W_SMALL = 32;

const BUBBLE_SPRING = {
  type: "spring",
  stiffness: 400,
  damping: 25,
  mass: 0.8,
};

const revealVar = {
  closed: {
    opacity: 0,
    scale: 0,
    width: 0,
    marginLeft: 0,
    transition: BUBBLE_SPRING,
  },
  open: {
    opacity: 1,
    scale: 1,
    width: BTN_W,
    marginLeft: 8,
    transition: BUBBLE_SPRING,
  },
  openSmall: {
    opacity: 1,
    scale: 1,
    width: BTN_W_SMALL,
    marginLeft: 8,
    transition: BUBBLE_SPRING,
  },
};

export function RevealButton({
  open,
  label,
  theme = "teal",
  onClick,
  small = false,
}) {
  const frosted =
    "backdrop-blur-md bg-white/35 ring-1 ring-white/30 text-white shadow hover:bg-white/40 transition-colors";

  return (
    <motion.button
      variants={revealVar}
      animate={open ? (small ? "openSmall" : "open") : "closed"}
      className={clsx(
        "overflow-hidden rounded px-3 py-1 text-sm font-semibold inline-block",
        frosted,
        small && "px-1 py-0.5"
      )}
      style={{ originX: 0, originY: 0.5 }}
      onClick={onClick}
    >
      {label}
    </motion.button>
  );
}

/* ───────── NEW • round header settings button ───────── */
export function SettingsCog({ onClick }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full p-2
                 bg-white/40 backdrop-blur-lg border border-white/40 shadow
                 hover:bg-white/60 transition"
      whileTap={{ scale: 0.85, rotate: -30 }}
      whileHover={{ scale: 1.08 }}
      aria-label="Settings"
    >
      <motion.svg
        viewBox="0 0 24 24"
        className="h-5 w-5 fill-current text-gray-800"
        animate={{ rotate: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M19.4 15a7.4 7.4 0 0 0 .15-1.5 7.4 7.4 0 0 0-.15-1.5l2.12-1.65a.5.5 0 0 0 .12-.63l-2-3.46a.5.5 0 0 0-.6-.23l-2.49 1a7.66 7.66 0 0 0-2.6-1.5l-.38-2.65A.5.5 0 0 0 13 2h-2a.5.5 0 0 0-.5.42l-.38 2.65a7.66 7.66 0 0 0-2.6 1.5l-2.49-1a.5.5 0 0 0-.6.23l-2 3.46a.5.5 0 0 0 .12.63L4.6 12a7.4 7.4 0 0 0-.15 1.5c0 .5.05 1 .15 1.5l-2.12 1.65a.5.5 0 0 0-.12.63l2 3.46a.5.5 0 0 0 .6.23l2.49-1a7.66 7.66 0 0 0 2.6 1.5l.38 2.65A.5.5 0 0 0 11 22h2a.5.5 0 0 0 .5-.42l.38-2.65a7.66 7.66 0 0 0 2.6-1.5l2.49 1a.5.5 0 0 0 .6-.23l2-3.46a.5.5 0 0 0-.12-.63Z" />
      </motion.svg>
    </motion.button>
  );
}

/* ───────── timing helpers ───────── */
function inBlueWindow(iso) {
  if (!iso) return false;
  const now = new Date();
  const due = parseLocalDate(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (due.getTime() !== today.getTime()) return false;
  const h = now.getHours(),
    m = now.getMinutes();
  return (h === 9 && m >= 45) || (h > 9 && h < 12);
}

function inRedWindow(iso) {
  if (!iso) return false;
  const now = new Date();
  const due = parseLocalDate(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due.getTime() === today.getTime() && now.getHours() >= 12;
}
