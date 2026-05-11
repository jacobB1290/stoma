import { useMediaQuery } from "./useMediaQuery";

export function useIsMobile() {
  return useMediaQuery("(max-width: 768px)");
}

export function useIsTouch() {
  return useMediaQuery("(pointer: coarse)");
}
