"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BUILTIN_ORB_MODULE_MAP, resolveOrbModule } from "../../../../lib/orb-modules";
import type { NovaAvatarTheme } from "../../avatarThemeModel";
import { ORB_RADIUS_FRACTION } from "../../avatar/nova-avatar/avatar-model";
import { createOrbRenderer } from "../../avatar/orb-renderer/renderer";
import { OrbDialIndicator } from "../../orb-info/OrbDialIndicator";
import { useOrbDial } from "../../orb-info/useOrbDial";
import { buildOrbPalette } from "../../orbModules";

/**
 * A made-up stack: a running wash first (alex, 2026-11-20: "create a fake
 * washing timer and show it editing that"), then the gym count. Nothing
 * behind either.
 */
const IDS = ["wash", "gym"];
/** The wash starts here and counts down a second at a time, as a real one does. */
const WASH_START_SECONDS = 42 * 60 + 18;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * The status orb copy (specs/tutorial-mode.md): the real orb renderer on a
 * canvas, the real `useOrbDial` gestures and the real `OrbDialIndicator`, on
 * a local stack whose dismiss and toggle do nothing. The theme's built-in orb
 * module is used, so the copy never fetches a host module file. The theme
 * comes from the dashboard chrome that mounts the tour, read-only.
 */
export function SandboxOrb({ size, avatar }: { size: number; avatar: NovaAvatarTheme }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [washLeft, setWashLeft] = useState(WASH_START_SECONDS);
  const [notify, setNotify] = useState(true);
  useEffect(() => {
    const timer = window.setInterval(() => setWashLeft((left) => Math.max(0, left - 1)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  // The real orb's edit for a wash: with the dial open, a tap flips its bell
  // (specs/status-orb-stack.md, "Washing entry"). Here it flips local state.
  const dial = useOrbDial({
    enabled: true,
    ids: IDS,
    hostRef,
    shownAlerting: () => false,
    dismiss: () => undefined,
    shownSwitchable: (id) => id === "wash",
    toggle: () => setNotify((on) => !on),
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const renderer = createOrbRenderer(resolveOrbModule(avatar.orbModule, BUILTIN_ORB_MODULE_MAP));
    const palette = buildOrbPalette(avatar);
    const startedAt = performance.now();
    let frame = 0;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      renderer.render(ctx, {
        centerX: size / 2,
        centerY: size / 2,
        radiusPx: size * ORB_RADIUS_FRACTION,
        palette,
        load: 0.45,
        alertActive: false,
        settings: {},
        nowMs: performance.now() - startedAt,
        dtSec: 1 / 60,
      });
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [avatar, size]);

  const showingWash = (IDS[dial.index] ?? "wash") === "wash";
  return (
    <div
      ref={hostRef}
      className="tutorial-orb-host"
      role="group"
      aria-label="Demo status orb"
      tabIndex={0}
      data-orb-dial={dial.open ? "open" : "closed"}
      data-nova-no-drag-scroll="true"
      style={{ width: size, height: size }}
      {...dial.handlers}
    >
      <OrbDialIndicator count={IDS.length} index={dial.index} open={dial.open} size={size * ORB_RADIUS_FRACTION * 2} />
      <canvas ref={canvasRef} aria-hidden="true" style={{ width: size, height: size, display: "block" }} />
      <span className="tutorial-orb-readout" aria-live="polite">
        {showingWash ? (
          <>
            <span className="tutorial-orb-wash">{clock(washLeft)}</span>
            {notify ? <Bell className="tutorial-orb-bell" aria-label="Finish alert on" /> : <BellOff className="tutorial-orb-bell" aria-label="Finish alert off" />}
          </>
        ) : "23"}
      </span>
    </div>
  );
}
