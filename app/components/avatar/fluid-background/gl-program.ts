"use client";

import type { appliedThemeRgb } from "../../accentColor";
import { buildFragmentShader, VERTEX_SHADER } from "./shaders";
import type { FluidPrecision, ProgramInfo } from "./types";

export function colorVector(color: ReturnType<typeof appliedThemeRgb>) {
  return color.map((value) => value / 255) as [number, number, number];
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Could not create fluid background shader.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader compile error.";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

export function createProgram(canvas: HTMLCanvasElement, precision: FluidPrecision): ProgramInfo | null {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
    premultipliedAlpha: false,
    stencil: false,
  });
  if (!gl) {
    return null;
  }

  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, buildFragmentShader(precision));
  const program = gl.createProgram();
  if (!program) {
    return null;
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown shader link error.";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(program);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const uniform = (name: string) => {
    const location = gl.getUniformLocation(program, name);
    if (!location) {
      throw new Error(`Fluid background uniform missing: ${name}`);
    }
    return location;
  };

  return {
    attribute: gl.getAttribLocation(program, "a_position"),
    buffer,
    gl,
    program,
    uniforms: {
      accent: uniform("u_accent"),
      apexGlow: uniform("u_apexGlow"),
      background: uniform("u_background"),
      falloffPower: uniform("u_falloffPower"),
      hasMosaicTexture: uniform("u_hasMosaicTexture"),
      highlight: uniform("u_highlight"),
      hueSpread: uniform("u_hueSpread"),
      mosaicTexture: uniform("u_mosaicTexture"),
      peakIntensity: uniform("u_peakIntensity"),
      resolution: uniform("u_resolution"),
      textureScale: uniform("u_textureScale"),
      time: uniform("u_time"),
      uiScaleMultiplier: uniform("u_uiScaleMultiplier"),
      warpAmplitude: uniform("u_warpAmplitude"),
    },
  };
}

// Default backing-store budget. On a memory-constrained panel (the Nova portrait
// kiosk) an oversized drawing buffer pushes the browser into GPU layer tiling,
// which surfaces as a horizontal tear with mismatched brightness above/below the
// seam. ~2.3M px (a 1080p-class budget) leaves desktop/iPad output unchanged
// while reining in high-res portrait kiosks.
export const DEFAULT_MAX_BACKING_PIXELS = 2_300_000;
export const DEFAULT_SCALE_CAP = 1.5;

export function resizeCanvas(
  canvas: HTMLCanvasElement,
  gl: WebGLRenderingContext,
  scaleCap: number,
  maxBackingPixels: number,
) {
  const cssWidth = Math.max(1, window.innerWidth);
  const cssHeight = Math.max(1, window.innerHeight);
  let scale = Math.min(window.devicePixelRatio || 1, scaleCap);

  if (maxBackingPixels > 0) {
    const requestedPixels = cssWidth * cssHeight * scale * scale;
    if (requestedPixels > maxBackingPixels) {
      scale *= Math.sqrt(maxBackingPixels / requestedPixels);
    }
  }

  const width = Math.max(1, Math.round(cssWidth * scale));
  const height = Math.max(1, Math.round(cssHeight * scale));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, width, height);
}

export function createMosaicTexture(gl: WebGLRenderingContext, image: HTMLImageElement) {
  const texture = gl.createTexture();
  if (!texture) {
    return null;
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return texture;
}
