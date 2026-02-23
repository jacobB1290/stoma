import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  shown: { opacity: 1, y: 0, scale: 1 },
};

const SHEET_T = {
  type: "spring",
  stiffness: 240,
  damping: 34,
};

// Debounce delay for name lookup (ms)
const LOOKUP_DEBOUNCE = 500;

export default function UserSetupModal() {
  const { needsName, saveName } = useUser();
  const [open, setOpen] = useState(needsName);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  // Settings lookup state
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [foundSettings, setFoundSettings] = useState(null);
  const [settingsApplied, setSettingsApplied] = useState(false);
  const lookupTimeoutRef = useRef(null);

  // Auto-complete state
  const [knownNames, setKnownNames] = useState([]);
  const [autoCompleteSuggestion, setAutoCompleteSuggestion] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    setOpen(needsName);
  }, [needsName]);

  // Allow Settings panel to open this
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener("open-registration", handleOpen);
    return () => window.removeEventListener("open-registration", handleOpen);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (lookupTimeoutRef.current) {
        clearTimeout(lookupTimeoutRef.current);
      }
    };
  }, []);

  // Load known names from database for auto-complete
  useEffect(() => {
    if (!open) return;

    const loadKnownNames = async () => {
      try {
        // Get canonical names from the normalization mapping
        const canonicalNames = getAllCanonicalNames();

        // Also fetch active users to get any names not in the mapping
        const users = await fetchActiveUsers();
        const userNames = new Set(canonicalNames);

        users.forEach((user) => {
          if (user.user_name && user.user_name.trim().length >= 2) {
            // Filter out test entries
            const name = user.user_name.trim();
            if (!/^(test|asdf|qwer|xxx|yyy|zzz|abc|aaa|bbb|\d+)$/i.test(name)) {
              const canonical = getCanonicalName(name);
              userNames.add(canonical);
            }
          }
        });

        // Sort alphabetically
        const sortedNames = Array.from(userNames).sort((a, b) =>
          a.toLowerCase().localeCompare(b.toLowerCase())
        );

        setKnownNames(sortedNames);
        console.log("[UserSetupModal] Loaded known names:", sortedNames.length);
      } catch (err) {
        console.error("[UserSetupModal] Error loading known names:", err);
      }
    };

    loadKnownNames();
  }, [open]);

  // Debounced name lookup
  const lookupSettings = useCallback(async (inputName) => {
    if (!inputName || inputName.trim().length < 2) {
      setFoundSettings(null);
      setSettingsApplied(false);
      return;
    }

    setIsLookingUp(true);

    try {
      const result = await fetchSettingsForName(inputName);

      if (
        result &&
        result.settings &&
        Object.keys(result.settings).length > 0
      ) {
        setFoundSettings(result);
        console.log(
          `[UserSetupModal] Found settings for "${inputName}" from "${result.foundInRecord}"`
        );
      } else {
        setFoundSettings(null);
      }
    } catch (err) {
      console.error("[UserSetupModal] Error looking up settings:", err);
      setFoundSettings(null);
    } finally {
      setIsLookingUp(false);
    }
  }, []);

  // Compute auto-complete suggestion based on current input
  // AND trigger settings lookup for the suggestion
  useEffect(() => {
    if (!name || name.trim().length < 1) {
      setAutoCompleteSuggestion("");
      return;
    }

    const inputLower = name.toLowerCase();

    // Find the first name that starts with the input
    const match = knownNames.find((knownName) =>
      knownName.toLowerCase().startsWith(inputLower)
    );

    if (match && match.toLowerCase() !== inputLower) {
      // Suggestion is the rest of the name after what user typed
      setAutoCompleteSuggestion(match);

      // Immediately fetch settings for the suggested name (debounced)
      if (lookupTimeoutRef.current) {
        clearTimeout(lookupTimeoutRef.current);
      }
      lookupTimeoutRef.current = setTimeout(() => {
        lookupSettings(match);
      }, LOOKUP_DEBOUNCE);
    } else if (match && match.toLowerCase() === inputLower) {
      // User typed the complete name - lookup for that
      setAutoCompleteSuggestion("");
      if (lookupTimeoutRef.current) {
        clearTimeout(lookupTimeoutRef.current);
      }
      lookupTimeoutRef.current = setTimeout(() => {
        lookupSettings(name);
      }, LOOKUP_DEBOUNCE);
    } else {
      // No match found - lookup for what user typed
      setAutoCompleteSuggestion("");
      if (lookupTimeoutRef.current) {
        clearTimeout(lookupTimeoutRef.current);
      }
      lookupTimeoutRef.current = setTimeout(() => {
        lookupSettings(name);
      }, LOOKUP_DEBOUNCE);
    }
  }, [name, knownNames, lookupSettings]);

  // Handle name input change
  const handleNameChange = useCallback((e) => {
    const newName = e.target.value;
    setName(newName);
    setError("");
    setSettingsApplied(false);
    // Note: settings lookup is now triggered by the useEffect above
  }, []);

  // Handle Tab key to accept auto-complete suggestion
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Tab" && autoCompleteSuggestion) {
        e.preventDefault();
        setName(autoCompleteSuggestion);
        // Trigger settings lookup for the completed name
        if (lookupTimeoutRef.current) {
          clearTimeout(lookupTimeoutRef.current);
        }
        lookupSettings(autoCompleteSuggestion);
      } else if (e.key === "Enter") {
        // If there's a suggestion and user presses Enter, complete it first
        if (
          autoCompleteSuggestion &&
          name.toLowerCase() !== autoCompleteSuggestion.toLowerCase()
        ) {
          setName(autoCompleteSuggestion);
          lookupSettings(autoCompleteSuggestion);
        } else {
          handleSave();
        }
      } else if (e.key === "ArrowRight") {
        // Accept suggestion when cursor is at end and user presses right arrow
        const input = inputRef.current;
        if (
          input &&
          autoCompleteSuggestion &&
          input.selectionStart === name.length
        ) {
          e.preventDefault();
          setName(autoCompleteSuggestion);
          lookupSettings(autoCompleteSuggestion);
        }
      }
    },
    [autoCompleteSuggestion, name, lookupSettings]
  );

  // Handle applying found settings
  const handleApplySettings = useCallback(() => {
    if (foundSettings && foundSettings.settings) {
      const applied = applySettings(foundSettings.settings);
      if (applied) {
        setSettingsApplied(true);
        console.log("[UserSetupModal] Settings applied successfully");
      }
    }
  }, [foundSettings]);

  const handleSave = useCallback(() => {
    // If there's an autocomplete suggestion, use that (user is typing a known name)
    // Otherwise use what they typed
    const nameToSave = autoCompleteSuggestion || name.trim();

    if (!nameToSave) {
      setError("Please enter your name");
      return;
    }

    // Auto-apply settings if found and not already applied
    if (foundSettings && !settingsApplied) {
      applySettings(foundSettings.settings);
    }

    // Use canonical name for consistency
    const canonicalName = getCanonicalName(nameToSave);
    saveName(canonicalName);
    setOpen(false);
    setName("");
    setError("");
    setFoundSettings(null);
    setSettingsApplied(false);
    setAutoCompleteSuggestion("");
  }, [name, autoCompleteSuggestion, saveName, foundSettings, settingsApplied]);

  if (!open) return null;

  const settingsCount = foundSettings?.settings
    ? Object.keys(foundSettings.settings).length
    : 0;

  // Calculate the greyed-out suggestion text
  const suggestionSuffix = autoCompleteSuggestion
    ? autoCompleteSuggestion.slice(name.length)
    : "";

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] flex items-center justify-center
                   bg-black/50 backdrop-blur-sm"
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
          className="w-full max-w-xs p-5 bg-white rounded-2xl shadow-xl
                     space-y-4 select-none"
        >
          <h2 className="text-center text-lg font-semibold">
            What's your name?
          </h2>

          <div className="relative">
            {/* Auto-complete suggestion layer */}
            <div className="absolute inset-0 pointer-events-none flex items-center">
              <div className="w-full rounded border border-transparent p-2 pr-8">
                <span className="invisible">{name}</span>
                <span className="text-gray-400">{suggestionSuffix}</span>
              </div>
            </div>

            {/* Actual input */}
            <input
              ref={inputRef}
              value={name}
              onChange={handleNameChange}
              onKeyDown={handleKeyDown}
              placeholder="Enter your name"
              className="w-full rounded border p-2 outline-none pr-8 bg-transparent relative z-10"
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

          {/* Auto-complete hint */}
          {autoCompleteSuggestion && !isLookingUp && (
            <p className="text-xs text-gray-500 -mt-2">
              Press{" "}
              <kbd className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 font-mono text-[10px]">
                Tab
              </kbd>{" "}
              or{" "}
              <kbd className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 font-mono text-[10px]">
                →
              </kbd>{" "}
              to complete
            </p>
          )}

          {/* Settings found indicator */}
          {foundSettings && settingsCount > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg bg-green-50 border border-green-200 p-3"
            >
              <div className="flex items-start gap-2">
                <svg
                  className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5"
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
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-green-800">
                    Settings found!
                  </p>
                  <p className="text-xs text-green-600 mt-0.5">
                    {settingsCount} setting{settingsCount !== 1 ? "s" : ""} from{" "}
                    <span className="font-medium">
                      {foundSettings.foundInRecord}
                    </span>
                  </p>
                  {settingsApplied ? (
                    <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
                      <svg
                        className="w-3 h-3"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Settings will be applied
                    </p>
                  ) : (
                    <button
                      onClick={handleApplySettings}
                      className="text-xs text-green-700 hover:text-green-900 mt-1 underline"
                    >
                      Preview applied
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          <button
            onClick={handleSave}
            className="w-full rounded-lg py-2 bg-[#16525F] hover:bg-[#1F6F7C]
                       text-white shadow transition-colors"
          >
            {foundSettings ? "Save & Apply Settings" : "Save"}
          </button>

          {error && <p className="text-center text-sm text-red-600">{error}</p>}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
