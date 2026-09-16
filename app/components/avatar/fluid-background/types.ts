"use client";

export type FluidPrecision = "auto" | "high" | "medium";

export type FluidBackgroundDiagnostics = {
  activePrecision: "high" | "medium";
  requestedPrecision: FluidPrecision;
  fragmentHighpSupported: boolean;
  devicePixelRatio: number;
  cssWidth: number;
  cssHeight: number;
  backingWidth: number;
  backingHeight: number;
  scaleCap: number;
  maxBackingPixels: number;
  maxTextureSize: number;
  renderer: string | null;
  vendor: string | null;
};

export type FluidBackgroundDebug = {
  precision?: FluidPrecision;
  // <= 0 disables the cap entirely.
  maxBackingPixels?: number;
  scaleCap?: number;
  onDiagnostics?: (info: FluidBackgroundDiagnostics) => void;
};

export type ProgramInfo = {
  attribute: number;
  buffer: WebGLBuffer;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  uniforms: Record<
    "accent" | "apexGlow" | "background" | "falloffPower" | "hasMosaicTexture" | "highlight" | "hueSpread" | "mosaicTexture" | "peakIntensity" | "resolution" | "textureScale" | "time" | "uiScaleMultiplier" | "warpAmplitude",
    WebGLUniformLocation
  >;
};
