import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import CaseHistory from "./CaseHistory";

export default function DropdownMenu({
  row,
  completed,
  onClose,
  onEdit,
  toggleDone,
  toggleHold,
  toggleRush,
  togglePriority,
  toggleStage2 /* NEW prop */,
  remove,
}) {
  const ref = useRef(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const outside = (e) => !ref.current?.contains(e.target) && onClose();
    window.addEventListener("click", outside);
    window.addEventListener("scroll", onClose, { passive: true });
    return () => {
      window.removeEventListener("click", outside);
      window.removeEventListener("scroll", onClose);
    };
  }, [onClose]);

  const isMetal = row.department === "Metal";

  return (
    <>
      {showHistory && (
        <CaseHistory id={row.id} onClose={() => setShowHistory(false)} />
      )}

      <motion.ul
        ref={ref}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        className="absolute top-full right-0 mt-2 z-50 w-44 origin-top-right rounded-lg bg-white shadow-lg ring-1 ring-gray-200 text-sm"
      >
        {/* Done / Undo */}
        <MenuBtn
          label={completed ? "Undo" : "Mark Done"}
          color={completed ? "green" : "blue"}
          onClick={() => {
            toggleDone(row.id, row.completed);
            onClose();
          }}
        />

        {/* Info */}
        <MenuBtn
          label="info"
          onClick={() => {
            setShowHistory(true);
            onClose();
          }}
        />

        {!completed && (
          <>
            <MenuBtn
              label="Edit"
              onClick={() => {
                onEdit(row);
                onClose();
              }}
            />

            <MenuBtn
              label={row.priority ? "Remove Priority" : "Set Priority"}
              color="red"
              onClick={() => {
                togglePriority(row);
                onClose();
              }}
            />
            <MenuBtn
              label={row.rush ? "Remove Rush" : "Set Rush"}
              color="orange"
              onClick={() => {
                toggleRush(row);
                onClose();
              }}
            />
            <MenuBtn
              label={row.hold ? "Remove Hold" : "Set Hold"}
              color="amber"
              onClick={() => {
                toggleHold(row);
                onClose();
              }}
            />

            {/* Metal stage toggle */}
            {isMetal && (
              <MenuBtn
                label={row.stage2 ? "Move to Stage 1" : "Move to Stage 2"}
                color="purple"
                onClick={() => {
                  toggleStage2(row);
                  onClose();
                }}
              />
            )}
          </>
        )}

        <MenuBtn
          label="Delete"
          color="red"
          onClick={() => {
            remove(row.id);
            onClose();
          }}
        />
      </motion.ul>
    </>
  );
}

function MenuBtn({ label, color = "gray", onClick }) {
  const hover =
    color === "gray"
      ? "hover:bg-gray-200 text-gray-700"
      : `hover:bg-${color}-100 text-${color}-700`;
  return (
    <li>
      <button
        onClick={onClick}
        className={`block w-full text-left px-4 py-2 ${hover}`}
      >
        {label}
      </button>
    </li>
  );
}
