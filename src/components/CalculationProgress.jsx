// components/CalculationProgress.jsx
import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const CalculationProgress = ({ progress, isVisible }) => {
  useEffect(() => {
    console.log("CalculationProgress:", { progress, isVisible });
  }, [progress, isVisible]);

  return (
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          key="progress-bar"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="px-4 py-2">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-blue-500"
                    initial={{ width: 0 }}
                    animate={{
                      width: `${Math.max(0, Math.min(100, progress))}%`,
                    }}
                    transition={{ duration: 0.1, ease: "linear" }}
                  />
                </div>
              </div>
              <span className="text-xs text-gray-500 font-medium min-w-[3ch]">
                {Math.round(progress)}%
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CalculationProgress;
