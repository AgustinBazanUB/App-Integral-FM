import { useEffect } from "react";

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useFocusTrap({
  active,
  containerRef,
  initialFocusRef,
  returnFocusRef,
  onEscape,
}) {
  useEffect(() => {
    if (!active || !containerRef.current) return undefined;

    const container = containerRef.current;
    const previousFocus = document.activeElement;
    const getFocusable = () =>
      [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
        (element) =>
          !element.hidden &&
          element.getAttribute("aria-hidden") !== "true" &&
          !element.classList.contains("modal-backdrop") &&
          !element.classList.contains("cart-backdrop"),
      );

    if (!container.contains(document.activeElement)) {
      (initialFocusRef?.current ?? getFocusable()[0] ?? container).focus();
    }

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("no-scroll");

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("no-scroll");
      (returnFocusRef?.current ?? previousFocus)?.focus?.();
    };
  }, [active, containerRef, initialFocusRef, returnFocusRef, onEscape]);
}
