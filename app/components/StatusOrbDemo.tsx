"use client";

/**
 * A live tech-skin status orb with nothing behind it, for the demo pages
 * (specs/status-orb-stack.md).
 *
 * The face is the real orb module renderer drawing `tech`, and the indicator is
 * the real `OrbDialIndicator`, so the embossed unlock ring inside the status
 * channel lights exactly as it does on the dashboard orb. A tap opens the
 * stack — the indicator, and the ring with it, is only on show while it is open
 * (`.orb-dial-indicator[data-locked="true"]` is transparent).
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BUILTIN_ORB_MODULE_MAP, resolveOrbModule } from "../../lib/orb-modules";
import type { NovaAvatarTheme } from "./avatarThemeModel";
import { ORB_RADIUS_FRACTION } from "./avatar/nova-avatar/avatar-model";
import { createOrbRenderer } from "./avatar/orb-renderer/renderer";
import { OrbDialIndicator } from "./orb-info/OrbDialIndicator";
import { buildOrbPalette } from "./orbModules";

/** Entries in the demo stack: the index mark's positions round the ring. */
const DIAL_COUNT = 3;

export function StatusOrbDemo({
  id,
  light = false,
  size = 168,
  startOpen = false,
  theme,
  caption,
}: {
  id: string;
  /** The tech skin's own light/dark setting. */
  light?: boolean;
  size?: number;
  startOpen?: boolean;
  theme: NovaAvatarTheme;
  caption?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [open, setOpen] = useState(startOpen);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    // Setting the bitmap size also resets the context, so a theme edit never
    // accumulates a transform.
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const renderer = createOrbRenderer(resolveOrbModule("tech", BUILTIN_ORB_MODULE_MAP));
    const palette = buildOrbPalette(theme);
    const startedAt = performance.now();
    let frame = 0;
    const draw = () => {
      const nowMs = performance.now() - startedAt;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      renderer.render(ctx, {
        centerX: size / 2,
        centerY: size / 2,
        radiusPx: size * ORB_RADIUS_FRACTION,
        palette,
        load: 0.55,
        alertActive: false,
        settings: { light: light ? 1 : 0 },
        nowMs,
        dtSec: 1 / 60,
      });
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [light, size, theme]);

  return (
    <figure style={styles.figure} data-demo-orb={id}>
      <div
        className="status-orb-demo"
        role="button"
        tabIndex={0}
        aria-pressed={open}
        aria-label={`Demo status orb, stack ${open ? "open" : "closed"}`}
        data-orb-dial={open ? "open" : "closed"}
        style={{ ...styles.orb, width: size, height: size }}
        onClick={() => setOpen((held) => !held)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setOpen((held) => !held);
        }}
      >
        <canvas ref={canvasRef} style={{ width: size, height: size, display: "block" }} aria-hidden />
        <OrbDialIndicator
          count={DIAL_COUNT}
          index={0}
          open={open}
          /* The orb face is smaller than the canvas: the ring belongs on the
             rim, not the canvas edge. */
          size={size * ORB_RADIUS_FRACTION * 2}
        />
      </div>
      <figcaption style={styles.caption} data-demo-readout>
        {caption ?? (light ? "tech, light" : "tech, dark")}
      </figcaption>
    </figure>
  );
}

const styles: Record<string, CSSProperties> = {
  figure: {
    margin: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  orb: {
    position: "relative",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  },
  caption: {
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    opacity: 0.6,
  },
};
