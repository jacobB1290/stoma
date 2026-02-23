// /src/components/SystemInsightsPanel.jsx
// ============================================================================
// ENHANCED SYSTEM INSIGHTS PANEL - Dynamic UI Generation with GPT-5.2-Codex
// Supports live-coded components and full action confirmations
// ============================================================================

import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  askLLM,
  resetLLMChat,
  CaseService,
  setStatusCallback,
  STATUS_TYPES,
  EVENT_TYPES,
  setEventLogCallback,
  getEventLog,
} from "../qa/LLMChatService";
import { useMut } from "../context/DataContext";
import { db } from "../services/caseService";

const pct = (x) => Math.max(0, Math.min(100, Number(x) || 0));

// ============================================================================
// SIMPLE MARKDOWN TEXT RENDERER - Handles **bold**, *italic*, `code`
// ============================================================================

const MarkdownText = ({ text, className = "" }) => {
  if (!text) return null;

  // Parse markdown-style formatting
  const parseMarkdown = (input) => {
    const parts = [];
    let remaining = input;
    let key = 0;

    // Regex patterns for markdown
    const patterns = [
      {
        regex: /\*\*(.+?)\*\*/g,
        render: (match) => (
          <strong key={key++} className="font-semibold">
            {match}
          </strong>
        ),
      },
      {
        regex: /\*(.+?)\*/g,
        render: (match) => (
          <em key={key++} className="italic">
            {match}
          </em>
        ),
      },
      {
        regex: /`([^`]+)`/g,
        render: (match) => (
          <code
            key={key++}
            className="px-1 py-0.5 bg-gray-200 rounded text-xs font-mono"
          >
            {match}
          </code>
        ),
      },
    ];

    // Simple approach: process text sequentially
    let lastIndex = 0;
    const combinedRegex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
    let match;

    while ((match = combinedRegex.exec(remaining)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        parts.push(remaining.slice(lastIndex, match.index));
      }

      const fullMatch = match[0];

      if (fullMatch.startsWith("**") && fullMatch.endsWith("**")) {
        // Bold
        const content = fullMatch.slice(2, -2);
        parts.push(
          <strong key={key++} className="font-semibold">
            {content}
          </strong>
        );
      } else if (fullMatch.startsWith("*") && fullMatch.endsWith("*")) {
        // Italic
        const content = fullMatch.slice(1, -1);
        parts.push(
          <em key={key++} className="italic">
            {content}
          </em>
        );
      } else if (fullMatch.startsWith("`") && fullMatch.endsWith("`")) {
        // Code
        const content = fullMatch.slice(1, -1);
        parts.push(
          <code
            key={key++}
            className="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono"
          >
            {content}
          </code>
        );
      }

      lastIndex = match.index + fullMatch.length;
    }

    // Add remaining text
    if (lastIndex < remaining.length) {
      parts.push(remaining.slice(lastIndex));
    }

    return parts.length > 0 ? parts : [remaining];
  };

  // Split by newlines first, then parse each line
  const lines = text.split("\n");

  return (
    <span className={className} style={{ whiteSpace: "pre-wrap" }}>
      {lines.map((line, lineIndex) => (
        <React.Fragment key={lineIndex}>
          {lineIndex > 0 && "\n"}
          {parseMarkdown(line)}
        </React.Fragment>
      ))}
    </span>
  );
};

// ============================================================================
// DYNAMIC COMPONENT RENDERER - Executes live-coded React components
// ============================================================================

const DynamicComponent = ({ componentCode, data, onAction, description }) => {
  const [renderedContent, setRenderedContent] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      // Create the component function from code string
      // eslint-disable-next-line no-new-func
      const componentFn = new Function(
        "React",
        "data",
        "onAction",
        "theme",
        `
        try {
          const Component = ${componentCode};
          return Component({ data, onAction, theme });
        } catch (e) {
          return React.createElement('div', { className: 'text-red-500 p-2' }, 'Component Error: ' + e.message);
        }
        `
      );

      const theme = {
        primary: "blue",
        danger: "red",
        success: "green",
        warning: "amber",
        colors: {
          blue: {
            bg: "bg-blue-500",
            text: "text-blue-700",
            light: "bg-blue-100",
          },
          red: { bg: "bg-red-500", text: "text-red-700", light: "bg-red-100" },
          green: {
            bg: "bg-green-500",
            text: "text-green-700",
            light: "bg-green-100",
          },
          amber: {
            bg: "bg-amber-500",
            text: "text-amber-700",
            light: "bg-amber-100",
          },
        },
      };

      const result = componentFn(React, data, onAction, theme);
      setRenderedContent(result);
      setError(null);
    } catch (e) {
      console.error("[DynamicComponent] Error:", e);
      setError(e.message);
    }
  }, [componentCode, data, onAction]);

  if (error) {
    return (
      <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
        <p className="font-medium text-red-700">Component Error</p>
        <p className="text-red-600 text-xs mt-1">{error}</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="dynamic-component"
    >
      {description && (
        <p className="text-xs text-gray-500 mb-2">{description}</p>
      )}
      {renderedContent}
    </motion.div>
  );
};

// ============================================================================
// ERROR & MESSAGE FORMATTING UTILITIES
// ============================================================================

const formatErrorMessage = (error) => {
  if (typeof error === "string") {
    if (error.includes("<html") || error.includes("<!DOCTYPE")) {
      const statusMatch = error.match(/(\d{3})\s*([-\w\s]+)?<\/title>/i);
      const statusCode = statusMatch ? statusMatch[1] : null;
      const errorMessages = {
        400: "Bad Request - The request was malformed",
        401: "Authentication required - Please check your credentials",
        403: "Access denied - You don't have permission for this action",
        404: "Resource not found",
        429: "Too many requests - Please wait a moment and try again",
        500: "Server error - Something went wrong on our end",
        502: "Bad gateway - The server is temporarily unavailable",
        503: "Service unavailable - Please try again later",
      };
      return {
        type: "api_error",
        code: statusCode,
        message: statusCode
          ? errorMessages[statusCode] || `Server error (${statusCode})`
          : "An unexpected error occurred",
        suggestion: getSuggestionForError(statusCode),
      };
    }
    if (error.toLowerCase().includes("network")) {
      return {
        type: "network_error",
        message: "Network connection issue",
        suggestion: "Please check your internet connection and try again.",
      };
    }
    return {
      type: "generic_error",
      message: error.length > 100 ? error.substring(0, 100) + "..." : error,
      suggestion: "Please try again or rephrase your question.",
    };
  }
  if (error instanceof Error) {
    return {
      type: "exception",
      message: error.message || "An unexpected error occurred",
      suggestion: "Please try again or switch to heuristic mode.",
    };
  }
  return {
    type: "unknown_error",
    message: "Something went wrong",
    suggestion: "Please try again.",
  };
};

const getSuggestionForError = (statusCode) => {
  const suggestions = {
    401: "Try refreshing the page or logging in again.",
    403: "Contact your administrator if you believe you should have access.",
    429: "You've made too many requests. Wait a few seconds before trying again.",
    500: "Our servers are having issues. Please try again in a moment.",
  };
  return (
    suggestions[statusCode] || "You can try again or switch to heuristic mode."
  );
};

// ============================================================================
// ACTION CONFIRMATION CARD - Universal confirmation UI
// ============================================================================

const ActionConfirmationCard = ({
  action,
  onConfirm,
  onCancel,
  isExecuting,
}) => {
  const getActionTitle = () => {
    switch (action.actionType) {
      case "edit_case":
        return `Edit Case ${
          action.target?.case_number || action.target?.case_numbers?.[0] || ""
        }`;
      case "edit":
        return `Edit Case ${action.case_number || ""}`;
      case "move_stage":
      case "stage_move":
        return `Move Case ${
          action.target?.case_number || action.case_number || ""
        }`;
      case "bulk_update":
      case "bulk":
        return `Bulk Action: ${
          action.action?.replace(/_/g, " ") || action.changes
            ? "Update"
            : "Action"
        }`;
      case "toggle_flag":
        return `Toggle Flag: ${Object.keys(action.changes || {}).join(", ")}`;
      default:
        return "Confirm Action";
    }
  };

  const renderChanges = () => {
    const changes = action.changes || {};

    // Handle changes
    if (Object.keys(changes).length > 0) {
      return (
        <div className="space-y-2 mt-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Proposed Changes
          </p>
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {Object.entries(changes).map(
              ([key, value]) =>
                value !== undefined && (
                  <div
                    key={key}
                    className="flex justify-between items-center px-3 py-2"
                  >
                    <span className="text-sm text-gray-600 capitalize">
                      {key.replace(/_/g, " ")}
                    </span>
                    <span className="text-sm font-medium text-gray-900">
                      {typeof value === "boolean"
                        ? value
                          ? "Yes"
                          : "No"
                        : String(value)}
                    </span>
                  </div>
                )
            )}
          </div>
        </div>
      );
    }

    // Handle stage move
    if (action.target_stage || action.changes?.stage) {
      return (
        <div className="mt-3 px-3 py-2 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex items-center gap-2">
            <span className="text-sm text-blue-700">Move to:</span>
            <span className="text-sm font-semibold text-blue-800 capitalize">
              {action.target_stage || action.changes?.stage}
            </span>
          </div>
        </div>
      );
    }

    // Handle bulk targets
    const caseNumbers =
      action.target?.case_numbers || action.case_numbers || [];
    if (caseNumbers.length > 0) {
      return (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Affected Cases ({caseNumbers.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {caseNumbers.slice(0, 10).map((cn) => (
              <span
                key={cn}
                className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded font-mono"
              >
                {cn}
              </span>
            ))}
            {caseNumbers.length > 10 && (
              <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded">
                +{caseNumbers.length - 10} more
              </span>
            )}
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border-2 border-amber-300 shadow-lg overflow-hidden"
    >
      <div className="bg-amber-100/50 px-4 py-3 border-b border-amber-200">
        <div className="flex items-center gap-2">
          <span className="text-lg">Confirm</span>
          <h4 className="font-semibold text-amber-900">{getActionTitle()}</h4>
          <span className="ml-auto px-2 py-0.5 bg-amber-200 text-amber-800 text-xs rounded-full font-medium">
            Confirmation Required
          </span>
        </div>
      </div>

      <div className="px-4 py-3">
        {action.reason && (
          <p className="text-sm text-gray-700 leading-relaxed">
            {action.reason}
          </p>
        )}

        {renderChanges()}

        <div className="flex gap-2 mt-4">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onConfirm}
            disabled={isExecuting}
            className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isExecuting ? (
              <>
                <svg
                  className="w-4 h-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
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
                <span>Applying...</span>
              </>
            ) : (
              <>
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
                <span>Confirm & Apply</span>
              </>
            )}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onCancel}
            disabled={isExecuting}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

// ============================================================================
// UI ELEMENT PARSER - Parse LLM response for embedded UI elements
// ============================================================================

const parseUIElements = (content) => {
  const elements = [];
  let cleanContent = content || "";

  // Parse the HTML comment-style markers: <!--UI_ELEMENT:{...}:END_UI_ELEMENT-->
  const uiElementRegex = /<!--UI_ELEMENT:([\s\S]*?):END_UI_ELEMENT-->/g;
  let match;

  while ((match = uiElementRegex.exec(content)) !== null) {
    try {
      const jsonStr = match[1].trim();
      const elementData = JSON.parse(jsonStr);

      if (elementData._uiType === "ACTION_PROPOSAL") {
        elements.push({ type: "action", data: elementData });
      } else if (elementData._uiType === "VISUALIZATION") {
        elements.push({ type: "visualization", data: elementData });
      } else if (elementData._uiType === "DYNAMIC_COMPONENT") {
        elements.push({ type: "dynamic", data: elementData });
      }

      cleanContent = cleanContent.replace(match[0], "");
    } catch (e) {
      console.error(
        "[SystemInsightsPanel] Failed to parse UI element:",
        e,
        match[1]?.substring(0, 100)
      );
    }
  }

  // Also handle old [COMPONENTS:...] markers
  cleanContent = cleanContent.replace(/\[COMPONENTS:[^\]]+\]/g, "").trim();

  return { elements, cleanContent };
};

// ============================================================================
// MESSAGE COMPONENT - Enhanced with dynamic UI rendering
// ============================================================================

const Message = ({
  role,
  content,
  timestamp,
  isLatest,
  onTypingComplete,
  onActionClick,
  onModalOpen,
  onActionConfirm,
  onActionCancel,
  onDynamicAction,
  showDebug = true,
  isError = false,
  onRetry,
  onSwitchMode,
  isExecutingAction,
}) => {
  const isUser = role === "user";
  const [parsedContent, setParsedContent] = useState({
    text: content,
    actions: [],
    components: [],
    uiElements: [],
    errorInfo: null,
  });

  useEffect(() => {
    if (!isUser && content) {
      // Check for errors
      const isErrorContent =
        isError ||
        content.includes("**Error") ||
        content.includes("API request failed") ||
        content.includes("<html");

      if (isErrorContent && !content.includes("<!--UI_ELEMENT:")) {
        const errorInfo = formatErrorMessage(content);
        setParsedContent({
          text: "",
          actions: [],
          components: ["error_handler"],
          uiElements: [],
          errorInfo,
        });
        return;
      }

      // Parse UI elements
      const { elements: uiElements, cleanContent } = parseUIElements(content);

      // Parse existing markers like [ACTION:Label|Command]
      const actionRegex = /\[ACTION:([^\|]+)\|([^\]]+)\]/g;
      const modalRegex = /\[MODAL:([^\|]+)\|([^\|]+)\|([^\]]+)\]/g;
      const componentsRegex = /\[COMPONENTS:([^\]]+)\]/g;

      let cleanText = cleanContent;
      const actions = [];
      const components = [];
      let regexMatch;

      while ((regexMatch = componentsRegex.exec(cleanContent)) !== null) {
        components.push(...regexMatch[1].split(",").map((c) => c.trim()));
        cleanText = cleanText.replace(regexMatch[0], "");
      }

      while ((regexMatch = modalRegex.exec(cleanContent)) !== null) {
        actions.push({
          label: `View history`,
          command: regexMatch[0],
          isModal: true,
          modalType: regexMatch[1],
          caseId: regexMatch[2],
          caseNumber: regexMatch[3],
        });
        cleanText = cleanText.replace(regexMatch[0], "");
      }

      actionRegex.lastIndex = 0;
      while ((regexMatch = actionRegex.exec(cleanContent)) !== null) {
        if (!regexMatch[0].includes("[MODAL:")) {
          actions.push({
            label: regexMatch[1],
            command: regexMatch[2],
            isModal: false,
          });
          cleanText = cleanText.replace(regexMatch[0], "");
        }
      }

      // Clean up whitespace
      cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();

      setParsedContent({
        text: cleanText,
        actions,
        components,
        uiElements,
        errorInfo: null,
      });
    }
  }, [content, isUser, isError]);

  // Auto-complete typing
  useEffect(() => {
    if (!isUser && isLatest && onTypingComplete) {
      const timer = setTimeout(onTypingComplete, 50);
      return () => clearTimeout(timer);
    }
  }, [isUser, isLatest, onTypingComplete]);

  const handleActionClick = (action) => {
    if (action.isModal && onModalOpen) {
      onModalOpen(action.modalType, action.caseId, action.caseNumber);
    } else if (onActionClick) {
      onActionClick(action.command);
    }
  };

  // Render error message
  if (parsedContent.errorInfo) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-start mb-3"
      >
        <div className="max-w-[85%]">
          <div className="p-4 rounded-lg bg-red-50 border border-red-200">
            <div className="flex items-start gap-3">
              <span className="text-red-500 text-lg">Warning</span>
              <div className="flex-1">
                <p className="font-medium text-red-800">
                  {parsedContent.errorInfo.message}
                </p>
                <p className="text-sm text-red-700 mt-2">
                  {parsedContent.errorInfo.suggestion}
                </p>
                <div className="flex gap-2 mt-3">
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      className="px-3 py-1.5 text-xs font-medium bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                    >
                      Try Again
                    </button>
                  )}
                  {onSwitchMode && (
                    <button
                      onClick={onSwitchMode}
                      className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Switch to Heuristic Mode
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1 px-1">
            {new Date(timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}
    >
      <div className={`max-w-[95%] ${isUser ? "order-2" : ""}`}>
        <div
          className={`px-4 py-2 rounded-lg text-sm ${
            isUser
              ? "bg-gray-900 text-white rounded-br-none"
              : "bg-gray-100 text-gray-800 rounded-bl-none"
          }`}
        >
          <div>
            <MarkdownText text={parsedContent.text} />

            {/* Render action buttons */}
            {!isUser && parsedContent.actions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {parsedContent.actions.map((action, index) => (
                  <button
                    key={index}
                    onClick={() => handleActionClick(action)}
                    className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-all"
                  >
                    {action.label}
                    <svg
                      className="ml-1 w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Render UI elements (dynamic components, action confirmations) */}
        {!isUser && parsedContent.uiElements.length > 0 && (
          <div className="mt-3 space-y-3">
            {parsedContent.uiElements.map((el, idx) => {
              if (el.type === "action") {
                return (
                  <ActionConfirmationCard
                    key={idx}
                    action={el.data}
                    onConfirm={() => onActionConfirm?.(el.data)}
                    onCancel={() => onActionCancel?.(el.data)}
                    isExecuting={isExecutingAction}
                  />
                );
              }
              if (el.type === "dynamic") {
                return (
                  <DynamicComponent
                    key={idx}
                    componentCode={el.data.componentCode}
                    data={el.data.data}
                    description={el.data.description}
                    onAction={(actionType, payload) =>
                      onDynamicAction?.(actionType, payload, el.data)
                    }
                  />
                );
              }
              return null;
            })}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-1 px-1">
          <p className={`text-xs text-gray-400 ${isUser ? "text-right" : ""}`}>
            {new Date(timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          {!isUser && showDebug && parsedContent.components.length > 0 && (
            <div className="flex items-center gap-1 ml-2">
              <span className="text-xs text-gray-400 mr-1">via</span>
              {parsedContent.components.map((comp, idx) => (
                <span
                  key={idx}
                  className="text-xs px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full"
                >
                  {comp
                    .split("_")
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(" ")}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// ============================================================================
// TABS AND INSIGHTS COMPONENTS
// ============================================================================

const Tab = ({ active, onClick, children, count }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
      active
        ? "bg-gray-900 text-white"
        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
    }`}
  >
    {children}
    {count !== undefined && (
      <span
        className={`ml-2 px-1.5 py-0.5 text-xs rounded-full ${
          active ? "bg-white/20" : "bg-gray-200"
        }`}
      >
        {count}
      </span>
    )}
  </button>
);

