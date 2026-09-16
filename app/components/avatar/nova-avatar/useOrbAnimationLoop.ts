"use client";

// Sole owner of the status orb's canvas animation loop.

import { type RefObject, useEffect } from "react";
import { resolveOrbModuleSettings } from "../../../../lib/orb-modules";
import { arePageUpdatesPaused } from "../../dashboard/pageUpdatePause";
import { sampleVoiceSpeechEnvelope } from "../../dashboard/voiceSpeech";
import { buildOrbPalette } from "../../orbModules";
import type { OrbRenderer } from "../orb-renderer/types";
import { alertPulseScale } from "../theme-model/theme-model";
import type { NovaAvatarTheme } from "../theme-model/types";
import { LOAD_EASE, ORB_RADIUS_FRACTION } from "./avatar-model";

export function useOrbAnimationLoop({
  canvasRef,
  size,
  hidden,
  orbOptedOut,
  resolutionBoost,
  speechActive,
  voicePinRef,
  targetLoadRef,
  currentLoadRef,
  rendererRef,
  gymAlertActiveRef,
  themeRef,
  speechEnabledRef,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  size: number;
  hidden: boolean;
  orbOptedOut: boolean;
  resolutionBoost: number;
  speechActive: boolean;
  voicePinRef: RefObject<boolean>;
  targetLoadRef: RefObject<number>;
  currentLoadRef: RefObject<number>;
  rendererRef: RefObject<OrbRenderer | null>;
  gymAlertActiveRef: RefObject<boolean>;
  themeRef: RefObject<NovaAvatarTheme>;
  speechEnabledRef: RefObject<boolean>;
}) {
  useEffect(() => {
    if (hidden || orbOptedOut) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1) * resolutionBoost;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    let raf = 0;
    let lastTs = performance.now();

    const draw = (now: number) => {
      if (arePageUpdatesPaused() && !speechActive) {
        lastTs = now;
        raf = requestAnimationFrame(draw);
        return;
      }
      const dt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;

      // ease load toward target — a live voice conversation pins it to 100,
      // otherwise it tracks the server-reported load.
      const tgt = voicePinRef.current ? 1 : targetLoadRef.current;
      currentLoadRef.current += (tgt - currentLoadRef.current) * Math.min(1, dt * LOAD_EASE);

      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, size, size);

      // Render the active module. The palette and module settings are rebuilt
      // from the live theme every frame so config edits appear on the very
      // next frame.
      const renderer = rendererRef.current;
      if (renderer) {
        // Voice speech drives the alert machinery directly: the consonant
        // envelope replaces the gym-alert oscillation for as long as a
        // speech session is live (sampleVoiceSpeechEnvelope returns null
        // otherwise, restoring normal gym-alert behaviour).
        let alertActive = gymAlertActiveRef.current;
        let alertPulseOverride: number | undefined;
        // The theme's alert-rate slider stretches the module's period, and
        // speech beats to the same stretched cadence.
        const pulseScale = alertPulseScale(themeRef.current.alertPulseRate);
        if (speechEnabledRef.current) {
          const envelope = sampleVoiceSpeechEnvelope(now, renderer.module.alertPulsePeriod * pulseScale);
          if (envelope !== null) {
            alertActive = true;
            alertPulseOverride = envelope;
          }
        }
        renderer.render(ctx, {
          centerX: size / 2,
          centerY: size / 2,
          radiusPx: size * ORB_RADIUS_FRACTION,
          palette: buildOrbPalette(themeRef.current),
          load: currentLoadRef.current,
          alertActive,
          alertPulseOverride,
          alertPulseScale: pulseScale,
          nowMs: now,
          dtSec: dt,
          settings: resolveOrbModuleSettings(
            renderer.module,
            themeRef.current.orbModuleSettings[renderer.module.id],
          ),
        });
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, hidden, orbOptedOut, resolutionBoost]);
}
