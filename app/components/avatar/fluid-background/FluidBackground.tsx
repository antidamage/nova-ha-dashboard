"use client";

// Sole owner of the fluid background's WebGL context and animation loop.

import { useEffect, useRef } from "react";
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
import type { FluidBackgroundDebug, FluidBackgroundDiagnostics, ProgramInfo } from "./types";

export function FluidBackground({ theme, debug }: { theme: DeviceTheme; debug?: FluidBackgroundDebug }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  // Captured once at mount — the standalone test page changes these via a full
  // reload, so they never need to react to prop changes mid-session.
  const debugRef = useRef(debug);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
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

    let diagnosticsReported = false;
    const reportDiagnostics = () => {
      if (diagnosticsReported) {
        return;
      }
      diagnosticsReported = true;
      const onDiagnostics = debugRef.current?.onDiagnostics;
      if (!onDiagnostics) {
        return;
      }

      const highpFmt = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      const fragmentHighpSupported = Boolean(highpFmt && highpFmt.precision > 0);
      const activePrecision: "high" | "medium" = requestedPrecision === "medium"
        ? "medium"
        : requestedPrecision === "high"
          ? "high"
          : fragmentHighpSupported
            ? "high"
            : "medium";

      const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = rendererInfo
        ? (gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) as string)
        : (gl.getParameter(gl.RENDERER) as string | null);
      const vendor = rendererInfo
        ? (gl.getParameter(rendererInfo.UNMASKED_VENDOR_WEBGL) as string)
        : (gl.getParameter(gl.VENDOR) as string | null);

      onDiagnostics({
        activePrecision,
        requestedPrecision,
        fragmentHighpSupported,
        devicePixelRatio: window.devicePixelRatio || 1,
        cssWidth: window.innerWidth,
        cssHeight: window.innerHeight,
        backingWidth: activeCanvas.width,
        backingHeight: activeCanvas.height,
        scaleCap,
        maxBackingPixels,
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
        renderer: renderer ?? null,
        vendor: vendor ?? null,
      });
    };
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
        if (reducedMotion && !animationFrame) {
          animationFrame = requestAnimationFrame(draw);
        }
      };
      image.onerror = () => {
        if (disposed || generation !== mosaicTextureGeneration) {
          return;
        }
        mosaicTextureReady = false;
        console.info("[nova-dashboard] background texture unavailable", url);
        if (reducedMotion && !animationFrame) {
          animationFrame = requestAnimationFrame(draw);
        }
      };
      image.src = url;
    };

    function draw(now: number) {
      animationFrame = 0;
      if (arePageUpdatesPaused()) {
        if (!disposed) animationFrame = requestAnimationFrame(draw);
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

      if (!reducedMotion && !disposed) {
        animationFrame = requestAnimationFrame(draw);
      }
    }

    const onResize = () => resizeCanvas(activeCanvas, gl, scaleCap, maxBackingPixels);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    animationFrame = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      mosaicTextureGeneration += 1;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      clearMosaicTexture();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="fluid-background" />;
}
