"use client";

// The status orb — facade (specs/agent-token-footprint.md §3.3). The body
// lives in avatar/nova-avatar/:
//
//   types.ts                 props and the /api/nova-load response
//   avatar-model.ts          sizes, timings, speech scale, percent ratio
//   NovaAvatar.tsx           the status-orb feature gate (default export)
//   NovaAvatarVisual.tsx     the orb host: wiring, voice glow, dial, readout
//   OrbGlassStack.tsx        glass disc, canvas and lens filter
//   useOrbGlass.ts           glass settings, filter id, drift/lite gate
//   useOrbInfoDial.ts        orb info module and stack dial
//   useOrbFrameRefs.ts       refs the poll and draw loop read per frame
//   useHydratedThemeReady.ts two-pass hydration guard for the readout colour
//   OrbInfoCounter.tsx       the info readout over the orb
//   useNovaLoadPoll.ts       the 2s load poll
//   useOrbAnimationLoop.ts   the canvas draw loop (sole loop owner)
//   useAvatarScrollScale.ts  scroll shrink and header fade
//   useSpeechMigration.ts    speech fly-to-centre, idle reset, speech-only fade
//
// Rendering is avatar/orb-renderer/, the glass overlay avatar/orb-glass/.

export { default } from "./avatar/nova-avatar/NovaAvatar";
