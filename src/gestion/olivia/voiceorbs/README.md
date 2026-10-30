# VoiceOrbs · Equalizer Orb

Source: https://github.com/amunozdev/voiceorbs/tree/8b2799917734f52c9293a489e08982ca5b0187e9

Copied 2026-10-28 from `src/registry/orbe/equalizer-orb/` and `src/registry/lib/`. The original MIT notice is retained in `LICENSE`.

Adaptations: TypeScript removed for the host JSX/JavaScript stack; the React 19 ref prop became React 18 `forwardRef`; `smoothLevel` was extracted from `use-orb-animator` with the original attack/release rates; offscreen CSS animations pause alongside the level RAF. The component structure, seven bar layers, original CSS and default colors are retained. Olivia does not pass `levelRef`: `stateEnergy`, `blendEnergy` and `useOrbLevel` generate the movement. Listening uses a seven-bar ripple, speaking a faster flow, thinking a slow wave and connecting a regular pulse. The output analyser was removed; microphone analysis is used only for voice activity detection.

OrbPill and its CSS were copied from `src/registry/lib/orb-pill.tsx` and `orb-pill.module.css` at the same revision on 2026-10-29. Its React 18 ref uses `forwardRef`; an `as` prop allows a semantic span inside the floating open button. Text measurement, crossfades, shimmer, reduced motion and accessible status announcements are retained.
