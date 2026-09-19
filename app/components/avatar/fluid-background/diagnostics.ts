"use client";

// One-shot WebGL capability report for the fluid background. Split out of
// FluidBackground.tsx to keep that file inside the 10 KB agent-readability cap
// (specs/agent-token-footprint.md); it is pure reporting with no draw-loop role.

import type { MutableRefObject } from "react";
import type { FluidBackgroundDebug, FluidPrecision } from "./types";

export function reportDiagnosticsOnce({
  activeCanvas,
  debugRef,
  gl,
  maxBackingPixels,
  requestedPrecision,
  scaleCap,
}: {
  activeCanvas: HTMLCanvasElement;
  debugRef: MutableRefObject<FluidBackgroundDebug | undefined>;
  gl: WebGLRenderingContext;
  maxBackingPixels: number;
  requestedPrecision: FluidPrecision;
  scaleCap: number;
}) {
  let reported = false;

  return () => {
    if (reported) {
      return;
    }
    reported = true;
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
}
