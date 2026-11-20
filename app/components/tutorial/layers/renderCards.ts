"use client";

import type { DeviceTheme } from "../../accentColor";
import type { Layer, LayerSet } from "./catalogue";
import { renderFluidTerms } from "./fluidTerms";
import { drawClone, rasteriseLayer } from "./rasterise";

/**
 * Pre-renders every card of a layer set into its canvas, once, when the view
 * opens (specs/tutorial-mode.md, "How was this control built?"). A live
 * canvas layer (the orb's body) is only sized here; `copyLiveCanvas` keeps it
 * moving.
 */

export type Frame = { left: number; top: number; width: number; height: number };

export type CardSources = {
  /** The control the layers are read off: the copy's knob, or the real orb. */
  control: Element | null;
  /** The knob's floating ring layer, when it has one. */
  rings: Element | null;
  /** Every card of the set is drawn in this one frame, so they line up. */
  frame: Frame;
  theme: DeviceTheme;
};

const toRect = (frame: Frame) => new DOMRect(frame.left, frame.top, frame.width, frame.height);

/** The frame a set is drawn in: the control (and its rings), or the viewport. */
export function frameFor(set: LayerSet, control: Element | null, rings: Element | null): Frame {
  if (set.id === "background" || !control) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const a = control.getBoundingClientRect();
  const b = rings?.getBoundingClientRect();
  if (!b || b.width === 0) return { left: a.left, top: a.top, width: a.width, height: a.height };
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return { left, top, width: Math.max(a.right, b.right) - left, height: Math.max(a.bottom, b.bottom) - top };
}

function sizeCanvas(canvas: HTMLCanvasElement, frame: Frame) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(frame.width * dpr));
  canvas.height = Math.max(1, Math.round(frame.height * dpr));
}

/** Copies a live canvas (the orb's body) into its card, where it sits in the frame. */
export function copyLiveCanvas(source: HTMLCanvasElement, card: HTMLCanvasElement, frame: Frame) {
  const ctx = card.getContext("2d");
  if (!ctx || source.width === 0) return;
  const rect = source.getBoundingClientRect();
  const sx = card.width / frame.width;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, card.width, card.height);
  ctx.drawImage(source, (rect.left - frame.left) * sx, (rect.top - frame.top) * sx, rect.width * sx, rect.height * sx);
}

async function renderOne(layer: Layer, canvas: HTMLCanvasElement, sources: CardSources): Promise<boolean> {
  const { control, rings, frame } = sources;
  const source = layer.source;
  switch (source.kind) {
    case "dom":
      return control ? rasteriseLayer(control, source.selector, toRect(frame), canvas) : false;
    case "rings":
      return rings ? rasteriseLayer(rings, "svg.rotary-encoder-rings, svg.rotary-encoder-rings *", toRect(frame), canvas) : false;
    case "page": {
      const element = document.querySelector(source.selector);
      return element ? rasteriseLayer(element, source.selector, toRect(frame), canvas) : false;
    }
    case "fill": {
      sizeCanvas(canvas, frame);
      const element = document.querySelector(source.selector);
      const ctx = canvas.getContext("2d");
      if (!element || !ctx) return false;
      ctx.fillStyle = getComputedStyle(element).backgroundColor || getComputedStyle(document.body).backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return true;
    }
    case "pseudo": {
      const element = document.querySelector(source.selector);
      if (!element) return false;
      const style = getComputedStyle(element, source.pseudo);
      if (!style.content || style.content === "none") return false;
      const div = document.createElement("div");
      for (let index = 0; index < style.length; index += 1) div.style.setProperty(style[index], style.getPropertyValue(style[index]));
      div.style.setProperty("position", "absolute");
      div.style.setProperty("inset", "0");
      return drawClone(div, frame.width, frame.height, canvas);
    }
    case "canvas":
      sizeCanvas(canvas, frame);
      return Boolean(control?.querySelector(source.selector));
    case "webgl":
      return true;
  }
}

/** Draws every card; resolves with the ids that drew nothing (left out of the stack). */
export async function renderCards(set: LayerSet, canvases: Map<string, HTMLCanvasElement>, sources: CardSources): Promise<Set<string>> {
  const empty = new Set<string>();
  for (const layer of set.layers) {
    const canvas = canvases.get(layer.id);
    if (!canvas) continue;
    if (!(await renderOne(layer, canvas, sources))) empty.add(layer.id);
  }
  const terms = set.layers.filter((layer) => layer.source.kind === "webgl");
  // With the wallpaper as the background there is no shader to take apart.
  if (terms.length && document.querySelector(".dashboard-wallpaper-background")) {
    for (const layer of terms) empty.add(layer.id);
  } else if (terms.length) {
    const targets = Object.fromEntries(terms.flatMap((layer) => {
      const canvas = canvases.get(layer.id);
      return canvas && layer.source.kind === "webgl" ? [[layer.source.term, canvas]] : [];
    }));
    const drawn = await renderFluidTerms(sources.theme, targets, sources.frame.width, sources.frame.height);
    if (!drawn) for (const layer of terms) empty.add(layer.id);
  }
  return empty;
}
