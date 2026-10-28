// Adapted from amunozdev/voiceorbs (MIT). See LICENSE.
"use client";
import { useEffect, useRef } from "react";
const observeActivity = (el, onChange) => {
  let inView = true;
  let pageVisible = document.visibilityState === "visible";
  let active = inView && pageVisible;
  const sync = () => {
    const next = inView && pageVisible;
    if (next === active) return;
    active = next;
    onChange(next);
  };
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    inView = entries[entries.length - 1]?.isIntersecting ?? true;
    sync();
  });
  observer?.observe(el);
  const onVisibility = () => {
    pageVisible = document.visibilityState === "visible";
    sync();
  };
  document.addEventListener("visibilitychange", onVisibility);
  onChange(active);
  return () => {
    observer?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
  };
};
const useInView = (ref, onChange) => {
  const activeRef = useRef(true);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const unobserve = observeActivity(el, (active) => {
      activeRef.current = active;
      onChangeRef.current?.(active);
    });
    return () => {
      unobserve();
      activeRef.current = true;
    };
  }, [ref]);
  return activeRef;
};
export {
  observeActivity,
  useInView
};
