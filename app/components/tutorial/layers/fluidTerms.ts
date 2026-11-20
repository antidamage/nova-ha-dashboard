"use client";

import { appliedThemeRgb, type DeviceTheme } from "../../accentColor";
import { colorVector, createMosaicTexture, createProgram } from "../../avatar/fluid-background/gl-program";
import { TARGET_DPR } from "../../avatar/fluid-background/shaders";
import type { FluidTerm } from "./catalogue";

/**
 * The background's shader, broken into its terms (specs/tutorial-mode.md,
 * "Background"): the same program the dashboard runs, drawn once per term in
 * ONE offscreen WebGL context, with the later terms switched off through its
 * own uniforms. Each card builds on the one before. Every draw is copied to
 * its card's 2D canvas, then the context is released with WEBGL_lose_context:
 * Chromium caps live contexts per page and drops the oldest, which once left
 * the real background blank (specs/wallpaper-background-mode.md).
 */

export const FLUID_TERMS: readonly FluidTerm[] = ["base", "peaks", "hue", "apex", "texture"];

type Uniforms = { peak: number; warp: number; hue: number; apex: number; texture: boolean };

/** What each card switches on, cumulatively. Pure, so it is tested. */
export function termUniforms(term: FluidTerm, effect: DeviceTheme["backgroundEffect"]): Uniforms {
  const upTo = FLUID_TERMS.indexOf(term);
  return {
    peak: upTo >= 1 ? effect.peakIntensity / 100 : 0,
    warp: upTo >= 1 ? effect.warpAmplitude / 100 : 0,
    hue: upTo >= 2 ? effect.hueSpread / 100 : 0,
    apex: upTo >= 3 ? effect.apexGlow / 100 : 0,
    texture: upTo >= 4,
  };
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * Draws every term into its target canvas at `width`×`height` CSS pixels.
 * Resolves false when WebGL is unavailable; the cards then say so.
 */
export async function renderFluidTerms(theme: DeviceTheme, targets: Partial<Record<FluidTerm, HTMLCanvasElement>>, width: number, height: number): Promise<boolean> {
  const scale = Math.min(1, 640 / Math.max(width, height));
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.max(1, Math.round(width * scale));
  offscreen.height = Math.max(1, Math.round(height * scale));
  // Released however this ends: createProgram can fail after it has taken a
  // context (a compile or link error, a missing uniform), and so can the
  // texture. getContext returns the context already taken, if there is one.
  const release = () => offscreen.getContext("webgl")?.getExtension("WEBGL_lose_context")?.loseContext();
  try {
    const info = createProgram(offscreen, "auto");
    if (!info) return false;
    const { attribute, buffer, gl, program, uniforms } = info;
    const effect = theme.backgroundEffect;
    const image = effect.textureUrl ? await loadImage(effect.textureUrl) : null;
    const texture = image ? createMosaicTexture(gl, image) : null;
    for (const term of FLUID_TERMS) {
      const target = targets[term];
      if (!target) continue;
      const on = termUniforms(term, effect);
      gl.viewport(0, 0, offscreen.width, offscreen.height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, on.texture ? texture : null);
      gl.uniform1i(uniforms.mosaicTexture, 0);
      gl.uniform1f(uniforms.hasMosaicTexture, on.texture && texture ? 1 : 0);
      gl.uniform1f(uniforms.time, 12);
      gl.uniform2f(uniforms.resolution, offscreen.width, offscreen.height);
      gl.uniform3fv(uniforms.background, colorVector(appliedThemeRgb(theme.background)));
      gl.uniform3fv(uniforms.accent, colorVector(appliedThemeRgb(theme.accent)));
      gl.uniform3fv(uniforms.highlight, colorVector(appliedThemeRgb(theme.highlight)));
      gl.uniform1f(uniforms.peakIntensity, on.peak);
      gl.uniform1f(uniforms.falloffPower, effect.falloffPower / 100);
      gl.uniform1f(uniforms.warpAmplitude, on.warp);
      gl.uniform1f(uniforms.hueSpread, on.hue);
      gl.uniform1f(uniforms.apexGlow, on.apex);
      gl.uniform1f(uniforms.textureScale, effect.textureScale / 100);
      gl.uniform1f(uniforms.uiScaleMultiplier, (TARGET_DPR / (window.devicePixelRatio || 1)) * scale);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Copied in the same task as the draw, before the buffer can be cleared.
      target.width = offscreen.width;
      target.height = offscreen.height;
      target.getContext("2d")?.drawImage(offscreen, 0, 0);
    }
    if (texture) gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    return true;
  } catch {
    return false;
  } finally {
    release();
  }
}
