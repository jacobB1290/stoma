import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import { useUser } from "../context/UserContext";
import {
  fetchSettingsForName,
  applySettings,
  fetchActiveUsers,
} from "../services/userService";
import {
  getCanonicalName,
  getAllCanonicalNames,
} from "../utils/nameNormalization";

const SHEET = {
  hidden: { opacity: 0, y: 48, scale: 0.92 },
  shown:  { opacity: 1, y: 0,  scale: 1    },
};
const SHEET_T = { type: "spring", stiffness: 240, damping: 34 };

// ─── Steps ────────────────────────────────────────────────────────────────────
// "select"  → pick / type a name
// "confirm" → new name: ask user to confirm they want to register
// "adding"  → spinner while we write the new name to Supabase
// ─────────────────────────────────────────────────────────────────────────────

export default function UserSetupModal() {
  const { needsName, saveName } = useUser();
  const [open, setOpen]   = useState(needsName);
  const [step, setStep]   = useState("select"); // "select" | "confirm" | "adding"

  // ── Input state ──────────────────────────────────────────────────────────
  const [name,       setName]       = useState("");
  const [error,      setError]      = useState("");
  const inputRef = useRef(null);

  // ── Known-names list (loaded from DB + normalization map) ────────────────
  const [knownNames,    setKnownNames]    = useState([]); // canonical strings
  const [namesLoading,  setNamesLoading]  = useState(true);

  // ── Autocomplete ─────────────────────────────────────────────────────────
  const [suggestion, setSuggestion] = useState(""); // full canonical name

  // ── Settings preview ─────────────────────────────────────────────────────
  const lookupRef          = useRef(null);
  const [isLookingUp,      setIsLookingUp]      = useState(false);
  const [foundSettings,    setFoundSettings]    = useState(null);
  const [settingsApplied,  setSettingsApplied]  = useState(false);

  // ── Open / close ──────────────────────────────────────────────────────────
  useEffect(() => { setOpen(needsName); }, [needsName]);

  useEffect(() => {
    const handleOpen = () => { setOpen(true); resetState(); };
    window.addEventListener("open-registration", handleOpen);
    return () => window.removeEventListener("open-registration", handleOpen);
  }, []);

  // ── Load known names ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setNamesLoading(true);
      try {
        const canonical = getAllCanonicalNames();
        const users     = await fetchActiveUsers();
        const set       = new Set(canonical);

        users.forEach((u) => {
          const n = (u.user_name || "").trim();
          if (n.length >= 2 && !/^(test|asdf|qwer|xxx|yyy|zzz|abc|aaa|bbb|\d+)$/i.test(n)) {
            set.add(getCanonicalName(n));
          }
        });

        if (!cancelled) {
          setKnownNames(
            [...set].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
          );
        }
      } catch {
        // silently continue — user can still type
      } finally {
        if (!cancelled) setNamesLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  // ── Cleanup lookup timeout on unmount ─────────────────────────────────────
  useEffect(() => () => clearTimeout(lookupRef.current), []);

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  function resetState() {
    setStep("select");
    setName("");
    setError("");
    setSuggestion("");
    setFoundSettings(null);
    setSettingsApplied(false);
  }

  /** Check whether the typed value matches a known name (case-insensitive). */
  function matchesKnownName(value) {
    const v = value.trim().toLowerCase();
    return knownNames.some((n) => n.toLowerCase() === v);
  }

  /** Return the canonical form of a known name, or null. */
  function resolveKnown(value) {
    const v = value.trim().toLowerCase();
    return knownNames.find((n) => n.toLowerCase() === v) || null;
  }

  // ── Autocomplete + settings lookup as user types ──────────────────────────
  useEffect(() => {
    if (!name.trim()) {
      setSuggestion("");
      setFoundSettings(null);
      return;
    }

    const inputLower = name.toLowerCase();
    const match = knownNames.find((n) => n.toLowerCase().startsWith(inputLower));

    if (match && match.toLowerCase() !== inputLower) {
      setSuggestion(match); // partial match → show ghost text
    } else {
      setSuggestion("");
    }

    // Debounced settings lookup for the best candidate
    const target = (match && match.toLowerCase() === inputLower) ? match : name;
    clearTimeout(lookupRef.current);
    setIsLookingUp(true);
    lookupRef.current = setTimeout(async () => {
      try {
        const result = await fetchSettingsForName(target);
        if (result?.settings && Object.keys(result.settings).length > 0) {
          setFoundSettings(result);
        } else {
          setFoundSettings(null);
        }
      } catch {
        setFoundSettings(null);
      } finally {
        setIsLookingUp(false);
      }
    }, 450);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, knownNames]);

  // ─────────────────────────────────────────────────────────────────────────
  // Keyboard
  // ─────────────────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e) => {
    if ((e.key === "Tab" || e.key === "ArrowRight") && suggestion) {
      e.preventDefault();
      setName(suggestion);
      setSuggestion("");
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (suggestion && name.toLowerCase() !== suggestion.toLowerCase()) {
        setName(suggestion);
        setSuggestion("");
      } else {
        handleProceed();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion, name]);

  // ─────────────────────────────────────────────────────────────────────────
  // "Continue" — validate before proceeding
  // ─────────────────────────────────────────────────────────────────────────

  function handleProceed() {
    const raw       = (suggestion && name.toLowerCase() !== suggestion.toLowerCase())
                        ? suggestion
                        : name.trim();

    if (!raw) {
      setError("Please enter your name.");
      return;
    }

    if (namesLoading) {
      setError("Still loading the staff list, please wait a moment…");
      return;
    }

    if (matchesKnownName(raw)) {
      // ── Known name → log straight in ──────────────────────────────────
      commitLogin(raw);
    } else {
      // ── Unknown name → ask them to confirm adding themselves ───────────
      setName(raw);       // normalise to what we'll store
      setSuggestion("");
      setError("");
      setStep("confirm");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Commit login (final step for known names and confirmed new names)
  // ─────────────────────────────────────────────────────────────────────────

  function commitLogin(rawName) {
    if (foundSettings && !settingsApplied) {
      applySettings(foundSettings.settings);
    }
    const canonical = getCanonicalName(rawName);
    saveName(canonical);
    setOpen(false);
    resetState();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // "Yes, add me" — confirm new-name registration
  // ─────────────────────────────────────────────────────────────────────────

  async function handleConfirmNew() {
    setStep("adding");
    setError("");

    const canonical = getCanonicalName(name);

    // The heartbeat / reportActive flow will write the name to active_devices
    // when saveName() is called, so we just proceed immediately.
    // knownNames is a local cache — the name will be in the DB after first heartbeat.
    commitLogin(canonical);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  if (!open) return null;

  const settingsCount = foundSettings?.settings
    ? Object.keys(foundSettings.settings).length
    : 0;

  const suggestionSuffix = suggestion ? suggestion.slice(name.length) : "";

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          variants={SHEET}
          initial="hidden"
          animate="shown"
          exit="hidden"
          transition={SHEET_T}
          className="w-full max-w-xs p-5 bg-white rounded-2xl shadow-xl space-y-4 select-none"
        >

          {/* ── Step: select ────────────────────────────────────────────── */}
          {step === "select" && (
            <>
              <div className="text-center space-y-1">
                <h2 className="text-lg font-semibold">Who are you?</h2>
                <p className="text-xs text-gray-500">
                  Enter your name to access the board
                </p>
              </div>

              {/* Input + ghost autocomplete */}
              <div className="relative">
                <div className="absolute inset-0 pointer-events-none flex items-center">
                  <div className="w-full rounded border border-transparent p-2 pr-8">
                    <span className="invisible">{name}</span>
                    <span className="text-gray-400">{suggestionSuffix}</span>
                  </div>
                </div>
                <input
                  ref={inputRef}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError("");
                    setSettingsApplied(false);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter your name"
                  className="w-full rounded border p-2 outline-none pr-8 bg-transparent relative z-10
                             focus:ring-2 focus:ring-[#16525F]/40 focus:border-[#16525F]"
                  autoFocus
                  autoComplete="off"
                  spellCheck="false"
                />
                {isLookingUp && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20">
                    <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                )}
              </div>

              {/* Autocomplete hint */}
              {suggestion && !isLookingUp && (
                <p className="text-xs text-gray-500 -mt-2">
                  Press{" "}
                  <kbd className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 font-mono text-[10px]">Tab</kbd>
                  {" "}or{" "}
                  <kbd className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 font-mono text-[10px]">→</kbd>
                  {" "}to complete
                </p>
              )}

              {/* Settings preview badge */}
              {foundSettings && settingsCount > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg bg-green-50 border border-green-200 p-3"
                >
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-green-800">Settings found!</p>
                      <p className="text-xs text-green-600 mt-0.5">
                        {settingsCount} setting{settingsCount !== 1 ? "s" : ""} from{" "}
                        <span className="font-medium">{foundSettings.foundInRecord}</span>
                      </p>
                      {settingsApplied ? (
                        <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          Settings will be applied
                        </p>
                      ) : (
                        <button
                          onClick={() => {
                            applySettings(foundSettings.settings);
                            setSettingsApplied(true);
                          }}
                          className="text-xs text-green-700 hover:text-green-900 mt-1 underline"
                        >
                          Preview settings
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              <button
                onClick={handleProceed}
                disabled={namesLoading && !name.trim()}
                className="w-full rounded-lg py-2 bg-[#16525F] hover:bg-[#1F6F7C] disabled:opacity-50
                           text-white shadow transition-colors font-medium"
              >
                {namesLoading ? "Loading…" : "Continue"}
              </button>

              {error && (
                <p className="text-center text-sm text-red-600">{error}</p>
              )}
            </>
          )}

          {/* ── Step: confirm new name ───────────────────────────────────── */}
          {step === "confirm" && (
            <>
              <div className="text-center space-y-1">
                <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-2">
                  <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold">New name detected</h2>
                <p className="text-sm text-gray-600">
                  <span className="font-semibold text-gray-900">"{getCanonicalName(name)}"</span>
                  {" "}is not on the staff list yet.
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Is this you? Confirming will add your name to the system.
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setStep("select"); setError(""); }}
                  className="flex-1 rounded-lg py-2 border border-gray-300 hover:bg-gray-50
                             text-gray-700 text-sm font-medium transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={handleConfirmNew}
                  className="flex-1 rounded-lg py-2 bg-[#16525F] hover:bg-[#1F6F7C]
                             text-white text-sm font-medium shadow transition-colors"
                >
                  Yes, that's me
                </button>
              </div>
            </>
          )}

          {/* ── Step: adding (brief spinner) ────────────────────────────── */}
          {step === "adding" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-8 h-8 border-3 border-gray-200 border-t-[#16525F] rounded-full animate-spin" />
              <p className="text-sm text-gray-600">Setting you up…</p>
            </div>
          )}

        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
