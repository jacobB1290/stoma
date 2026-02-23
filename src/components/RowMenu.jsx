import React, {
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
  useCallback,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import clsx from "clsx";
import CaseHistory from "./CaseHistory";
import { useMut } from "../context/DataContext";
import { archiveCases } from "../services/caseService";

const DIGITAL_STAGES = ["design", "production", "finishing"];
const METAL_STAGES = ["stage1", "stage2"];

const getCurrentDigitalStage = (modifiers = []) => {
  const stageMod = modifiers.find((m) => m.startsWith("stage-"));
  if (!stageMod) return null;
  return stageMod.replace("stage-", "");
};

const getNextDigitalStage = (currentStage) => {
  const currentIndex = DIGITAL_STAGES.indexOf(currentStage);
  if (currentIndex === -1 || currentIndex >= DIGITAL_STAGES.length - 1) {
    return null;
  }
  return DIGITAL_STAGES[currentIndex + 1];
};

const getStageDisplayName = (stage) => {
  const names = {
    design: "Design",
    production: "Production",
    finishing: "Finishing",
    qc: "Quality Control",
    stage1: "Stage 1",
    stage2: "Stage 2",
  };
  return names[stage] || stage;
};

export default function RowMenu({
  row,
  completed,
  onEdit,
  toggleDone,
  toggleHold,
  toggleNewAccount,
  toggleRush,
  togglePriority,
  toggleStage2,
  onArchive,
}) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const eventListenersRef = useRef([]);

  const cleanupEventListeners = useCallback(() => {
    eventListenersRef.current.forEach(({ type, handler }) => {
      window.removeEventListener(type, handler);
    });
    eventListenersRef.current = [];
  }, []);

  useEffect(() => {
    if (!open) return;

    const close = () => setOpen(false);
    const events = ["scroll", "wheel", "resize", "touchmove"];

    events.forEach((event) => {
      window.addEventListener(event, close, { passive: true });
      eventListenersRef.current.push({ type: event, handler: close });
    });

    return cleanupEventListeners;
  }, [open, cleanupEventListeners]);

  useEffect(() => {
    const handleOpen = (e) => {
      if (e.detail !== btnRef.current) setOpen(false);
    };

    window.addEventListener("row-menu-open", handleOpen);

    return () => {
      window.removeEventListener("row-menu-open", handleOpen);
    };
  }, []);

  useEffect(() => {
    return () => {
      cleanupEventListeners();
    };
  }, [cleanupEventListeners]);

  const toggleMenu = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      window.dispatchEvent(
        new CustomEvent("row-menu-open", { detail: btnRef.current })
      );
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggleMenu}
        className="rounded-full bg-gray-200 p-1 hover:bg-gray-300 transition-colors"
      >
        <span className="text-gray-700">⋮</span>
      </button>

      {showHistory && (
        <CaseHistory
          id={row.id}
          caseNumber={row.caseNumber}
          onClose={() => setShowHistory(false)}
        />
      )}

      {createPortal(
        <AnimatePresence>
          {open && btnRef.current && (
            <Dropdown
              anchor={btnRef.current}
              row={row}
              completed={completed}
              onEdit={onEdit}
              toggleDone={toggleDone}
              toggleHold={toggleHold}
              toggleNewAccount={toggleNewAccount}
              toggleRush={toggleRush}
              togglePriority={togglePriority}
              toggleStage2={toggleStage2}
              close={() => setOpen(false)}
              showHistory={() => setShowHistory(true)}
              onArchive={onArchive}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

function ConfirmationDialog({ isOpen, onConfirm, onCancel, caseNumber }) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[10000]"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10001] w-full max-w-sm mx-4"
          >
            <div className="bg-white rounded-2xl shadow-xl ring-1 ring-black/5 overflow-hidden">
              <div className="p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-red-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </div>

                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-gray-900">
                      Delete Case
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Delete{" "}
                      <span className="font-mono font-medium text-gray-700">
                        {caseNumber}
                      </span>
                      ? This can't be undone.
                    </p>
                  </div>
                </div>
              </div>

              <div className="px-5 py-3 bg-gray-50 flex gap-2 justify-end">
                <button
                  onClick={onCancel}
                  className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={onConfirm}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

function Dropdown({
  anchor,
  row,
  completed,
  onEdit,
  toggleDone,
  toggleHold,
  toggleNewAccount,
  toggleRush,
  togglePriority,
  toggleStage2,
  close,
  showHistory,
  onArchive,
}) {
  const menuRef = useRef(null);
  const [style, setStyle] = useState({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const {
    removeCase,
    updateCaseStage,
    workflowMap,
    unlinkFromWorkflow,
    relinkToWorkflow,
  } = useMut();

  // Local state to track toggle states
  const [localPriority, setLocalPriority] = useState(row.priority);
  const [localRush, setLocalRush] = useState(row.rush);
  const [localHold, setLocalHold] = useState(row.hold);
  const [localNewAccount, setLocalNewAccount] = useState(row.newAccount);
  const [localStage2, setLocalStage2] = useState(row.stage2);

  // Workflow status
  const workflowStatus = workflowMap?.get(row.id);
  const isInWorkflow = !!workflowStatus;
  const isUnlinked = row.modifiers?.includes("workflow-unlinked") ?? false;

  // Digital stage info
  const isDigitalCase =
    row.department === "General" &&
    row.modifiers?.some((m) => m.startsWith("stage-"));
  const currentDigitalStage = getCurrentDigitalStage(row.modifiers);
  const nextDigitalStage = getNextDigitalStage(currentDigitalStage);
  const currentDigitalIndex = DIGITAL_STAGES.indexOf(currentDigitalStage);

  // Metal stage info
  const isMetalCase = row.department === "Metal";
  const currentMetalIndex = localStage2 ? 1 : 0;
  const nextMetalStage = localStage2 ? "stage1" : "stage2";

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    removeCase(row.id);
    setShowDeleteConfirm(false);
    close();
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  const handleArchive = async () => {
    try {
      const { error } = await archiveCases([row.id]);
      if (error) throw error;

      if (onArchive) {
        onArchive(row.id);
      }

      close();
    } catch (err) {
      console.error("Failed to archive case:", err);
    }
  };

  const handleMoveToNextDigitalStage = async () => {
    if (!nextDigitalStage) return;

    try {
      await updateCaseStage(row, nextDigitalStage);
      close();
    } catch (err) {
      console.error("Failed to move case to next stage:", err);
    }
  };

  const handleMoveMetalStage = () => {
    setLocalStage2(!localStage2);
    toggleStage2(row);
  };

  const handleTogglePriority = () => {
    setLocalPriority(!localPriority);
    togglePriority(row);
  };

  const handleToggleRush = () => {
    setLocalRush(!localRush);
    toggleRush(row);
  };

  const handleToggleHold = () => {
    setLocalHold(!localHold);
    toggleHold(row);
  };

  const handleToggleNewAccount = () => {
    setLocalNewAccount(!localNewAccount);
    toggleNewAccount(row);
  };

  const handleUnlink = async () => {
    try {
      await unlinkFromWorkflow(row.id);
      close();
    } catch (err) {
      console.error("Failed to unlink from workflow:", err);
    }
  };

  const handleRelink = async () => {
    try {
      await relinkToWorkflow(row.id);
      close();
    } catch (err) {
      console.error("Failed to relink to workflow:", err);
    }
  };

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const menu = menuRef.current;
    if (!menu) return;

    const h = menu.offsetHeight;
    const margin = 8;
    const fitsBelow = window.innerHeight - r.bottom >= h + margin;
    const top = fitsBelow
      ? r.bottom + margin
      : Math.max(margin, r.top - h - margin);

    setStyle({
      position: "fixed",
      right: window.innerWidth - r.right,
      top,
      zIndex: 9999,
    });

    const onClick = (e) => {
      if (!menu.contains(e.target) && !anchor.contains(e.target)) {
        close();
      }
    };

    window.addEventListener("mousedown", onClick, true);

    return () => window.removeEventListener("mousedown", onClick, true);
  }, [anchor, close]);

  const hasStageSection = isMetalCase || (isDigitalCase && nextDigitalStage);

  return (
    <>
      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.95, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -4 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        style={style}
        className="w-56 rounded-xl bg-white shadow-[0_4px_20px_-2px_rgba(0,0,0,0.1),0_8px_40px_-4px_rgba(0,0,0,0.08)] ring-1 ring-gray-100 overflow-hidden"
      >
        {/* Actions - these close the menu */}
        <div className="p-1.5">
          <MenuItem
            onClick={() => {
              toggleDone(row.id, row.completed);
              close();
            }}
            color="teal"
          >
            {completed ? "Undo" : "Done"}
          </MenuItem>

          <MenuItem
            onClick={() => {
              close();
              showHistory();
            }}
          >
            Info
          </MenuItem>

          {!completed && (
            <MenuItem
              onClick={() => {
                onEdit(row);
                close();
              }}
            >
              Edit
            </MenuItem>
          )}
        </div>

        {/* Toggles - these stay open */}
        {!completed && (
          <div className="p-1.5 border-t border-gray-100">
            <MenuItem
              onClick={handleTogglePriority}
              color="red"
              toggle
              active={localPriority}
            >
              Priority
            </MenuItem>

            <MenuItem
              onClick={handleToggleRush}
              color="orange"
              toggle
              active={localRush}
            >
              Rush
            </MenuItem>

            <MenuItem
              onClick={handleToggleHold}
              color="amber"
              toggle
              active={localHold}
            >
              Hold
            </MenuItem>

            <MenuItem
              onClick={handleToggleNewAccount}
              color="pink"
              toggle
              active={localNewAccount}
            >
              New Account
            </MenuItem>
          </div>
        )}

        {/* Stage Progression */}
        {!completed && hasStageSection && (
          <div className="p-1.5 border-t border-gray-100">
            {isMetalCase && (
              <MenuItem
                onClick={handleMoveMetalStage}
                color="indigo"
                stage={{
                  current: currentMetalIndex,
                  total: METAL_STAGES.length,
                }}
              >
                Move to {getStageDisplayName(nextMetalStage)}
              </MenuItem>
            )}

            {isDigitalCase && nextDigitalStage && (
              <MenuItem
                onClick={() => {
                  handleMoveToNextDigitalStage();
                }}
                color="indigo"
                stage={{
                  current: currentDigitalIndex,
                  total: DIGITAL_STAGES.length,
                }}
              >
                Move to {getStageDisplayName(nextDigitalStage)}
              </MenuItem>
            )}
          </div>
        )}

        {/* Workflow section */}
        {!completed && (isInWorkflow || isUnlinked) && (
          <div className="p-1.5 border-t border-gray-100">
            {isInWorkflow && !isUnlinked && (
              <MenuItem onClick={handleUnlink} color="gray" icon="unlink">
                Unlink Workflow
              </MenuItem>
            )}
            {isUnlinked && (
              <MenuItem onClick={handleRelink} color="indigo" icon="link">
                Relink Workflow
              </MenuItem>
            )}
          </div>
        )}

        {/* Destructive - these close the menu */}
        <div className="p-1.5 border-t border-gray-100">
          {completed && <MenuItem onClick={handleArchive}>Archive</MenuItem>}

          <MenuItem onClick={handleDelete} color="red">
            Delete
          </MenuItem>
        </div>
      </motion.div>

      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        caseNumber={row.caseNumber}
      />
    </>
  );
}

function MenuItem({
  children,
  onClick,
  color = "gray",
  toggle = false,
  active = false,
  stage = null,
  icon = null,
}) {
  const colors = {
    gray: {
      text: "text-gray-700",
      hover: "hover:bg-gray-50",
      fill: "bg-gray-400",
      ring: "border-gray-300",
    },
    teal: {
      text: "text-teal-600",
      hover: "hover:bg-teal-50",
      fill: "bg-teal-500",
      ring: "border-teal-300",
    },
    pink: {
      text: "text-pink-600",
      hover: "hover:bg-pink-50",
      fill: "bg-pink-500",
      ring: "border-pink-300",
    },
    red: {
      text: "text-red-600",
      hover: "hover:bg-red-50",
      fill: "bg-red-500",
      ring: "border-red-300",
    },
    orange: {
      text: "text-orange-600",
      hover: "hover:bg-orange-50",
      fill: "bg-orange-500",
      ring: "border-orange-300",
    },
    amber: {
      text: "text-amber-600",
      hover: "hover:bg-amber-50",
      fill: "bg-amber-500",
      ring: "border-amber-300",
    },
    indigo: {
      text: "text-indigo-600",
      hover: "hover:bg-indigo-50",
      fill: "bg-indigo-500",
      ring: "border-indigo-300",
    },
  };

  const c = colors[color] || colors.gray;

  const iconSvg =
    icon === "unlink" ? (
      <svg
        className="w-4 h-4 flex-shrink-0 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
        />
        {/* Strike-through line */}
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 20L20 4" />
      </svg>
    ) : icon === "link" ? (
      <svg
        className="w-4 h-4 flex-shrink-0 text-indigo-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
        />
      </svg>
    ) : null;

  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors",
        "flex items-center justify-between gap-3",
        c.text,
        c.hover
      )}
    >
      <span className="flex items-center gap-2 truncate">
        {iconSvg}
        {children}
      </span>

      {/* Toggle indicator */}
      {toggle && (
        <motion.span
          className={clsx(
            "w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center transition-colors",
            active ? c.fill : `border-2 ${c.ring}`
          )}
          animate={active ? { scale: [1, 1.2, 1] } : {}}
          transition={{ duration: 0.2 }}
        >
          {active && (
            <motion.svg
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-2.5 h-2.5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </motion.svg>
          )}
        </motion.span>
      )}

      {/* Stage indicator */}
      {stage && (
        <span className="flex items-center gap-1 flex-shrink-0">
          {Array.from({ length: stage.total }).map((_, i) => (
            <span
              key={i}
              className={clsx(
                "w-2 h-2 rounded-full transition-colors",
                i <= stage.current ? c.fill : `border-2 ${c.ring}`
              )}
            />
          ))}
        </span>
      )}
    </button>
  );
}
