"use client";

// Scroller geometry for the fold: offsets, sizes and transforms along one axis.
import type { Axis } from "./types";

export function prefersReducedMotion() {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function readOffset(node: HTMLElement, axis: Axis) {
  return axis === "y" ? node.scrollTop : node.scrollLeft;
}

export function writeOffset(node: HTMLElement, axis: Axis, value: number) {
  if (axis === "y") node.scrollTop = value;
  else node.scrollLeft = value;
}

export function clientSize(node: HTMLElement, axis: Axis) {
  return axis === "y" ? node.clientHeight : node.clientWidth;
}

export function maxOffset(node: HTMLElement, axis: Axis) {
  const scroll = axis === "y" ? node.scrollHeight : node.scrollWidth;
  return Math.max(0, scroll - clientSize(node, axis));
}

export function translate(axis: Axis, px: number) {
  if (Math.abs(px) < 0.01) return "none";
  return axis === "y" ? `translateY(${px}px)` : `translateX(${px}px)`;
}
