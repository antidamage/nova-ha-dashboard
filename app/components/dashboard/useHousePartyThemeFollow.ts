"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  mixDeviceThemeColors,
  setHousePartyThemeOverride,
  type DeviceTheme,
  type ThemeVariant,
} from "../accentColor";
import { useThemeLibrary, type ClientThemeLibrary } from "../themeLibrary";

const HOUSE_PARTY_THEME_ENDPOINT = "/api/phonoscope/house-party/theme";
const HOUSE_PARTY_THEME_POLL_MS = 500;
const HOUSE_PARTY_RETURN_MS = 600;

export type RuntimeThemeState = {
  active: boolean;
  followVisualizerWhenActive: boolean;
  theme: {
    themeId: string;
    variant: ThemeVariant;
    transitionSeconds: number;
    updatedAt: string;
  } | null;
};

const INACTIVE: RuntimeThemeState = {
  active: false,
  followVisualizerWhenActive: false,
  theme: null,
};

function runtimeKey(value: RuntimeThemeState) {
  return [
    value.active ? "active" : "inactive",
    value.followVisualizerWhenActive ? "follow" : "fixed",
    value.theme?.themeId ?? "",
    value.theme?.variant ?? "",
    value.theme?.transitionSeconds ?? 0,
  ].join(":");
}

export function resolveHousePartyTargetTheme(
  runtime: RuntimeThemeState,
  library: ClientThemeLibrary,
): DeviceTheme | null {
  if (!runtime.active || !runtime.followVisualizerWhenActive || !runtime.theme) return null;
  const entry = library.entries.find((candidate) => candidate.id === runtime.theme?.themeId);
  return entry?.themeSet.themes[runtime.theme.variant] ?? null;
}

export function useHousePartyThemeFollow(configuredTheme: DeviceTheme) {
  const { library } = useThemeLibrary();
  const [runtime, setRuntime] = useState<RuntimeThemeState>(INACTIVE);
  const currentOverrideRef = useRef<DeviceTheme | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const transitionTo = useCallback((target: DeviceTheme | null, durationMs: number) => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    const from = currentOverrideRef.current ?? configuredTheme;
    const destination = target
      ? mixDeviceThemeColors(configuredTheme, target, 1)
      : configuredTheme;
    const started = performance.now();
    const duration = Math.max(0, durationMs);

    const step = (now: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - started) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      const next = mixDeviceThemeColors(from, destination, eased);
      currentOverrideRef.current = next;
      setHousePartyThemeOverride(next);
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(step);
      } else {
        animationFrameRef.current = null;
        currentOverrideRef.current = target ? destination : null;
        setHousePartyThemeOverride(target ? destination : null);
      }
    };

    animationFrameRef.current = requestAnimationFrame(step);
  }, [configuredTheme]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(HOUSE_PARTY_THEME_ENDPOINT, { cache: "no-store" });
        if (!response.ok) throw new Error(`House Party theme request failed: ${response.status}`);
        const next = await response.json() as RuntimeThemeState;
        if (!cancelled) {
          setRuntime((current) => runtimeKey(current) === runtimeKey(next) ? current : next);
        }
      } catch {
        // Keep the last lease state through brief LAN/server interruptions. The
        // server's own lease expiry will produce an inactive state once reachable.
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), HOUSE_PARTY_THEME_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const target = resolveHousePartyTargetTheme(runtime, library);
    if (runtime.active && runtime.followVisualizerWhenActive && runtime.theme && !target) {
      return;
    }
    transitionTo(
      target,
      target ? Math.max(0, runtime.theme?.transitionSeconds ?? 0) * 1_000 : HOUSE_PARTY_RETURN_MS,
    );
  }, [library, runtime, transitionTo]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    currentOverrideRef.current = null;
    setHousePartyThemeOverride(null);
  }, []);
}
