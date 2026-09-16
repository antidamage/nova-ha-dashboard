"use client";

import type { FluidPrecision } from "./types";

// Reference DPR the texture scale is authored against (iOS Retina). The mosaic
// texture tiling is normalized to this so it looks the same regardless of the
// device pixel ratio (e.g. Brave desktop at DPR 1 vs iOS at DPR 2/3).
export const TARGET_DPR = 2.0;

export const VERTEX_SHADER = `
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

export function buildFragmentShader(precision: FluidPrecision) {
  return `${precisionDirective(precision)}\n${FRAGMENT_SHADER_BODY}`;
}
