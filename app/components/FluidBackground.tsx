"use client";

import { useEffect, useRef } from "react";
import { appliedThemeRgb, type DeviceTheme } from "./accentColor";
import { arePageUpdatesPaused } from "./dashboard/pageUpdatePause";

// Reference DPR the texture scale is authored against (iOS Retina). The mosaic
// texture tiling is normalized to this so it looks the same regardless of the
// device pixel ratio (e.g. Brave desktop at DPR 1 vs iOS at DPR 2/3).
const TARGET_DPR = 2.0;

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// The precision qualifier is prepended at compile time (see buildFragmentShader)
// so the standalone test page can force highp/mediump for A/B comparison. 32-bit
// ("highp") is used by default where the GPU supports it, matching desktop Brave
// / iPad (which silently promote mediump) and the Metal reference. On a true
// 16-bit mediump GPU (the Nova portrait kiosk) the time/center math quantizes
// and the peaks wash out against the brightness cap ("too bright").
const FRAGMENT_SHADER_BODY = `
varying vec2 v_uv;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec3 u_background;
uniform vec3 u_accent;
uniform vec3 u_highlight;
uniform float u_peakIntensity;
uniform float u_falloffPower;
uniform float u_warpAmplitude;
uniform float u_hueSpread;
uniform float u_apexGlow;
uniform sampler2D u_mosaicTexture;
uniform float u_hasMosaicTexture;
uniform float u_textureScale;
uniform float u_uiScaleMultiplier;

vec3 hsvToRgb(vec3 c) {
  vec4 k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(k.xxx, clamp(p - k.xxx, 0.0, 1.0), c.y);
}

vec3 rgbToHsv(vec3 c) {
  vec4 k = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, k.wz), vec4(c.gb, k.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hueShift(vec3 color, float amount) {
  vec3 hsv = rgbToHsv(max(color, vec3(0.0)));
  hsv.x = fract(hsv.x + amount);
  return hsvToRgb(hsv);
}

float peakField(vec2 p, vec2 center, float radius, float time, float seed, float warpAmplitude, float falloffPower) {
  vec2 warped = p;
  warped.x += sin(p.y * 4.4 + time * 0.18 + seed) * 0.056 * warpAmplitude;
  warped.y += cos(p.x * 3.8 - time * 0.15 + seed * 1.7) * 0.048 * warpAmplitude;

  float dist = length(warped - center);
  float peak = smoothstep(radius, 0.0, dist);
  float ridge = 0.5 + 0.5 * sin((p.x * 7.0 + p.y * 5.0) + time * 0.22 + seed);
  return pow(peak, max(0.4, falloffPower)) * (0.70 + ridge * 0.45);
}

vec2 mosaicTextureUv(vec2 uv, float aspect) {
  return fract(vec2(uv.x * aspect, uv.y) * max(0.25, u_textureScale) * u_uiScaleMultiplier);
}

float mosaicGrout(vec3 map) {
  float nearZeroRg = 1.0 - smoothstep(0.004, 0.025, max(map.r, map.g));
  float highZ = smoothstep(0.965, 0.995, map.b);
  return nearZeroRg * highZ;
}

vec2 mosaicMappedUv(vec2 uv, float aspect) {
  if (u_hasMosaicTexture < 0.5) {
    return uv;
  }

  vec3 map = texture2D(u_mosaicTexture, mosaicTextureUv(uv, aspect)).rgb;
  float grout = mosaicGrout(map);
  vec2 normalOffset = map.rg * 2.0 - 1.0;

  normalOffset *= (1.0 - grout);
  // Displacement tracks tile size so the refraction looks identical per-tile
  // across pixel densities (matches the u_uiScaleMultiplier texture tiling).
  return uv + normalOffset * vec2(1.0 / max(aspect, 1.0), 1.0) * (0.034 / u_uiScaleMultiplier);
}

float mosaicBackgroundOverlay(vec2 uv, float aspect) {
  if (u_hasMosaicTexture < 0.5) {
    return 0.0;
  }

  vec3 map = texture2D(u_mosaicTexture, mosaicTextureUv(uv, aspect)).rgb;
  return clamp(map.b, 0.0, 1.0);
}

void main() {
  vec2 resolution = max(u_resolution, vec2(1.0));
  float aspect = resolution.x / resolution.y;
  vec2 uv = mosaicMappedUv(v_uv, aspect);
  float backgroundOverlay = mosaicBackgroundOverlay(v_uv, aspect);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float time = u_time;
  float peakIntensity = clamp(u_peakIntensity, 0.4, 2.6);
  float falloffPower = clamp(u_falloffPower, 0.8, 3.2);
  float warpAmplitude = clamp(u_warpAmplitude, 0.4, 2.2);
  float hueSpread = clamp(u_hueSpread, 0.0, 1.0);
  float apexGlow = clamp(u_apexGlow, 0.0, 2.4);

  vec3 color = u_background;
  float seeds[4];
  seeds[0] = 0.0;
  seeds[1] = 1.8;
  seeds[2] = 3.4;
  seeds[3] = 5.2;
  float radii[4];
  radii[0] = 0.48;
  radii[1] = 0.43;
  radii[2] = 0.46;
  radii[3] = 0.38;

  for (int i = 0; i < 4; i++) {
    float seed = seeds[i];
    vec2 center = vec2(
      sin(time * 0.055 + seed) * 0.50 + sin(time * 0.019 + seed * 2.1) * 0.10,
      cos(time * 0.047 + seed * 1.3) * 0.31 + sin(time * 0.027 + seed) * 0.11
    );
    center.x *= aspect;

    float peak = peakField(p, center, radii[i], time, seed, warpAmplitude, falloffPower);
    float apex = smoothstep(0.62, 1.0, peak);
    float pulse = 0.5 + 0.5 * sin(time * 0.12 + seed);
    vec3 tint = mix(u_accent, u_highlight, pulse);
    float hueOffset = (sin(seed * 12.9898 + time * 0.018) * 0.5 + sin(seed * 4.531) * 0.5) * 0.11 * hueSpread;
    tint = hueShift(tint, hueOffset);
    color += tint * peak * (0.22 + pulse * 0.16) * peakIntensity;
    color += tint * apex * 0.18 * apexGlow;
  }

  float grain = fract(sin(dot(uv * resolution + time, vec2(12.9898, 78.233))) * 43758.5453);
  color += (grain - 0.5) * 0.006;

  float vignette = smoothstep(0.34, 1.16, length(p));
  color = mix(color, u_background * 0.76, vignette * 0.42);
  vec3 cap = max(u_accent, u_highlight) * (0.64 + peakIntensity * 0.12) + u_background * 1.05;
  color = min(color, cap);
  color = mix(color, u_background, backgroundOverlay);

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

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

function precisionDirective(precision: FluidPrecision) {
  if (precision === "high") {
    return "precision highp float;";
  }
  if (precision === "medium") {
    return "precision mediump float;";
  }
  return [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
  ].join("\n");
}

function buildFragmentShader(precision: FluidPrecision) {
  return `${precisionDirective(precision)}\n${FRAGMENT_SHADER_BODY}`;
}

type ProgramInfo = {
  attribute: number;
  buffer: WebGLBuffer;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  uniforms: Record<
    "accent" | "apexGlow" | "background" | "falloffPower" | "hasMosaicTexture" | "highlight" | "hueSpread" | "mosaicTexture" | "peakIntensity" | "resolution" | "textureScale" | "time" | "uiScaleMultiplier" | "warpAmplitude",
    WebGLUniformLocation
  >;
};

function colorVector(color: ReturnType<typeof appliedThemeRgb>) {
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

function createProgram(canvas: HTMLCanvasElement, precision: FluidPrecision): ProgramInfo | null {
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
const DEFAULT_MAX_BACKING_PIXELS = 2_300_000;
const DEFAULT_SCALE_CAP = 1.5;

function resizeCanvas(
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

function createMosaicTexture(gl: WebGLRenderingContext, image: HTMLImageElement) {
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
