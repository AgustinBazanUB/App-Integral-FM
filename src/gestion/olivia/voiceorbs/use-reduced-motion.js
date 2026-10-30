// Adapted from amunozdev/voiceorbs (MIT). See LICENSE.
"use client";
import { useSyncExternalStore } from "react";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
const subscribeReducedMotion = (onChange) => {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
const useReducedMotion = () => useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
export {
  REDUCED_MOTION_QUERY,
  prefersReducedMotion,
  subscribeReducedMotion,
  useReducedMotion
};
