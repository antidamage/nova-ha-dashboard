"use client";

import { useRef } from "react";
import type { OrbModule } from "../../../../lib/orb-modules";
import type { useOrbInfo } from "../../orb-info/useOrbInfo";
import { createOrbRenderer } from "../orb-renderer/renderer";
import type { OrbRenderer } from "../orb-renderer/types";
import type { NovaAvatarTheme } from "../theme-model/types";

/** Per-frame inputs the poll and the draw loop read without restarting. */
export function useOrbFrameRefs({
  orbInfo,
  forceGymAlert,
  theme,
  forceVisible,
  conversationActive,
  orbModule,
}: {
  orbInfo: ReturnType<typeof useOrbInfo>;
  forceGymAlert: boolean;
  theme: NovaAvatarTheme;
  forceVisible: boolean;
  conversationActive: boolean;
  orbModule: OrbModule;
}) {
  // Read by the load poll without making the hook a dependency of that effect
  // (which would tear the 2s poll down and rebuild it on every readout change).
  const ingestNovaLoadRef = useRef(orbInfo.ingestNovaLoad);
  ingestNovaLoadRef.current = orbInfo.ingestNovaLoad;
  // Mutable references — avoid re-creating the animation loop on data tick.
  const targetLoadRef = useRef(0);
  const currentLoadRef = useRef(0);
  const gymAlertActiveRef = useRef(forceGymAlert);
  const themeRef = useRef<NovaAvatarTheme>(theme);
  themeRef.current = theme;
  // Read by the draw loop each frame without retriggering the effect.
  const speechEnabledRef = useRef(!forceVisible);
  speechEnabledRef.current = !forceVisible;
  // While a voice conversation is live this device pins the orb's virtual load
  // to 100; the draw loop eases toward it and eases back to the real server
  // load once the conversation ends. Kept in a ref so it's read per-frame
  // without restarting the animation loop.
  const voicePinRef = useRef(false);
  voicePinRef.current = conversationActive;
  // The renderer holds the module's arcField animation state; it is swapped
  // (and the animation restarted) only when the module itself changes. Theme
  // color edits flow through the per-frame palette without touching it.
  const rendererRef = useRef<OrbRenderer | null>(null);
  if (rendererRef.current?.module !== orbModule) {
    rendererRef.current = createOrbRenderer(orbModule);
  }
  return {
    ingestNovaLoadRef,
    targetLoadRef,
    currentLoadRef,
    gymAlertActiveRef,
    themeRef,
    speechEnabledRef,
    voicePinRef,
    rendererRef,
  };
}
