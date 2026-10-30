// Adapted from amunozdev/voiceorbs (MIT). See LICENSE.
const ORB_STATES = [
  "idle",
  "connecting",
  "listening",
  "thinking",
  "speaking"
];
const ERROR_COLOR_FROM = "#fb7185";
const ERROR_COLOR_TO = "#f43f5e";
const hexToRgb = (hex) => {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = Number.parseInt(full, 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
};
const stateMotion = (state) => {
  switch (state) {
    case "listening":
      return "ripple";
    case "thinking":
      return "pulse";
    case "speaking":
      return "flow";
    default:
      return "none";
  }
};
const wave = (x) => 0.5 - 0.5 * Math.cos(x);
const stateEnergy = (state, t) => {
  switch (state) {
    case "listening":
      return 0.4 + 0.32 * wave(t * 17) + 0.18 * wave(t * 8.2 + 3);
    case "speaking":
      return 0.3 + 0.24 * wave(t * 12.4) + 0.16 * wave(t * 6 + 1.2);
    case "thinking":
      return 0.24 + 0.2 * wave(t * 4.8);
    case "connecting":
      return 0.12 + 0.1 * wave(t * 3.2);
    case "error":
      return 0.2;
    default:
      return 0;
  }
};
const approach = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const ENTER_RATE = 14;
const SETTLE_RATE = 5;
const ERROR_RATE = 10;
const stateRate = (state) => {
  if (state === "idle" || state === "disabled") return SETTLE_RATE;
  if (state === "error") return ERROR_RATE;
  return ENTER_RATE;
};
const createStateMix = (initial = "idle") => {
  const weights = {
    idle: 0,
    connecting: 0,
    listening: 0,
    thinking: 0,
    speaking: 0,
    error: 0,
    disabled: 0
  };
  weights[initial] = 1;
  const keys = Object.keys(weights);
  const update = (state, dt, rate = stateRate(state)) => {
    let total = 0;
    for (const key of keys) {
      const target = key === state ? 1 : 0;
      const next = approach(weights[key], target, rate, dt);
      weights[key] = target === 0 && next < 1e-3 ? 0 : next;
      total += weights[key];
    }
    if (total > 0) {
      for (const key of keys) weights[key] /= total;
    }
    return weights;
  };
  return { weights, update };
};
const blendStates = (weights, table) => {
  const out = {};
  for (const key of Object.keys(weights)) {
    const w = weights[key];
    if (w === 0) continue;
    const row = table[key];
    for (const param of Object.keys(row)) out[param] = (out[param] ?? 0) + row[param] * w;
  }
  return out;
};
const blendEnergy = (weights, t) => {
  let energy = 0;
  for (const key of Object.keys(weights)) {
    if (weights[key] > 0) energy += weights[key] * stateEnergy(key, t);
  }
  return energy;
};
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const orbVars = ({
  size,
  speed,
  colorFrom,
  colorTo
}) => {
  const vars = {};
  if (size != null) vars["--orb-size"] = `${size}px`;
  if (speed != null) vars["--orb-speed"] = `${speed}`;
  if (colorFrom) vars["--orb-color-from"] = colorFrom;
  if (colorTo) vars["--orb-color-to"] = colorTo;
  return vars;
};
export {
  ENTER_RATE,
  ERROR_COLOR_FROM,
  ERROR_COLOR_TO,
  ERROR_RATE,
  ORB_STATES,
  SETTLE_RATE,
  approach,
  blendEnergy,
  blendStates,
  clamp01,
  createStateMix,
  hexToRgb,
  orbVars,
  stateEnergy,
  stateMotion,
  stateRate
};
