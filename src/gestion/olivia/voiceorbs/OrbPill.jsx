// Adapted from VoiceOrbs (MIT), React 18 forwardRef. See LICENSE.
"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./orb-pill.module.css";
export const DEFAULT_ORB_MESSAGES = {
  idle: "Ready",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Something went wrong",
  disabled: "Unavailable"
};
const ORB_PX = { sm: 28, md: 40, lg: 56 };
const SHIMMER_STATES = ["connecting", "thinking"];
const messageList = (state, messages) => {
  const custom = messages?.[state];
  if (typeof custom === "string") return [custom];
  if (custom && custom.length > 0) return custom;
  return [DEFAULT_ORB_MESSAGES[state]];
};
const useRotatingMessage = (list, interval) => {
  const key = list.join("\0");
  const [tick, setTick] = useState({ key, index: 0 });
  const index = tick.key === key ? tick.index : 0;
  useEffect(() => {
    if (list.length < 2) return;
    const id = window.setInterval(
      () => setTick((prev) => ({ key, index: prev.key === key ? (prev.index + 1) % list.length : 1 })),
      interval
    );
    return () => window.clearInterval(id);
  }, [key, list.length, interval]);
  return list[index % list.length];
};
const Letters = ({ text }) => /* @__PURE__ */ jsx(Fragment, { children: Array.from(text).map((char, i) => /* @__PURE__ */ jsx("span", { className: styles.char, style: { "--i": i }, children: char === " " ? "\xA0" : char }, i)) });
export const OrbPillText = ({ text, shimmer = false, onWidth, className }) => {
  const [lines, setLines] = useState({
    current: { id: 0, text },
    leaving: null
  });
  const measureRef = useRef(null);
  const [width, setWidth] = useState(null);
  const onWidthRef = useRef(onWidth);
  useEffect(() => {
    onWidthRef.current = onWidth;
  }, [onWidth]);
  if (lines.current.text !== text) {
    setLines({ current: { id: lines.current.id + 1, text }, leaving: lines.current });
  }
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const measure = () => {
      const next = Math.ceil(el.getBoundingClientRect().width) + 1;
      setWidth(next);
      onWidthRef.current?.(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [lines.current.text]);
  return /* @__PURE__ */ jsxs(
    "span",
    {
      className: [styles.copy, className].filter(Boolean).join(" "),
      style: width === null ? void 0 : { width },
      "data-shimmer": shimmer ? "" : void 0,
      children: [
        lines.leaving && /* @__PURE__ */ jsx(
          "span",
          {
            className: `${styles.line} ${styles.leaving}`,
            "aria-hidden": "true",
            onAnimationEnd: (event) => {
              if (event.target === event.currentTarget) setLines((prev) => ({ ...prev, leaving: null }));
            },
            children: lines.leaving.text
          },
          lines.leaving.id
        ),
        /* @__PURE__ */ jsxs("span", { className: styles.line, "aria-hidden": "true", children: [
          /* @__PURE__ */ jsx("span", { ref: measureRef, className: styles.base, children: /* @__PURE__ */ jsx(Letters, { text: lines.current.text }) }),
          /* @__PURE__ */ jsx("span", { className: styles.sheen, children: lines.current.text })
        ] }, lines.current.id)
      ]
    }
  );
};
export const useOrbMessage = (state, { text, messages, interval = 2600 } = {}) => {
  const rotating = useRotatingMessage(messageList(state, messages), interval);
  return text ?? rotating;
};
export const isShimmerState = (state) => SHIMMER_STATES.includes(state);
export const OrbPill = forwardRef(function OrbPill2({
  orb: Orb,
  state = "idle",
  text,
  messages,
  interval = 2600,
  size = "md",
  shimmer = "auto",
  orbScale = 1,
  speed,
  colorFrom,
  colorTo,
  levelRef,
  className,
  as: Tag = "div"
}, ref) {
  const message = useOrbMessage(state, { text, messages, interval });
  const shimmering = shimmer === "always" || shimmer === "auto" && isShimmerState(state);
  const orbPx = ORB_PX[size];
  return /* @__PURE__ */ jsxs(
    Tag,
    {
      ref,
      className: [styles.pill, className].filter(Boolean).join(" "),
      "data-size": size,
      "data-state": state,
      children: [
        /* @__PURE__ */ jsx("span", { className: styles.orb, style: { width: orbPx, height: orbPx }, "aria-hidden": "true", children: /* @__PURE__ */ jsx(
          Orb,
          {
            state,
            size: Math.round(orbPx * orbScale),
            speed,
            colorFrom,
            colorTo,
            levelRef,
            label: ""
          }
        ) }),
        /* @__PURE__ */ jsx(OrbPillText, { text: message, shimmer: shimmering }),
        /* @__PURE__ */ jsx("span", { className: styles.srOnly, role: "status", "aria-live": "polite", children: message })
      ]
    }
  );
});