const InsightCard = ({ priority, title, description, action, metric }) => {
  const priorityColors = {
    high: "border-l-red-500 bg-red-50/50",
    medium: "border-l-amber-500 bg-amber-50/50",
    low: "border-l-blue-500 bg-blue-50/50",
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`p-4 rounded-lg border border-gray-200 border-l-4 ${priorityColors[priority]}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
          <p className="text-xs text-gray-600 mt-1">{description}</p>
          {action && (
            <p className="text-xs font-medium text-blue-600 mt-2">{action}</p>
          )}
        </div>
        {metric && (
          <div className="text-right ml-4">
            <p className="text-2xl font-bold text-gray-900">{metric.value}</p>
            <p className="text-xs text-gray-500">{metric.label}</p>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const CaseIssueRow = ({ caseNumber, issues, impact }) => (
  <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
    <div className="flex items-center gap-3">
      <span className="font-mono text-sm font-medium text-gray-900">
        {caseNumber}
      </span>
      <div className="flex gap-1">
        {issues.map((issue, i) => (
          <span
            key={i}
            className={`px-2 py-0.5 text-xs rounded-full font-medium ${
              issue === "late"
                ? "bg-red-100 text-red-700"
                : issue === "slow"
                ? "bg-amber-100 text-amber-700"
                : "bg-blue-100 text-blue-700"
            }`}
          >
            {issue}
          </span>
        ))}
      </div>
    </div>
    <span
      className={`text-sm font-medium ${
        impact < 0 ? "text-red-600" : "text-gray-500"
      }`}
    >
      {impact < 0 ? impact.toFixed(1) : "--"}pts
    </span>
  </div>
);

const AIModeToggle = ({ isLLMMode, onToggle, disabled }) => (
  <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg">
    <span
      className={`text-xs font-medium transition-colors ${
        !isLLMMode ? "text-gray-900" : "text-gray-400"
      }`}
    >
      Heuristic
    </span>
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      } ${isLLMMode ? "bg-blue-600" : "bg-gray-300"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
          isLLMMode ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
    <span
      className={`text-xs font-medium transition-colors ${
        isLLMMode ? "text-gray-900" : "text-gray-400"
      }`}
    >
      LLM
    </span>
    {isLLMMode && (
      <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold bg-purple-100 text-purple-700 rounded">
        Codex
      </span>
    )}
  </div>
);

// ============================================================================
// THOUGHT CHAIN MODAL - Shows detailed working process
// ============================================================================

const ThoughtChainModal = ({ isOpen, onClose, events }) => {
  const scrollRef = useRef(null);
  const [expandedEvents, setExpandedEvents] = useState(new Set());

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  // Keyboard support for Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getEventIcon = (type) => {
    switch (type) {
      case EVENT_TYPES.SESSION_START:
        return "🚀";
      case EVENT_TYPES.STATUS_CHANGE:
        return "📍";
      case EVENT_TYPES.THINKING:
        return "💭";
      case EVENT_TYPES.TOOL_CALL:
        return "🔧";
      case EVENT_TYPES.TOOL_RESULT:
        return "📦";
      case EVENT_TYPES.API_REQUEST:
        return "📤";
      case EVENT_TYPES.API_RESPONSE:
        return "📥";
      case EVENT_TYPES.MODEL_TEXT:
        return "💬";
      case EVENT_TYPES.TIME_WARNING:
        return "⏰";
      case EVENT_TYPES.ERROR:
        return "❌";
      case EVENT_TYPES.RETRY:
        return "🔄";
      case EVENT_TYPES.SESSION_END:
        return "✅";
      default:
        return "•";
    }
  };

  const getEventColor = (type) => {
    switch (type) {
      case EVENT_TYPES.SESSION_START:
        return "text-blue-700 bg-blue-50 border-blue-200";
      case EVENT_TYPES.STATUS_CHANGE:
        return "text-gray-700 bg-gray-50 border-gray-200";
      case EVENT_TYPES.THINKING:
        return "text-pink-700 bg-pink-50 border-pink-200";
      case EVENT_TYPES.TOOL_CALL:
        return "text-amber-700 bg-amber-50 border-amber-200";
      case EVENT_TYPES.TOOL_RESULT:
        return "text-green-700 bg-green-50 border-green-200";
      case EVENT_TYPES.API_REQUEST:
        return "text-purple-700 bg-purple-50 border-purple-200";
      case EVENT_TYPES.API_RESPONSE:
        return "text-indigo-700 bg-indigo-50 border-indigo-200";
      case EVENT_TYPES.MODEL_TEXT:
        return "text-cyan-700 bg-cyan-50 border-cyan-200";
      case EVENT_TYPES.TIME_WARNING:
        return "text-orange-700 bg-orange-50 border-orange-200";
      case EVENT_TYPES.ERROR:
        return "text-red-700 bg-red-50 border-red-200";
      case EVENT_TYPES.RETRY:
        return "text-yellow-700 bg-yellow-50 border-yellow-200";
      case EVENT_TYPES.SESSION_END:
        return "text-emerald-700 bg-emerald-50 border-emerald-200";
      default:
        return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  const getEventTitle = (event) => {
    switch (event.type) {
      case EVENT_TYPES.SESSION_START:
        return "Starting Session";
      case EVENT_TYPES.STATUS_CHANGE:
        return event.detail || event.status || "Status Update";
      case EVENT_TYPES.THINKING:
        return "AI Thinking...";
      case EVENT_TYPES.TOOL_CALL:
        return `Calling ${event.tool}`;
      case EVENT_TYPES.TOOL_RESULT:
        return `${event.tool} ${event.success ? "completed" : "failed"}`;
      case EVENT_TYPES.API_REQUEST:
        return `Sending to AI (step ${event.iteration})`;
      case EVENT_TYPES.API_RESPONSE:
        return `AI responded (step ${event.iteration})`;
      case EVENT_TYPES.MODEL_TEXT:
        return "AI Generated Response";
      case EVENT_TYPES.TIME_WARNING:
        return `Time Warning: ${event.pressure}`;
      case EVENT_TYPES.ERROR:
        return `Error: ${event.message?.substring(0, 30)}${
          event.message?.length > 30 ? "..." : ""
        }`;
      case EVENT_TYPES.RETRY:
        return `Retry attempt ${event.attempt}`;
      case EVENT_TYPES.SESSION_END:
        return event.success ? "Completed Successfully" : "Session Ended";
      default:
        return event.type?.replace(/_/g, " ") || "Event";
    }
  };

  const formatEventDetails = (event) => {
    const details = [];

    switch (event.type) {
      case EVENT_TYPES.SESSION_START:
        details.push({ label: "Question", value: event.question || "N/A" });
        details.push({
          label: "Timeout",
          value: `${event.sessionTimeout / 1000}s`,
        });
        details.push({ label: "Max Retries", value: event.maxRetries || 3 });
        break;
      case EVENT_TYPES.STATUS_CHANGE:
        if (event.status)
          details.push({ label: "Status", value: event.status });
        if (event.detail)
          details.push({ label: "Detail", value: event.detail });
        if (event.casesCount)
          details.push({ label: "Cases Loaded", value: event.casesCount });
        break;
      case EVENT_TYPES.THINKING:
        // This is the AI's reasoning/thought process - show it prominently
        details.push({
          label: "Thought",
          value: event.thought,
          thinking: true,
        });
        if (event.iteration)
          details.push({ label: "Step", value: event.iteration });
        if (event.source)
          details.push({ label: "Source", value: event.source });
        break;
      case EVENT_TYPES.TOOL_CALL:
        details.push({ label: "Tool", value: event.tool, highlight: true });
        if (event.args && Object.keys(event.args).length > 0) {
          details.push({
            label: "Arguments",
            value: JSON.stringify(event.args, null, 2),
            code: true,
          });
        }
        details.push({ label: "Iteration", value: event.iteration });
        break;
      case EVENT_TYPES.TOOL_RESULT:
        details.push({ label: "Tool", value: event.tool, highlight: true });
        details.push({
          label: "Success",
          value: event.success ? "✓ Yes" : "✗ No",
        });
        details.push({
          label: "Result Type",
          value: event.resultType || "data",
        });
        if (event.resultPreview)
          details.push({ label: "Preview", value: event.resultPreview });
        break;
      case EVENT_TYPES.API_REQUEST:
        details.push({ label: "Iteration", value: event.iteration });
        details.push({
          label: "Tool Results Count",
          value: event.toolResultsCount,
        });
        if (event.messageCount)
          details.push({ label: "Messages", value: event.messageCount });
        if (event.hasTimeWarning)
          details.push({ label: "Time Warning", value: "⚠️ Sent" });
        break;
      case EVENT_TYPES.API_RESPONSE:
        details.push({ label: "Iteration", value: event.iteration });
        details.push({
          label: "Has Tool Calls",
          value: event.hasToolCalls ? "✓ Yes" : "✗ No",
        });
        details.push({
          label: "Has Text",
          value: event.hasText ? "✓ Yes" : "✗ No",
        });
        if (event.responseTime)
          details.push({
            label: "Response Time",
            value: `${event.responseTime}ms`,
          });
        break;
      case EVENT_TYPES.MODEL_TEXT:
        // This is the model's actual text output
        details.push({ label: "Response", value: event.text, response: true });
        details.push({ label: "Length", value: `${event.fullLength} chars` });
        if (event.iteration)
          details.push({ label: "Step", value: event.iteration });
        break;
      case EVENT_TYPES.TIME_WARNING:
        details.push({
          label: "Pressure Level",
          value: event.pressure,
          highlight: true,
        });
        details.push({
          label: "Time Remaining",
          value: `${event.remainingSec}s`,
        });
        if (event.message)
          details.push({ label: "Message", value: event.message });
        break;
      case EVENT_TYPES.ERROR:
        details.push({ label: "Error", value: event.message, error: true });
        if (event.attempt)
          details.push({ label: "Attempt", value: event.attempt });
        if (event.elapsed)
          details.push({
            label: "Elapsed Time",
            value: `${(event.elapsed / 1000).toFixed(1)}s`,
          });
        break;
      case EVENT_TYPES.RETRY:
        details.push({ label: "Attempt", value: event.attempt });
        details.push({ label: "Wait Time", value: `${event.waitTime}ms` });
        details.push({ label: "Reason", value: event.reason });
        break;
      case EVENT_TYPES.SESSION_END:
        details.push({
          label: "Success",
          value: event.success ? "✓ Yes" : "✗ No",
        });
        details.push({ label: "Iterations", value: event.iterations });
        details.push({
          label: "Total Tool Calls",
          value: event.totalToolCalls,
        });
        details.push({
          label: "Duration",
          value: `${(event.duration / 1000).toFixed(1)}s`,
        });
        if (event.hasUI)
          details.push({ label: "UI Generated", value: "✓ Yes" });
        break;
      default:
        Object.entries(event).forEach(([key, value]) => {
          if (!["id", "type", "timestamp", "time"].includes(key)) {
            details.push({
              label: key,
              value:
                typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value),
            });
          }
        });
    }

    return details;
  };

  const toggleExpand = (eventId) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  // Calculate session stats
  const sessionStats = useMemo(() => {
    const toolCalls = events.filter(
      (e) => e.type === EVENT_TYPES.TOOL_CALL
    ).length;
    const thinkingEvents = events.filter(
      (e) => e.type === EVENT_TYPES.THINKING
    ).length;
    const errors = events.filter((e) => e.type === EVENT_TYPES.ERROR).length;
    const sessionEnd = events.find((e) => e.type === EVENT_TYPES.SESSION_END);

    return {
      toolCalls,
      thinkingEvents,
      errors,
      duration: sessionEnd?.duration
        ? (sessionEnd.duration / 1000).toFixed(1) + "s"
        : "In progress",
      iterations:
        sessionEnd?.iterations ||
        events.filter((e) => e.type === EVENT_TYPES.API_REQUEST).length,
      success: sessionEnd?.success,
    };
  }, [events]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-blue-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <span className="text-xl">🧠</span>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  AI Thought Chain
                </h3>
                <p className="text-xs text-gray-500">
                  See exactly what's happening behind the scenes
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <svg
                className="w-5 h-5 text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
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

          {/* Stats Bar */}
          <div className="flex flex-wrap gap-2 mt-3 text-xs">
            {sessionStats.thinkingEvents > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 bg-pink-50 rounded-md">
                <span className="text-pink-600">💭</span>
                <span className="text-pink-700">
                  {sessionStats.thinkingEvents} thoughts
                </span>
              </div>
            )}
            <div className="flex items-center gap-1 px-2 py-1 bg-white/70 rounded-md">
              <span className="text-amber-600">🔧</span>
              <span className="text-gray-600">
                {sessionStats.toolCalls} tool calls
              </span>
            </div>
            <div className="flex items-center gap-1 px-2 py-1 bg-white/70 rounded-md">
              <span className="text-purple-600">📤</span>
              <span className="text-gray-600">
                {sessionStats.iterations} iterations
              </span>
            </div>
            <div className="flex items-center gap-1 px-2 py-1 bg-white/70 rounded-md">
              <span className="text-blue-600">⏱️</span>
              <span className="text-gray-600">{sessionStats.duration}</span>
            </div>
            {sessionStats.errors > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 bg-red-50 rounded-md">
                <span className="text-red-600">❌</span>
                <span className="text-red-700">
                  {sessionStats.errors} errors
                </span>
              </div>
            )}
            {sessionStats.success !== undefined && (
              <div
                className={`flex items-center gap-1 px-2 py-1 rounded-md ${
                  sessionStats.success ? "bg-green-50" : "bg-red-50"
                }`}
              >
                <span>{sessionStats.success ? "✅" : "⚠️"}</span>
                <span
                  className={
                    sessionStats.success ? "text-green-700" : "text-red-700"
                  }
                >
                  {sessionStats.success ? "Completed" : "Failed"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Event List */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
          {events.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-5xl mb-4">💭</div>
              <p className="font-medium">No events yet</p>
              <p className="text-sm mt-1">
                Start a conversation to see the AI's thought process
              </p>
            </div>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

              {/* Events */}
              <div className="space-y-3">
                {events.map((event, idx) => {
                  const isExpanded = expandedEvents.has(event.id);
                  const details = formatEventDetails(event);

                  return (
                    <motion.div
                      key={event.id || idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(idx * 0.02, 0.5) }}
                      className="relative pl-10"
                    >
                      {/* Timeline dot */}
                      <div
                        className={`absolute left-2 w-5 h-5 rounded-full flex items-center justify-center text-xs border-2 border-white shadow-sm ${
                          getEventColor(event.type).split(" ")[1]
                        }`}
                      >
                        {getEventIcon(event.type)}
                      </div>

                      {/* Event card */}
                      <div
                        className={`rounded-lg border p-3 cursor-pointer transition-all hover:shadow-md ${getEventColor(
                          event.type
                        )}`}
                        onClick={() => toggleExpand(event.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {getEventTitle(event)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 font-mono">
                              {event.time}
                            </span>
                            <svg
                              className={`w-4 h-4 text-gray-400 transition-transform ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 9l-7 7-7-7"
                              />
                            </svg>
                          </div>
                        </div>

                        {/* Expanded details */}
                        <AnimatePresence>
                          {isExpanded && details.length > 0 && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="mt-2 pt-2 border-t border-current/10 space-y-1.5"
                            >
                              {details.map((detail, i) => (
                                <div
                                  key={i}
                                  className={`text-xs ${
                                    detail.thinking || detail.response
                                      ? ""
                                      : "flex gap-2"
                                  }`}
                                >
                                  {detail.thinking ? (
                                    // Special styling for AI thinking/reasoning
                                    <div className="bg-gradient-to-r from-pink-50 to-purple-50 border border-pink-200 rounded-lg p-3 mt-1">
                                      <div className="flex items-center gap-2 mb-2">
                                        <span className="text-pink-600">
                                          💭
                                        </span>
                                        <span className="font-semibold text-pink-700 text-xs uppercase tracking-wider">
                                          AI Reasoning
                                        </span>
                                      </div>
                                      <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap italic">
                                        {detail.value}
                                      </p>
                                    </div>
                                  ) : detail.response ? (
                                    // Special styling for model's text response
                                    <div className="bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-200 rounded-lg p-3 mt-1">
                                      <div className="flex items-center gap-2 mb-2">
                                        <span className="text-cyan-600">
                                          💬
                                        </span>
                                        <span className="font-semibold text-cyan-700 text-xs uppercase tracking-wider">
                                          Generated Response
                                        </span>
                                      </div>
                                      <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">
                                        {detail.value}
                                      </p>
                                    </div>
                                  ) : detail.code ? (
                                    <>
                                      <span className="font-medium text-gray-500 min-w-[80px]">
                                        {detail.label}:
                                      </span>
                                      <pre className="flex-1 bg-black/5 rounded px-2 py-1 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap break-all">
                                        {detail.value}
                                      </pre>
                                    </>
                                  ) : detail.error ? (
                                    <>
                                      <span className="font-medium text-gray-500 min-w-[80px]">
                                        {detail.label}:
                                      </span>
                                      <span className="flex-1 text-red-700 font-medium break-all">
                                        {detail.value}
                                      </span>
                                    </>
                                  ) : detail.highlight ? (
                                    <>
                                      <span className="font-medium text-gray-500 min-w-[80px]">
                                        {detail.label}:
                                      </span>
                                      <span className="flex-1 font-semibold break-all">
                                        {detail.value}
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="font-medium text-gray-500 min-w-[80px]">
                                        {detail.label}:
                                      </span>
                                      <span className="flex-1 text-gray-700 break-all">
                                        {detail.value}
                                      </span>
                                    </>
                                  )}
                                </div>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <div className="text-xs text-gray-400">
            <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-600 font-mono text-[10px]">
              Esc
            </kbd>
            <span className="ml-1">to close</span>
          </div>
          <div className="text-xs text-gray-400">
            {events.length} events • Click to expand
          </div>
        </div>
      </motion.div>
    </div>
  );
};

// ============================================================================
// LIVE STATUS INDICATOR - Shows what the model is doing (clickable)
// ============================================================================

const StatusIndicator = ({ statusInfo, isVisible, onClick, eventCount }) => {
  const getStatusDisplay = () => {
    if (!statusInfo || !statusInfo.status) {
      return { icon: "💭", text: "Starting...", color: "gray", animate: true };
    }

    switch (statusInfo.status) {
      case STATUS_TYPES.THINKING:
        return {
          icon: "🧠",
          text: statusInfo.detail || "Thinking...",
          color: "purple",
          animate: true,
        };
      case STATUS_TYPES.LOADING_DATA:
        return {
          icon: "📊",
          text: statusInfo.detail || "Loading database...",
          color: "blue",
          animate: true,
        };
      case STATUS_TYPES.PROCESSING:
        return {
          icon: "⚙️",
          text: statusInfo.detail || "Processing...",
          color: "blue",
          animate: true,
        };
      case STATUS_TYPES.CALLING_TOOL:
        return {
          icon: "🔧",
          text: `Calling: ${statusInfo.detail || "tool"}`,
          color: "amber",
          animate: true,
        };
      case STATUS_TYPES.EXECUTING:
        return {
          icon: "▶️",
          text: statusInfo.detail || "Executing...",
          color: "green",
          animate: true,
        };
      case STATUS_TYPES.VERIFYING:
        return {
          icon: "✅",
          text: statusInfo.detail || "Verifying output...",
          color: "cyan",
          animate: true,
        };
      case STATUS_TYPES.FIXING_ERROR:
        return {
          icon: "🔄",
          text: statusInfo.detail || "Fixing errors...",
          color: "orange",
          animate: true,
        };
      case STATUS_TYPES.REQUERYING:
        return {
          icon: "🔃",
          text: statusInfo.detail || "Re-fetching data...",
          color: "blue",
          animate: true,
        };
      case STATUS_TYPES.RENDERING:
        return {
          icon: "🎨",
          text: statusInfo.detail || "Rendering UI...",
          color: "indigo",
          animate: true,
        };
      case STATUS_TYPES.COMPLETE:
        return {
          icon: "✨",
          text: "Complete",
          color: "green",
          animate: false,
        };
      case STATUS_TYPES.ERROR:
        return {
          icon: "❌",
          text: statusInfo.detail || "Error occurred",
          color: "red",
          animate: false,
        };
      default:
        return {
          icon: "⏳",
          text: statusInfo.detail || "Working...",
          color: "gray",
          animate: true,
        };
    }
  };

  const display = getStatusDisplay();

  if (!isVisible) return null;

  const colorClasses = {
    gray: "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200",
    blue: "bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100",
    purple:
      "bg-purple-50 border-purple-300 text-purple-700 hover:bg-purple-100",
    amber: "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100",
    green: "bg-green-50 border-green-300 text-green-700 hover:bg-green-100",
    cyan: "bg-cyan-50 border-cyan-300 text-cyan-700 hover:bg-cyan-100",
    orange:
      "bg-orange-50 border-orange-300 text-orange-700 hover:bg-orange-100",
    indigo:
      "bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100",
    red: "bg-red-50 border-red-300 text-red-700 hover:bg-red-100",
  };

  return (
    <motion.button
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
        colorClasses[display.color] || colorClasses.gray
      }`}
      title="Click to view thought chain"
    >
      <span className={`text-base ${display.animate ? "animate-pulse" : ""}`}>
        {display.icon}
      </span>
      <span className="text-sm font-medium max-w-[200px] truncate">
        {display.text}
      </span>
      {display.animate && (
        <span className="flex gap-0.5 ml-1">
          <span
            className="w-1.5 h-1.5 bg-current rounded-full animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="w-1.5 h-1.5 bg-current rounded-full animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="w-1.5 h-1.5 bg-current rounded-full animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </span>
      )}
      {eventCount > 0 && (
        <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-white/70 border border-current/20 rounded-full min-w-[20px] text-center">
          {eventCount}
        </span>
      )}
    </motion.button>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function SystemInsightsPanel({
  departmentEfficiency,
  weights,
  bufferPenaltyWeight,
  bufferCompliance,
  onAskSystem,
  stage,
  stageStats,
  onOpenCaseHistory,
}) {
  const dataContext = useMut();
  const { refreshCases } = dataContext || {};

  const [activeTab, setActiveTab] = useState("insights");
  const [qaInput, setQaInput] = useState("");
  const [conversation, setConversation] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(true);
  const [lastError, setLastError] = useState(null);
  const [isExecutingAction, setIsExecutingAction] = useState(false);
  const [isLLMMode, setIsLLMMode] = useState(() => {
    const saved = localStorage.getItem("ai_chat_mode");
    return saved === "llm";
  });
  const [llmStatus, setLlmStatus] = useState(null);
  const [eventLog, setEventLog] = useState([]);
  const [showThoughtChain, setShowThoughtChain] = useState(false);
  const [conversationContext, setConversationContext] = useState({
    topics: [],
    lastIntent: null,
    askedQuestions: [],
    messageCount: 0,
    sessionId: Date.now(),
    components: [],
  });
  const [suggestedQuestions, setSuggestedQuestions] = useState([
    "Show me all overdue cases",
    "What cases are at high risk?",
    "Give me a workload overview",
    "Show cases in design stage",
  ]);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // Set up LLM status and event log callbacks
  useEffect(() => {
    if (isLLMMode) {
      setStatusCallback((statusInfo) => {
        setLlmStatus(statusInfo);
        // Auto-clear complete status after a delay
        if (
          statusInfo.status === STATUS_TYPES.COMPLETE ||
          statusInfo.status === STATUS_TYPES.ERROR
        ) {
          setTimeout(() => setLlmStatus(null), 2000);
        }
      });

      setEventLogCallback((events) => {
        setEventLog(events);
      });
    }
    return () => {
      setStatusCallback(null);
      setEventLogCallback(null);
    };
  }, [isLLMMode]);

  // Metrics
  const onTimeRate = pct(
    departmentEfficiency?.onTimeDelivery?.overall?.actualRate ?? 0
  );
  const velocityScore = pct(departmentEfficiency?.throughput?.overall ?? 0);
  const bufferComp = pct(bufferCompliance ?? 100);
  const penaltyCases =
    departmentEfficiency?.onTimeDelivery?.caseInsights?.casesWithPenalties ||
    [];

  // Mode toggle
  const handleModeToggle = useCallback(() => {
    setIsLLMMode((prev) => {
      const newMode = !prev;
      localStorage.setItem("ai_chat_mode", newMode ? "llm" : "heuristic");
      setConversation([]);
      setLastError(null);
      if (!newMode) resetLLMChat();
      setConversationContext({
        topics: [],
        lastIntent: null,
        askedQuestions: [],
        messageCount: 0,
        sessionId: Date.now(),
        components: [],
      });
      setSuggestedQuestions(
        newMode
          ? [
              "Show me all overdue cases",
              "What cases are at high risk?",
              "Give me a workload overview",
              "Show cases in design stage",
            ]
          : [
              "How can I improve my score?",
              "What's my biggest issue?",
              "Show me at-risk cases",
              "What changed since yesterday?",
            ]
      );
      return newMode;
    });
  }, []);

  // Insights
  const insights = useMemo(() => {
    const items = [];
    if (onTimeRate < 80) {
      items.push({
        priority: "high",
        title: "Critical: On-Time Delivery",
        description: `Only ${onTimeRate.toFixed(
          0
        )}% of cases delivered on time. This is significantly impacting your score.`,
        action: "Implement immediate intervention for late cases",
        metric: { value: `${onTimeRate.toFixed(0)}%`, label: "on-time" },
      });
    }
    if (velocityScore < 75) {
      items.push({
        priority: "high",
        title: "Velocity Below Target",
        description:
          "Cases are taking longer than benchmarks. Focus on the slowest case types.",
        action: "Review bottlenecks in processing",
        metric: { value: `${velocityScore.toFixed(0)}%`, label: "velocity" },
      });
    }
    if (bufferComp < 90 && departmentEfficiency?.stage !== "finishing") {
      items.push({
        priority: "medium",
        title: "Buffer Compliance Issue",
        description: `Buffer compliance at ${bufferComp.toFixed(
          0
        )}%. Improving by 5% would add 2-3 points.`,
        action: "Adjust scheduling to meet buffer requirements",
        metric: { value: `${bufferComp.toFixed(0)}%`, label: "buffer" },
      });
    }
    if (items.length === 0) {
      items.push({
        priority: "low",
        title: "Performance Strong",
        description:
          "All metrics are within acceptable ranges. Continue monitoring for changes.",
        metric: {
          value: `${((onTimeRate + velocityScore) / 2).toFixed(0)}%`,
          label: "average",
        },
      });
    }
    return items;
  }, [onTimeRate, velocityScore, bufferComp, departmentEfficiency?.stage]);

  // Problem cases
  const problemCases = useMemo(() => {
    return penaltyCases.slice(0, 10).map((c) => ({
      caseNumber: c.caseNumber,
      issues: [
        c.hoursLate > 0 && "late",
        c.velocityPenalty && "slow",
        c.bufferViolations?.length > 0 && "buffer",
      ].filter(Boolean),
      impact: c.hoursLate > 0 ? -2.5 : c.velocityPenalty ? -1.5 : -0.5,
    }));
  }, [penaltyCases]);

  // ============================================================================
  // ACTION EXECUTION - Actually perform the actions!
  // ============================================================================

  const executeAction = useCallback(
    async (actionData) => {
      console.log("[SystemInsightsPanel] Executing action:", actionData);

      try {
        const {
          actionType,
          target,
          changes,
          case_number,
          case_numbers,
          target_stage,
          action,
        } = actionData;

        // Normalize target data
        const caseNumber = target?.case_number || case_number;
        const caseNumbers = target?.case_numbers || case_numbers || [];
        const newStage = changes?.stage || target_stage;

        // Single case edit
        if (
          (actionType === "edit_case" ||
            actionType === "edit" ||
            actionType === "toggle_flag") &&
          caseNumber
        ) {
          // Find the case by case number
          const { data: caseData, error: lookupError } = await db
            .from("cases")
            .select("*")
            .ilike("casenumber", `%${caseNumber}%`)
            .limit(1)
            .single();

          if (lookupError || !caseData) {
            throw new Error(`Could not find case ${caseNumber}`);
          }

          // Apply changes
          if (changes?.priority !== undefined) {
            await CaseService.togglePriority({
              id: caseData.id,
              priority: !changes.priority,
            });
          }
          if (changes?.rush !== undefined) {
            await CaseService.toggleRush({
              id: caseData.id,
              modifiers: caseData.modifiers || [],
            });
          }
          if (changes?.hold !== undefined) {
            await CaseService.toggleHold({
              id: caseData.id,
              modifiers: caseData.modifiers || [],
            });
          }
          if (changes?.new_account !== undefined) {
            await CaseService.toggleNewAccount({
              id: caseData.id,
              modifiers: caseData.modifiers || [],
            });
          }

          return {
            success: true,
            message: `Case ${caseNumber} updated successfully`,
          };
        }

        // Stage move
        if (
          (actionType === "move_stage" || actionType === "stage_move") &&
          caseNumber &&
          newStage
        ) {
          // Find the case
          const { data: caseData, error: lookupError } = await db
            .from("cases")
            .select("*")
            .ilike("casenumber", `%${caseNumber}%`)
            .limit(1)
            .single();

          if (lookupError || !caseData) {
            throw new Error(`Could not find case ${caseNumber}`);
          }

          // Update stage
          if (dataContext?.updateCaseStage) {
            await dataContext.updateCaseStage(
              { id: caseData.id, modifiers: caseData.modifiers || [] },
              newStage
            );
          } else {
            // Direct update
            const currentMods = caseData.modifiers || [];
            const filteredMods = currentMods.filter(
              (m) => !m.startsWith("stage-")
            );
            filteredMods.push(`stage-${newStage}`);

            await db
              .from("cases")
              .update({ modifiers: filteredMods })
              .eq("id", caseData.id);
            await CaseService.logCase(
              caseData.id,
              `Moved to ${newStage} stage via AI assistant`
            );
          }

          return {
            success: true,
            message: `Case ${caseNumber} moved to ${newStage}`,
          };
        }

        // Bulk update
        if (
          (actionType === "bulk_update" || actionType === "bulk") &&
          caseNumbers.length > 0
        ) {
          const results = [];

          for (const cn of caseNumbers) {
            const { data: caseData } = await db
              .from("cases")
              .select("*")
              .ilike("casenumber", `%${cn}%`)
              .limit(1)
              .single();

            if (!caseData) {
              results.push({
                caseNumber: cn,
                success: false,
                error: "Not found",
              });
              continue;
            }

            try {
              // Apply changes based on the changes object or action string
              if (changes?.priority !== undefined) {
                if (changes.priority !== caseData.priority) {
                  await CaseService.togglePriority({
                    id: caseData.id,
                    priority: caseData.priority,
                  });
                }
              }
              if (changes?.rush !== undefined) {
                const hasRush = (caseData.modifiers || []).includes("rush");
                if (changes.rush !== hasRush) {
                  await CaseService.toggleRush({
                    id: caseData.id,
                    modifiers: caseData.modifiers || [],
                  });
                }
              }
              if (changes?.hold !== undefined) {
                const hasHold = (caseData.modifiers || []).includes("hold");
                if (changes.hold !== hasHold) {
                  await CaseService.toggleHold({
                    id: caseData.id,
                    modifiers: caseData.modifiers || [],
                  });
                }
              }
              if (changes?.stage) {
                const currentMods = caseData.modifiers || [];
                const filteredMods = currentMods.filter(
                  (m) => !m.startsWith("stage-")
                );
                filteredMods.push(`stage-${changes.stage}`);
                await db
                  .from("cases")
                  .update({ modifiers: filteredMods })
                  .eq("id", caseData.id);
                await CaseService.logCase(
                  caseData.id,
                  `Moved to ${changes.stage} stage via bulk action`
                );
              }

              // Handle legacy action string format
              if (action) {
                switch (action) {
                  case "set_priority":
                    if (!caseData.priority) {
                      await CaseService.togglePriority({
                        id: caseData.id,
                        priority: false,
                      });
                    }
                    break;
                  case "remove_priority":
                    if (caseData.priority) {
                      await CaseService.togglePriority({
                        id: caseData.id,
                        priority: true,
                      });
                    }
                    break;
                  case "set_rush":
                    if (!(caseData.modifiers || []).includes("rush")) {
                      await CaseService.toggleRush({
                        id: caseData.id,
                        modifiers: caseData.modifiers || [],
                      });
                    }
                    break;
                  case "remove_rush":
                    if ((caseData.modifiers || []).includes("rush")) {
                      await CaseService.toggleRush({
                        id: caseData.id,
                        modifiers: caseData.modifiers || [],
                      });
                    }
                    break;
                  case "set_hold":
                    if (!(caseData.modifiers || []).includes("hold")) {
                      await CaseService.toggleHold({
                        id: caseData.id,
                        modifiers: caseData.modifiers || [],
                      });
                    }
                    break;
                  case "remove_hold":
                    if ((caseData.modifiers || []).includes("hold")) {
                      await CaseService.toggleHold({
                        id: caseData.id,
                        modifiers: caseData.modifiers || [],
                      });
                    }
                    break;
                }
              }

              results.push({ caseNumber: cn, success: true });
            } catch (e) {
              results.push({
                caseNumber: cn,
                success: false,
                error: e.message,
              });
            }
          }

          const successCount = results.filter((r) => r.success).length;
          return {
            success: successCount > 0,
            message: `${successCount} of ${caseNumbers.length} cases updated`,
          };
        }

        return { success: false, message: "Unknown action type" };
      } catch (error) {
        console.error("[SystemInsightsPanel] Action execution error:", error);
        throw error;
      }
    },
    [dataContext]
  );

  // Action handlers
  const handleActionConfirm = useCallback(
    async (actionData) => {
      setIsExecutingAction(true);
      try {
        const result = await executeAction(actionData);

        // Refresh the cases data
        if (refreshCases) {
          await refreshCases();
        }

        setConversation((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Done! ${result.message}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      } catch (error) {
        setConversation((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Failed to execute action: ${error.message}`,
            timestamp: new Date().toISOString(),
            isError: true,
          },
        ]);
      } finally {
        setIsExecutingAction(false);
      }
    },
    [executeAction, refreshCases]
  );

  const handleActionCancel = useCallback((actionData) => {
    setConversation((prev) => [
      ...prev,
      {
        role: "assistant",
        content:
          "Action cancelled. Let me know if you'd like to try something different.",
        timestamp: new Date().toISOString(),
      },
    ]);
  }, []);

  // Dynamic action handler (from live-coded components)
  const handleDynamicAction = useCallback(
    async (actionType, payload, componentData) => {
      console.log("[SystemInsightsPanel] Dynamic action:", actionType, payload);

      // Handle various action types from dynamic components
      if (actionType === "confirm" || actionType === "execute") {
        await handleActionConfirm(payload);
      } else if (actionType === "cancel") {
        handleActionCancel(payload);
      } else if (actionType === "query") {
        // Could trigger a new question
        setQaInput(payload.question || "");
        if (payload.autoSubmit) {
          handleAsk(payload.question);
        }
      } else {
        console.log(
          "[SystemInsightsPanel] Unhandled dynamic action:",
          actionType
        );
      }
    },
    [handleActionConfirm, handleActionCancel]
  );

  // Modal handling
  const handleModalOpen = (modalType, caseId, caseNumber) => {
    if (modalType === "HISTORY" && onOpenCaseHistory) {
      onOpenCaseHistory(caseId, caseNumber);
    }
  };

  // Chat input handling
  const handleActionClick = (command) => {
    setQaInput(command);
    handleAsk(command);
  };

  const handleRetry = useCallback(() => {
    if (lastError?.input) handleAsk(lastError.input);
  }, [lastError]);

  const handleSwitchModeAfterError = useCallback(() => {
    handleModeToggle();
  }, [handleModeToggle]);

  const handleAsk = async (inputOverride) => {
    const input = inputOverride || qaInput;
    if (!input.trim() || isLoading || isTyping) return;

    const userMessage = {
      role: "user",
      content: input,
      timestamp: new Date().toISOString(),
    };
    setConversation((prev) => [...prev, userMessage]);
    setQaInput("");
    setIsLoading(true);
    setLastError(null);
    setLlmStatus(null); // Clear previous status

    try {
      const fullContext = {
        efficiency: departmentEfficiency,
        stage: stage || departmentEfficiency?.stage,
        stageStats: stageStats,
        metrics: {
          onTimeRate,
          velocityScore,
          bufferCompliance: bufferComp,
          score: departmentEfficiency?.score,
        },
        activeDept: departmentEfficiency?.department,
        stageCount: departmentEfficiency?.activeCases,
        conversationContext: {
          ...conversationContext,
          previousMessages: conversation.slice(-10).map((msg) => ({
            role: msg.role,
            content: msg.content.substring(0, 200),
            timestamp: msg.timestamp,
          })),
        },
        sessionId: conversationContext.sessionId,
        messageCount: conversationContext.messageCount,
      };

      let response;
      if (isLLMMode) {
        response = await askLLM(input, fullContext);
      } else {
        response = await onAskSystem(input, fullContext);
      }

      const isErrorResponse =
        response.includes("**Error") ||
        response.includes("API request failed") ||
        response.includes("<html");

      if (isErrorResponse && !response.includes("<!--UI_ELEMENT:")) {
        setLastError({ input, response });
      }

      // Update conversation context
      setConversationContext((prev) => ({
        ...prev,
        messageCount: prev.messageCount + 1,
        askedQuestions: [...prev.askedQuestions, input].slice(-20),
      }));

      setIsTyping(true);
      setConversation((prev) => [
        ...prev,
        {
          role: "assistant",
          content: response,
          timestamp: new Date().toISOString(),
          isError: isErrorResponse && !response.includes("<!--UI_ELEMENT:"),
        },
      ]);
    } catch (error) {
      console.error("[SystemInsightsPanel] Q&A Error:", error);
      setLastError({ input, error: error.message || error });
      setIsTyping(true);
      setConversation((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${formatErrorMessage(error).message}`,
          timestamp: new Date().toISOString(),
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTypingComplete = () => {
    setIsTyping(false);
    inputRef.current?.focus();
  };

  // Auto-scroll
  useEffect(() => {
    if (!isTyping) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation, isTyping]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (activeTab !== "assistant") setActiveTab("assistant");
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === inputRef.current)
        setQaInput("");
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        setShowDebugInfo((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [activeTab]);

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex gap-2">
        <Tab
          active={activeTab === "insights"}
          onClick={() => setActiveTab("insights")}
        >
          Priority Insights
        </Tab>
        <Tab
          active={activeTab === "cases"}
          onClick={() => setActiveTab("cases")}
          count={problemCases.length}
        >
          Problem Cases
        </Tab>
        <Tab
          active={activeTab === "assistant"}
          onClick={() => setActiveTab("assistant")}
        >
          AI Assistant
          {conversationContext.messageCount > 0 && (
            <span className="ml-1 w-2 h-2 bg-green-400 rounded-full inline-block animate-pulse" />
          )}
        </Tab>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {activeTab === "insights" && (
          <motion.div
            key="insights"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            {insights.map((insight, i) => (
              <InsightCard key={i} {...insight} />
            ))}
          </motion.div>
        )}

        {activeTab === "cases" && (
          <motion.div
            key="cases"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-700">
                  Cases Impacting Score
                </h4>
                <span className="text-xs text-gray-500">Sorted by impact</span>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                {problemCases.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-sm">
                    No problem cases identified
                  </div>
                ) : (
                  problemCases.map((c, i) => <CaseIssueRow key={i} {...c} />)
                )}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "assistant" && (
          <motion.div
            key="assistant"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            {/* Chat History */}
            <div className="h-96 overflow-y-auto bg-gray-50 rounded-lg p-4">
              {conversation.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                  <div className="text-center">
                    <div className="text-4xl mb-3">
                      {isLLMMode ? "AI" : "H"}
                    </div>
                    <p className="font-medium">
                      {isLLMMode
                        ? "GPT-5.2-Codex Mode"
                        : "Heuristic Mode Active"}
                    </p>
                    <p className="text-xs mt-1 max-w-xs">
                      {isLLMMode
                        ? "Full database access, live UI generation, and action capabilities. I can create custom visualizations on the fly!"
                        : "Fast pattern-based responses using built-in logic"}
                    </p>
                    <div className="mt-4 space-y-1 text-xs text-gray-500">
                      <p>
                        <kbd className="px-1 py-0.5 bg-gray-200 rounded text-gray-700">
                          Ctrl+K
                        </kbd>{" "}
                        to focus input
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {conversation.map((msg, i) => (
                    <Message
                      key={i}
                      {...msg}
                      isLatest={
                        i === conversation.length - 1 &&
                        msg.role === "assistant"
                      }
                      onTypingComplete={
                        i === conversation.length - 1
                          ? handleTypingComplete
                          : undefined
                      }
                      onActionClick={handleActionClick}
                      onModalOpen={handleModalOpen}
                      onActionConfirm={handleActionConfirm}
                      onActionCancel={handleActionCancel}
                      onDynamicAction={handleDynamicAction}
                      showDebug={showDebugInfo}
                      onRetry={msg.isError ? handleRetry : undefined}
                      onSwitchMode={
                        msg.isError && isLLMMode
                          ? handleSwitchModeAfterError
                          : undefined
                      }
                      isExecutingAction={isExecutingAction}
                    />
                  ))}
                  {isLoading && (
                    <div className="flex justify-start mb-3">
                      <div className="max-w-[90%]">
                        <AnimatePresence mode="wait">
                          {isLLMMode && (llmStatus || isLoading) ? (
                            <StatusIndicator
                              key="status"
                              statusInfo={llmStatus}
                              isVisible={true}
                              onClick={() => setShowThoughtChain(true)}
                              eventCount={eventLog.length}
                            />
                          ) : (
                            <motion.div
                              key="dots"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="bg-gray-100 px-4 py-2 rounded-lg rounded-bl-none"
                            >
                              <div className="flex gap-1">
                                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                                <span
                                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                                  style={{ animationDelay: "0.1s" }}
                                />
                                <span
                                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                                  style={{ animationDelay: "0.2s" }}
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </>
              )}
            </div>

            {/* Input Area */}
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={qaInput}
                onChange={(e) => setQaInput(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleAsk()}
                placeholder={
                  isLLMMode
                    ? "Ask anything - I have full database access and can create custom UIs..."
                    : "Ask about performance, cases, trends, or improvements..."
                }
                className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                disabled={isTyping || isExecutingAction}
              />
              <button
                onClick={() => handleAsk()}
                disabled={
                  !qaInput.trim() || isLoading || isTyping || isExecutingAction
                }
                className="px-6 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Send
              </button>
            </div>

            {/* Suggested Questions */}
            <div className="flex flex-wrap gap-2">
              {suggestedQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setQaInput(q);
                    handleAsk(q);
                  }}
                  disabled={isTyping || isExecutingAction}
                  className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Mode Toggle */}
            <div className="flex items-center justify-between text-xs text-gray-400">
              <AIModeToggle
                isLLMMode={isLLMMode}
                onToggle={handleModeToggle}
                disabled={isLoading || isTyping || isExecutingAction}
              />
              <div className="flex items-center gap-3">
                {isLLMMode && eventLog.length > 0 && (
                  <button
                    onClick={() => setShowThoughtChain(true)}
                    className="text-purple-600 hover:text-purple-700 flex items-center gap-1"
                  >
                    <span>💭</span>
                    <span>View thought chain ({eventLog.length})</span>
                  </button>
                )}
                <button
                  onClick={() => setShowDebugInfo(!showDebugInfo)}
                  className="text-blue-600 hover:text-blue-700"
                >
                  {showDebugInfo ? "Hide" : "Show"} debug info
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Thought Chain Modal */}
      <AnimatePresence>
        {showThoughtChain && (
          <ThoughtChainModal
            isOpen={showThoughtChain}
            onClose={() => setShowThoughtChain(false)}
            events={eventLog}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
