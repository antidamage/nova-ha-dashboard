"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useNovaAvatarTheme, resolveColor, type NovaAvatarTheme } from "./novaAvatarTheme";

type LoadResponse = {
  cpu: number;
  net: number;
  gpu: number;
  listening: boolean;
  load: number;
};

const SIZE = 128;
let BACKGROUND_RADIUS = SIZE * 0.46;

const GLOSS_THICKNESS = 10;
const GLOSS_OPACITY = 0.15;

// Per-reflection opacity knobs.
//   - `vignette` is the absolute alpha used for the dark bottom shade.
//   - everything else is a multiplier applied to GLOSS_OPACITY for the
//     bright (white) reflections, so dialing GLOSS_OPACITY scales them
//     all together while these per-knobs preserve their relative balance.
const REFLECTION = {
  vignette: 1.45,
  capPeak: 4.5,
  capMid: 1.6,
  streakPeak: 5.0,
  streakMid: 3.5,
  kissPeak: 5.0,
  kissMid: 1.5,
  refract: 1.4,
  // Lower-edge rim reflections (curling up from the bottom-left and
  // bottom-right). Roughly half the upper streak per the brief.
  lowerRimPeak: 2.5,
  lowerRimMid: 1.75,
} as const;

const SEGMENT_COUNT = 50;
const RADIUS_MIN = 0.1;
const RADIUS_MAX = 0.95;
const LINE_WIDTH_MIN = 0.005; // fraction of avatar size
const LINE_WIDTH_MAX = 0.04;

const POLL_MS = 100;
const IDLE_MIN = 0.001; // fraction of circle per segment; smaller = more gaps when idle
const IDLE_MAX = 0.00025;
const FULL_SIZE = 1.0;
const SIZE_EASE = 1.0; // larger = snappier; the per-frame factor is min(1, dt*EASE)
const LOAD_EASE = 1.0; // ease toward server-reported load
const VEL_EASE = 1.0; // ease for angular velocity changes (so direction flips glide)
const RESAMPLE_INTERVAL_MIN = 0.8;
const RESAMPLE_INTERVAL_JITTER = 0.6;

type Seg = {
  colorIndex: 0 | 1 | 2; // resolved at draw time from the live theme
  baseRadius: number;
  lineWidthFrac: number;
  angle: number;
  angularVel: number;
  targAngularVel: number;
  curSize: number;
  targSize: number;
  nextResampleAt: number;
};

function mixRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export default function NovaAvatar({
  size = SIZE,
  forceVisible = false,
  className,
}: {
  size?: number;
  forceVisible?: boolean;
  className?: string;
}) {
  BACKGROUND_RADIUS = size * 0.48;
  const pathname = usePathname();
  const hidden = forceVisible ? false : (pathname?.startsWith("/config") ?? false);

  const { theme } = useNovaAvatarTheme();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Mutable references — avoid re-creating the animation loop on data tick.
  const targetLoadRef = useRef(0);
  const currentLoadRef = useRef(0);
  const themeRef = useRef<NovaAvatarTheme>(theme);
  themeRef.current = theme;

  useEffect(() => {
    if (hidden) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/nova-load", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as LoadResponse;
        if (!alive) return;
        const load = Math.max(0, Math.min(1, Number(data.load) || 0));
        targetLoadRef.current = load;
      } catch {
        // ignore — keep previous target
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [hidden]);

  useEffect(() => {
    if (hidden) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const segs: Seg[] = Array.from({ length: SEGMENT_COUNT }, (_, i) => {
      // Distribute base radii across the band but jitter so neighbours overlap
      // rather than sit on perfectly clean rings.
      const t = SEGMENT_COUNT > 1 ? i / (SEGMENT_COUNT - 1) : 0;
      const ringJitter = (Math.random() - 0.5) * 0.08;
      const baseRadius = Math.max(
        RADIUS_MIN,
        Math.min(RADIUS_MAX, RADIUS_MIN + t * (RADIUS_MAX - RADIUS_MIN) + ringJitter),
      );
      const initVel = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.45);
      return {
        colorIndex: (i % 3) as 0 | 1 | 2,
        baseRadius,
        lineWidthFrac: LINE_WIDTH_MIN + Math.random() * (LINE_WIDTH_MAX - LINE_WIDTH_MIN),
        angle: Math.random() * Math.PI * 2,
        angularVel: initVel,
        targAngularVel: initVel,
        curSize: IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN),
        targSize: IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN),
        nextResampleAt: 0,
      };
    });

    let raf = 0;
    let lastTs = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;

      // ease load toward target
      const tgt = targetLoadRef.current;
      currentLoadRef.current += (tgt - currentLoadRef.current) * Math.min(1, dt * LOAD_EASE);
      const load = currentLoadRef.current;

      const cx = size / 2;
      const cy = size / 2;

      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, size, size);

      // background — radial gradient from user-set center to user-set outer
      const center = resolveColor(themeRef.current.gradientCenter);
      const outer = resolveColor(themeRef.current.gradientOuter);
      const mid = mixRgb(center, outer, 0.55);
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, BACKGROUND_RADIUS);
      bgGrad.addColorStop(0, `rgb(${center[0]}, ${center[1]}, ${center[2]})`);
      bgGrad.addColorStop(0.55, `rgb(${mid[0]}, ${mid[1]}, ${mid[2]})`);
      bgGrad.addColorStop(1, `rgb(${outer[0]}, ${outer[1]}, ${outer[2]})`);
      ctx.beginPath();
      ctx.arc(cx, cy, BACKGROUND_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = bgGrad;
      ctx.fill();

      // additive arcs with glow
      ctx.globalCompositeOperation = "lighter";
      const tSec = now / 1000;
      for (const s of segs) {
        if (tSec >= s.nextResampleAt) {
          const idleSize = IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
          // when idle: 15-30%; full load: 75%; smoothly interpolate
          s.targSize = idleSize + (FULL_SIZE - idleSize) * load;
          // pick a new target angular velocity; current eases toward it.
          const speed = 0.35 + load * 1.6 + Math.random() * 0.4;
          s.targAngularVel = (Math.random() < 0.5 ? -1 : 1) * speed;
          s.nextResampleAt = tSec + RESAMPLE_INTERVAL_MIN + Math.random() * RESAMPLE_INTERVAL_JITTER;
        }

        s.curSize += (s.targSize - s.curSize) * Math.min(1, dt * SIZE_EASE);
        s.angularVel += (s.targAngularVel - s.angularVel) * Math.min(1, dt * VEL_EASE);
        s.angle += s.angularVel * dt;

        const r = BACKGROUND_RADIUS * s.baseRadius;
        const startA = s.angle;
        const endA = startA + Math.PI * 2 * s.curSize;
        const rgb = resolveColor(themeRef.current.lineColors[s.colorIndex]);
        const colorRgba = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 1.0)`;
        const colorRgb = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

        ctx.beginPath();
        ctx.arc(cx, cy, r, startA, endA);
        ctx.lineWidth = size * s.lineWidthFrac;
        ctx.lineCap = "round";
        ctx.strokeStyle = colorRgba;
        ctx.shadowBlur = size * 0.25;
        ctx.shadowColor = colorRgb;
        ctx.stroke();
        ctx.shadowBlur = 0.25;
      }

      // bevel: semi-transparent rings so background shows through
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.arc(cx, cy, BACKGROUND_RADIUS + 0.5, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.shadowBlur = size * 0.25;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.stroke();
      // subtle shadow on the bottom right
      ctx.beginPath();
      ctx.lineWidth = 3;
      ctx.arc(cx, cy, BACKGROUND_RADIUS - ctx.lineWidth, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
      ctx.shadowBlur = size * 0.25;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.stroke();

      // -----------------------------------------------------------
      // HAL-style glass-orb gloss (monotone white, additive layers)
      // Everything below is clipped to the orb's interior so nothing
      // spills past the bevel and the highlights look refractive.
      // -----------------------------------------------------------
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, BACKGROUND_RADIUS, 0, Math.PI * 2);
      ctx.clip();
      ctx.shadowBlur = 0;

      const glossAlpha = GLOSS_OPACITY;

      // 1. Bottom inner vignette — dark gradient hugging the lower rim,
      //    sells the curvature before the highlights brighten the top.
      const bottomShade = ctx.createRadialGradient(
        cx,
        cy + BACKGROUND_RADIUS * 0.55,
        BACKGROUND_RADIUS * 0.15,
        cx,
        cy + BACKGROUND_RADIUS * 0.25,
        BACKGROUND_RADIUS * 1.05,
      );
      bottomShade.addColorStop(0, "rgba(0, 0, 0, 0)");
      bottomShade.addColorStop(0.7, "rgba(0, 0, 0, 0)");
      bottomShade.addColorStop(1, `rgba(0, 0, 0, ${REFLECTION.vignette})`);
      ctx.fillStyle = bottomShade;
      ctx.beginPath();
      ctx.arc(cx, cy, BACKGROUND_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      // 2. Primary cap highlight — broad soft ellipse in the upper third,
      //    bright in the middle and falling off to transparent. This is
      //    the "you're looking at glass" cue.
      const capCx = cx - size * 0.04;
      const capCy = cy - BACKGROUND_RADIUS * 0.42;
      const capRx = BACKGROUND_RADIUS * 0.66;
      const capRy = BACKGROUND_RADIUS * 0.34;
      const capGrad = ctx.createRadialGradient(
        capCx,
        capCy + capRy * 0.3,
        0,
        capCx,
        capCy,
        Math.max(capRx, capRy) * 1.05,
      );
      capGrad.addColorStop(0, `rgba(255, 255, 255, ${glossAlpha * REFLECTION.capPeak})`);
      capGrad.addColorStop(0.45, `rgba(255, 255, 255, ${glossAlpha * REFLECTION.capMid})`);
      capGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = capGrad;
      ctx.beginPath();
      ctx.ellipse(capCx, capCy, capRx, capRy, -Math.PI * 0.06, 0, Math.PI * 2);
      ctx.fill();

      // 3. Rim streak — bright thin arc on the upper-left rim. The
      //    gradient along its length makes it taper instead of
      //    reading as a flat ring.
      const streakStart = Math.PI * 1.08;
      const streakEnd = Math.PI * 1.6;
      const streakGrad = ctx.createLinearGradient(
        cx + Math.cos(streakStart) * BACKGROUND_RADIUS,
        cy + Math.sin(streakStart) * BACKGROUND_RADIUS,
        cx + Math.cos(streakEnd) * BACKGROUND_RADIUS,
        cy + Math.sin(streakEnd) * BACKGROUND_RADIUS,
      );
      streakGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
      streakGrad.addColorStop(0.4, `rgba(255, 255, 255, ${glossAlpha * REFLECTION.streakPeak})`);
      streakGrad.addColorStop(0.65, `rgba(255, 255, 255, ${glossAlpha * REFLECTION.streakMid})`);
      streakGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.strokeStyle = streakGrad;
      ctx.lineWidth = GLOSS_THICKNESS * 0.65;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy, BACKGROUND_RADIUS - GLOSS_THICKNESS * 0.85, streakStart, streakEnd);
      ctx.stroke();

      // 4. Secondary "kiss" highlight on the upper-right — small bright
      //    spot from a second light source.
      const kissCx = cx + BACKGROUND_RADIUS * 0.5;
      const kissCy = cy - BACKGROUND_RADIUS * 0.38;
      const kissR = BACKGROUND_RADIUS * 0.16;
      const kissGrad = ctx.createRadialGradient(kissCx, kissCy, 0, kissCx, kissCy, kissR);
      kissGrad.addColorStop(0, `rgba(255, 255, 255, ${glossAlpha * REFLECTION.kissPeak})`);
      kissGrad.addColorStop(0.5, `rgba(255, 255, 255, ${glossAlpha * REFLECTION.kissMid})`);
      kissGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = kissGrad;
      ctx.beginPath();
      ctx.arc(kissCx, kissCy, kissR, 0, Math.PI * 2);
      ctx.fill();

      // 5. Faint refraction band low and right — adds to the wet look.
      const refractGrad = ctx.createLinearGradient(
        cx + BACKGROUND_RADIUS * 0.55,
        cy + BACKGROUND_RADIUS * 0.05,
        cx + BACKGROUND_RADIUS * 0.2,
        cy + BACKGROUND_RADIUS * 0.55,
      );
      refractGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
      refractGrad.addColorStop(0.5, `rgba(255, 255, 255, ${glossAlpha * REFLECTION.refract})`);
      refractGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.strokeStyle = refractGrad;
      ctx.lineWidth = GLOSS_THICKNESS * 0.4;
      ctx.beginPath();
      ctx.arc(cx, cy, BACKGROUND_RADIUS - GLOSS_THICKNESS * 0.5, Math.PI * 0.08, Math.PI * 0.42);
      ctx.stroke();

      // 6. Lower-edge rim reflections — bright glow curling in from the
      //    bottom-right and bottom-left edges, fading toward the bottom
      //    midpoint. Half-strength of the upper rim streak.
      const lowerRimRadius = BACKGROUND_RADIUS - GLOSS_THICKNESS * 0.85;
      const lowerRimWidth = GLOSS_THICKNESS * 0.55;

      // bottom-right arc: bright at right edge, fading toward bottom-center
      const brStart = Math.PI * 0.05;
      const brEnd = Math.PI * 0.46;
      const brGrad = ctx.createLinearGradient(
        cx + Math.cos(brStart) * BACKGROUND_RADIUS,
        cy + Math.sin(brStart) * BACKGROUND_RADIUS,
        cx + Math.cos(brEnd) * BACKGROUND_RADIUS,
        cy + Math.sin(brEnd) * BACKGROUND_RADIUS,
      );
      brGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
      brGrad.addColorStop(0.35, `rgba(255, 255, 255, ${glossAlpha * REFLECTION.lowerRimPeak})`);
      brGrad.addColorStop(0.6, `rgba(255, 255, 255, ${glossAlpha * REFLECTION.lowerRimMid})`);
      brGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.strokeStyle = brGrad;
      ctx.lineWidth = lowerRimWidth;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy, lowerRimRadius, brStart, brEnd);
      ctx.stroke();

      // bottom-left arc: bright at left edge, fading toward bottom-center.
      // Gradient is laid out from the LEFT endpoint inward so the bright
      // peak lands on the outer side of the curve.
      const blStart = Math.PI * 0.54;
      const blEnd = Math.PI * 0.95;
      const blGrad = ctx.createLinearGradient(
        cx + Math.cos(blEnd) * BACKGROUND_RADIUS,
        cy + Math.sin(blEnd) * BACKGROUND_RADIUS,
        cx + Math.cos(blStart) * BACKGROUND_RADIUS,
        cy + Math.sin(blStart) * BACKGROUND_RADIUS,
      );
      blGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
      blGrad.addColorStop(0.35, `rgba(255, 255, 255, ${glossAlpha * REFLECTION.lowerRimPeak})`);
      blGrad.addColorStop(0.6, `rgba(255, 255, 255, ${glossAlpha * REFLECTION.lowerRimMid})`);
      blGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.strokeStyle = blGrad;
      ctx.lineWidth = lowerRimWidth;
      ctx.beginPath();
      ctx.arc(cx, cy, lowerRimRadius, blStart, blEnd);
      ctx.stroke();

      ctx.restore();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, hidden]);

  if (hidden) return null;

  const hostClass = className ?? "nova-avatar-host";

  return (
    <div
      className={hostClass}
      aria-label="Nova"
      role="img"
      style={className ? { width: size, height: size } : undefined}
    >
      <canvas
        ref={canvasRef}
        className="nova-avatar-canvas"
        style={{ width: size, height: size }}
      />
    </div>
  );
}
