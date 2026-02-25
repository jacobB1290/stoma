/* global motion variants – used in DayCol & MetaCol */
export const enter = { x: 120, opacity: 0 };

export const stay = {
  x: 0,
  opacity: 1,
  transition: { type: "spring", stiffness: 500, damping: 32 },
};

export const leave = {
  x: -120,
  opacity: 0,
  transition: { duration: 0.25 },
};

/* internal card / button variants */
export const cardVar = { rest: { scale: 1 }, selected: { scale: 1.05 } };
export const numVar = { rest: { x: 0 }, selected: { x: "-25%" } };

export const btnVar = {
  hidden: { opacity: 0, scale: 0.8 },
  shown: { opacity: 1, scale: 1 },
};

/* ── Text jump-in variants ──────────────────────────────────────────────── */
/* Case numbers: drop from above with a high-frequency bounce            */
export const textJump = {
  hidden: { y: -10, opacity: 0, scale: 0.82 },
  visible: {
    y: 0,
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 900, damping: 10, mass: 0.2 },
  },
};

/* Descriptions / sub-labels: softer, slightly delayed sibling           */
export const descJump = {
  hidden: { y: -6, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 700,
      damping: 10,
      mass: 0.25,
      delay: 0.04,
    },
  },
};
