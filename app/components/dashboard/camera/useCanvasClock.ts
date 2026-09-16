"use client";

import { useEffect } from "react";
import { arePageUpdatesPaused } from "../pageUpdatePause";
import { formatClock } from "./format-model";

/**
 * Draws a live "time counting up" clock onto the canvas. Used as the placeholder
 * feed in the static demo build (no server / ffmpeg) and while a real HLS stream
 * is warming up or unavailable, so the panel always shows something live.
 */
export function useCanvasClock(canvasRef: React.RefObject<HTMLCanvasElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }

    let raf = 0;
    const render = () => {
      if (arePageUpdatesPaused()) {
        raf = requestAnimationFrame(render);
        return;
      }
      const width = (canvas.width = canvas.clientWidth || 640);
      const height = (canvas.height = canvas.clientHeight || 360);
      const now = new Date();

      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, width, height);

      // Faint scanline texture to read as a CCTV feed.
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      for (let y = 0; y < height; y += 4) {
        ctx.fillRect(0, y, width, 1);
      }

      ctx.fillStyle = "rgba(120,255,210,0.9)";
      ctx.font = `${Math.round(height * 0.16)}px var(--cyber-mono, monospace)`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(formatClock(now), width / 2, height / 2 - height * 0.04);

      ctx.fillStyle = "rgba(180,200,210,0.6)";
      ctx.font = `${Math.round(height * 0.05)}px var(--cyber-mono, monospace)`;
      ctx.fillText(now.toLocaleDateString(), width / 2, height / 2 + height * 0.12);

      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,80,80,0.95)";
      ctx.font = `${Math.round(height * 0.045)}px var(--cyber-mono, monospace)`;
      ctx.fillText("● REC", 18, 28);

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [active, canvasRef]);
}
