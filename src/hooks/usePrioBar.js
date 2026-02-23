import { useMotionValue, useSpring } from "framer-motion";
import { useEffect, useRef } from "react";

/**
 * Live motion‑values for the priority bar.
 * Returns { y, h } – both are spring‑animated MotionValues.
 * They update every animation frame without causing React re‑renders.
 */
export function usePrioBar(colRef, firstRef, lastRef) {
  /* raw motion values */
  const mvY = useMotionValue(0);
  const mvH = useMotionValue(0);

  /* springs */
  const y = useSpring(mvY, { stiffness: 650, damping: 45, mass: 0.5 });
  const h = useSpring(mvH, { stiffness: 650, damping: 45, mass: 0.5 });

  const raf = useRef(null);

  useEffect(() => {
    const tick = () => {
      if (colRef.current && firstRef.current && lastRef.current) {
        const colTop = colRef.current.getBoundingClientRect().top;
        const firstRect = firstRef.current.getBoundingClientRect();
        const lastRect = lastRef.current.getBoundingClientRect();

        const nextY = Math.round(firstRect.top - colTop); // vertical anchor
        const nextH = Math.max(0, Math.round(lastRect.bottom - firstRect.top));

        if (Math.abs(mvY.get() - nextY) > 0.5) mvY.set(nextY);
        if (Math.abs(mvH.get() - nextH) > 0.5) mvH.set(nextH);
      } else if (mvH.get() !== 0) {
        /* no priority rows → collapse */
        mvH.set(0);
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [colRef, firstRef, lastRef, mvY, mvH]);

  return { y, h };
}
