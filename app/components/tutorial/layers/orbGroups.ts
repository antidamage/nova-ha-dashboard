"use client";

import {
  BUILTIN_ORB_MODULE_MAP,
  resolveOrbModule,
  resolveOrbModuleSettings,
  type OrbLayer,
  type OrbModule,
} from "../../../../lib/orb-modules";
import type { NovaAvatarTheme } from "../../avatarThemeModel";
import { ORB_RADIUS_FRACTION } from "../../avatar/nova-avatar/avatar-model";
import { createOrbRenderer } from "../../avatar/orb-renderer/renderer";
import { buildOrbPalette } from "../../orbModules";

/**
 * The status orb's Canvas 2D body taken apart into five cards
 * (specs/tutorial-mode.md, "Layer sets"). The groups partition the module's
 * layers, so the five cards together are the body. Each card runs the module's
 * own renderer with only its group enabled, so layer indices (and the
 * renderer's per-layer animation state) stay as they are.
 */
export type OrbGroup = "base" | "fields" | "rings" | "marks" | "gloss";

/** Bottom to top. */
export const ORB_GROUPS: readonly OrbGroup[] = ["base", "fields", "rings", "marks", "gloss"];

/** The first group a layer fits: clipped to the rim is gloss, else by type. */
export function orbGroupOf(layer: OrbLayer): OrbGroup {
  if (layer.clip) return "gloss";
  switch (layer.type) {
    case "disc":
      return "base";
    case "arcField":
    case "lineField":
      return "fields";
    case "ring":
      return "rings";
    default:
      return "marks";
  }
}

/** The module with every layer outside `group` switched off. */
export function groupModule(module: OrbModule, group: OrbGroup): OrbModule {
  return { ...module, layers: module.layers.map((layer) => (orbGroupOf(layer) === group ? layer : { ...layer, enabled: false })) };
}

/** The groups this module has any enabled layer in. */
export function groupsPresent(module: OrbModule): Set<OrbGroup> {
  return new Set(module.layers.filter((layer) => layer.enabled !== false).map(orbGroupOf));
}

export function orbModuleFor(avatar: NovaAvatarTheme): OrbModule {
  return resolveOrbModule(avatar.orbModule, BUILTIN_ORB_MODULE_MAP);
}

type Frame = { left: number; top: number; width: number; height: number };

/**
 * Draws every group's card from one shared animation frame loop, on the real
 * orb canvas's place in the frame, until the returned stop is called.
 */
export function startOrbGroupLoop(cards: Map<OrbGroup, HTMLCanvasElement>, source: HTMLCanvasElement, frame: Frame, avatar: NovaAvatarTheme) {
  const module = orbModuleFor(avatar);
  const palette = buildOrbPalette(avatar);
  const settings = resolveOrbModuleSettings(module, avatar.orbModuleSettings?.[module.id]);
  const renderers = Array.from(cards, ([group, canvas]) => ({ canvas, renderer: createOrbRenderer(groupModule(module, group)) }));
  const startedAt = performance.now();
  let last = startedAt;
  let id = 0;
  const tick = (now: number) => {
    const rect = source.getBoundingClientRect();
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    for (const { canvas, renderer } of renderers) {
      const ctx = canvas.getContext("2d");
      if (!ctx || rect.width === 0) continue;
      const scale = canvas.width / frame.width;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, (rect.left - frame.left) * scale, (rect.top - frame.top) * scale);
      renderer.render(ctx, {
        centerX: rect.width / 2,
        centerY: rect.height / 2,
        radiusPx: rect.width * ORB_RADIUS_FRACTION,
        palette,
        load: 0.45,
        alertActive: false,
        settings,
        nowMs: now - startedAt,
        dtSec: dt,
      });
    }
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}
