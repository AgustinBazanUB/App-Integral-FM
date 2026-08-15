
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_GAP = 8;

function focusableInside(node) {
  return node?.querySelector(
    "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
  );
}

export default function AnchoredPopover({
  open,
  onClose,
  triggerRef,
  children,
  className = "",
  role = "dialog",
  ariaLabel,
  align = "end",
}) {
  const popoverRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false });

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      const triggerRect = trigger.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const preferredLeft = align === "start"
        ? triggerRect.left
        : triggerRect.right - popoverRect.width;
      const left = Math.min(
        Math.max(VIEWPORT_GAP, preferredLeft),
        Math.max(VIEWPORT_GAP, viewportWidth - popoverRect.width - VIEWPORT_GAP),
      );
      const below = triggerRect.bottom + 7;
      const above = triggerRect.top - popoverRect.height - 7;
      const top = below + popoverRect.height <= viewportHeight - VIEWPORT_GAP
        ? below
        : Math.max(VIEWPORT_GAP, above);
      setPosition({ top, left, ready: true });
    };
    const frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update, { passive: true });
    document.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [align, open, triggerRef]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      (focusableInside(popoverRef.current) || popoverRef.current)?.focus?.();
    });
    const onPointerDown = (event) => {
      if (popoverRef.current?.contains(event.target)) return;
      if (triggerRef.current?.contains(event.target)) return;
      onClose?.();
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose?.();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => {
        if (previous && previous !== document.body && document.contains(previous)) previous.focus?.();
        else triggerRef.current?.focus?.();
      });
    };
  }, [open, onClose, triggerRef]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={popoverRef}
      className={`fm-anchored-popover ${className}`.trim()}
      role={role}
      aria-label={ariaLabel}
      tabIndex={-1}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        visibility: position.ready ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
