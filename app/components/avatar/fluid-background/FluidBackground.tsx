"use client";

// Sole owner of the fluid background's WebGL context and animation loop.
// Lifecycle rules (specs/wallpaper-background-mode.md "WebGL lifecycle"):
// the loop stops entirely while the page is hidden, the context is explicitly
// released on unmount, and a lost context is rebuilt up to a fixed limit.

import { useCallback, useEffect, useRef, useState } from "react";
import { appliedThemeRgb, type DeviceTheme } from "../../accentColor";
import { arePageUpdatesPaused } from "../../dashboard/pageUpdatePause";
import {
  DEFAULT_MAX_BACKING_PIXELS,
  DEFAULT_SCALE_CAP,
  colorVector,
  createMosaicTexture,
  createProgram,
  resizeCanvas,
} from "./gl-program";
import { TARGET_DPR } from "./shaders";
import { reportDiagnosticsOnce } from "./diagnostics";
import type { FluidBackgroundDebug, ProgramInfo } from "./types";

// A GPU that has dropped the context this many times is sick; retrying past
// that turns a soft fault into a hard one. Give up and show the flat colour.
export const MAX_CONTEXT_RECOVERIES = 3;

export function FluidBackground({ theme, debug }: { theme: DeviceTheme; debug?: FluidBackgroundDebug }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  // Captured once at mount — the standalone test page changes these via a full
  // reload, so they never need to react to prop changes mid-session.
  const debugRef = useRef(debug);
  // Bumped by webglcontextrestored to re-run the effect and rebuild the GL
  // resources from scratch. Also the recovery counter.
  const [recoveries, setRecoveries] = useState(0);
  const [surrendered, setSurrendered] = useState(false);

  const onContextLost = useCallback((event: Event) => {
    // Without preventDefault the browser never fires webglcontextrestored.
    event.preventDefault();
    setRecoveries((previous) => {
      const next = previous + 1;
      if (next > MAX_CONTEXT_RECOVERIES) {
        console.error("[nova-dashboard] fluid background gave up after repeated WebGL context loss");
        setSurrendered(true);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || surrendered) {
      return;
    }
    const activeCanvas = canvas;

    const requestedPrecision = debugRef.current?.precision ?? "auto";
    const scaleCap = debugRef.current?.scaleCap ?? DEFAULT_SCALE_CAP;
    const maxBackingPixels = debugRef.current?.maxBackingPixels ?? DEFAULT_MAX_BACKING_PIXELS;

    let info: ProgramInfo | null = null;
    try {
      info = createProgram(activeCanvas, requestedPrecision);
    } catch (error) {
      console.error("[nova-dashboard] failed to initialize fluid background", error);
      return;
    }
    if (!info) {
      return;
    }

    const { attribute, buffer, gl, program, uniforms } = info;

    const reportDiagnostics = reportDiagnosticsOnce({
      activeCanvas,
      debugRef,
      gl,
      maxBackingPixels,
      requestedPrecision,
      scaleCap,
    });
    let animationFrame = 0;
    let previousFrame = 0;
    let disposed = false;
    let mosaicTexture: WebGLTexture | null = null;
    let mosaicTextureGeneration = 0;
    let mosaicTextureReady = false;
    let mosaicTextureUrl: string | null = null;
    const startedAt = performance.now();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const clearMosaicTexture = () => {
      if (mosaicTexture) {
        gl.deleteTexture(mosaicTexture);
      }
      mosaicTexture = null;
      mosaicTextureReady = false;
    };

    const loadMosaicTexture = (url: string | null) => {
      if (url === mosaicTextureUrl) {
        return;
      }

      mosaicTextureGeneration += 1;
      mosaicTextureUrl = url;
      clearMosaicTexture();

      if (!url) {
        return;
      }

      const generation = mosaicTextureGeneration;
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        if (disposed || generation !== mosaicTextureGeneration) {
          return;
        }

        const nextTexture = createMosaicTexture(gl, image);
        if (!nextTexture) {
          return;
        }

        clearMosaicTexture();
        mosaicTexture = nextTexture;
        mosaicTextureReady = true;
        schedule();
      };
      image.onerror = () => {
        if (disposed || generation !== mosaicTextureGeneration) {
          return;
        }
        mosaicTextureReady = false;
        console.info("[nova-dashboard] background texture unavailable", url);
        schedule();
      };
      image.src = url;
    };

    // The page being hidden is the one state where the loop stops outright
    // rather than idling: a hidden surface must cost zero GPU draw work.
    const isHidden = () => typeof document !== "undefined" && document.hidden;

    function schedule() {
      if (disposed || animationFrame || isHidden()) {
        return;
      }
      animationFrame = requestAnimationFrame(draw);
    }

    function draw(now: number) {
      animationFrame = 0;
      if (arePageUpdatesPaused()) {
        schedule();
        return;
      }
      const shouldDraw = reducedMotion || now - previousFrame >= 1000 / 30;
      if (shouldDraw) {
        previousFrame = now;
        resizeCanvas(activeCanvas, gl, scaleCap, maxBackingPixels);
        reportDiagnostics();

        const current = themeRef.current;
        const background = colorVector(appliedThemeRgb(current.background));
        const accent = colorVector(appliedThemeRgb(current.accent));
        const highlight = colorVector(appliedThemeRgb(current.highlight));
        const effect = current.backgroundEffect;
        loadMosaicTexture(effect.textureUrl);

        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, mosaicTextureReady ? mosaicTexture : null);
        gl.uniform1i(uniforms.mosaicTexture, 0);
        gl.uniform1f(uniforms.hasMosaicTexture, mosaicTextureReady ? 1 : 0);
        gl.uniform1f(uniforms.time, (now - startedAt) / 1000);
        gl.uniform2f(uniforms.resolution, activeCanvas.width, activeCanvas.height);
        gl.uniform3fv(uniforms.background, background);
        gl.uniform3fv(uniforms.accent, accent);
        gl.uniform3fv(uniforms.highlight, highlight);
        gl.uniform1f(uniforms.peakIntensity, effect.peakIntensity / 100);
        gl.uniform1f(uniforms.falloffPower, effect.falloffPower / 100);
        gl.uniform1f(uniforms.warpAmplitude, effect.warpAmplitude / 100);
        gl.uniform1f(uniforms.hueSpread, effect.hueSpread / 100);
        gl.uniform1f(uniforms.apexGlow, effect.apexGlow / 100);
        gl.uniform1f(uniforms.textureScale, effect.textureScale / 100);
        const dpr = window.devicePixelRatio || 1;
        gl.uniform1f(uniforms.uiScaleMultiplier, TARGET_DPR / dpr);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      if (!reducedMotion) {
        schedule();
      }
    }

    const onResize = () => resizeCanvas(activeCanvas, gl, scaleCap, maxBackingPixels);
    const onVisibility = () => {
      if (isHidden()) {
        if (animationFrame) {
          cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        }
        return;
      }
      // Resume on the next frame rather than replaying the 30fps gate against
      // a stale timestamp. startedAt is deliberately NOT reset, so the shader
      // clock stays continuous instead of snapping back to its opening state.
      previousFrame = 0;
      schedule();
    };
    const onRestored = () => setRecoveries((previous) => previous + 1);

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    activeCanvas.addEventListener("webglcontextlost", onContextLost);
    activeCanvas.addEventListener("webglcontextrestored", onRestored);
    schedule();

    return () => {
      disposed = true;
      mosaicTextureGeneration += 1;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      activeCanvas.removeEventListener("webglcontextlost", onContextLost);
      activeCanvas.removeEventListener("webglcontextrestored", onRestored);
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      clearMosaicTexture();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      // Chromium caps live WebGL contexts per page and silently drops the
      // oldest once passed. Without this, every mount/unmount leaked one —
      // /config mounts a second background while this one is tearing down.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [onContextLost, recoveries, surrendered]);

  if (surrendered) {
    return null;
  }

  return <canvas ref={canvasRef} aria-hidden="true" className="fluid-background" />;
}
