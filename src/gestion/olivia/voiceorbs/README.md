# VoiceOrbs · Equalizer Orb

Source: https://github.com/amunozdev/voiceorbs/tree/8b2799917734f52c9293a489e08982ca5b0187e9

Copied 2026-10-28 from `src/registry/orbe/equalizer-orb/` and `src/registry/lib/`. The original MIT notice is retained in `LICENSE`.

Adaptations: TypeScript removed for the host JSX/JavaScript stack; the React 19 ref prop became React 18 `forwardRef`; `smoothLevel` was extracted from `use-orb-animator` with the original attack/release rates; offscreen CSS animations pause alongside the level RAF. The component structure, seven bar layers, original CSS and default colors are retained. No microphone hook is imported: Olivia supplies the already-authorized input/output amplitude through `levelRef`.
