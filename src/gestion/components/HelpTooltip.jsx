import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

const mergeIds = (...values) => values.filter(Boolean).join(" ") || undefined;

export default function HelpTooltip({ label, children, placement = "bottom" }) {
  const tooltipId = useId();
  const wrapperRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const place = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(280, Math.max(190, window.innerWidth - 24));
    const left = Math.min(
      Math.max(12, rect.left + rect.width / 2 - width / 2),
      Math.max(12, window.innerWidth - width - 12),
    );
    const top = placement === "top"
      ? Math.max(12, rect.top - 10)
      : Math.min(window.innerHeight - 12, rect.bottom + 8);
    setPosition({ top, left, width });
  };

  const show = () => {
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    const reposition = () => place();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, placement]);

  const child = isValidElement(children)
    ? cloneElement(children, {
        "aria-describedby": mergeIds(children.props["aria-describedby"], tooltipId),
      })
    : children;

  const bubble = open && typeof document !== "undefined"
    ? createPortal(
        <span
          id={tooltipId}
          role="tooltip"
          className={`fm-help-tooltip__bubble fm-help-tooltip__bubble--${placement}`}
          style={{ top: position.top, left: position.left, width: position.width }}
        >
          {label}
        </span>,
        document.body,
      )
    : null;

  return (
    <span
      ref={wrapperRef}
      className="fm-help-tooltip"
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={show}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      {child}
      <button
        type="button"
        className="fm-help-tooltip__touch"
        aria-label={`Ayuda: ${label}`}
        aria-describedby={tooltipId}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (open) setOpen(false);
          else show();
        }}
      >
        <Icon name="CircleHelp" />
      </button>
      {bubble}
    </span>
  );
}
