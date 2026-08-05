import { describe, expect, it } from "vitest";
import { normalizePhonoscopeGlowOverlay } from "./phonoscope-store";
import type { PhonoscopeGlowOverlay } from "./types";

const fallback: PhonoscopeGlowOverlay = {
  blendModeSource: { type: "manual", value: 0 },
  blurSource: { type: "manual", value: 0 },
  opacitySource: { type: "manual", value: 0 },
};

describe("normalizePhonoscopeGlowOverlay", () => {
  it("keeps a driven blur and opacity inside the layer's own ranges", () => {
    expect(normalizePhonoscopeGlowOverlay({
      blendModeSource: { type: "manual", value: 1 },
      blurSource: {
        type: "bass",
        min: -5,
        max: 40,
        attackSeconds: 0.05,
        holdSeconds: 0,
        releaseSeconds: 0.4,
      },
      opacitySource: { type: "manual", value: 250 },
    }, fallback)).toEqual({
      blendModeSource: { type: "manual", value: 1 },
      blurSource: {
        type: "bass",
        min: 0,
        max: 20,
        attackSeconds: 0.05,
        holdSeconds: 0,
        releaseSeconds: 0.4,
      },
      opacitySource: { type: "manual", value: 100 },
    });
  });

  it("keeps a driven blend mode on its own whole-numbered axis", () => {
    expect(normalizePhonoscopeGlowOverlay({
      blendModeSource: {
        type: "downbeat",
        min: -3,
        max: 9,
        attackSeconds: 0,
        holdSeconds: 0.2,
        releaseSeconds: 0,
      },
    }, fallback).blendModeSource).toEqual({
      type: "downbeat",
      min: 0,
      max: 2,
      attackSeconds: 0,
      holdSeconds: 0.2,
      releaseSeconds: 0,
    });
  });

  it("reads a legacy blend-mode string as the manual value it maps to", () => {
    expect(normalizePhonoscopeGlowOverlay({ blendMode: "multiply" }, fallback).blendModeSource)
      .toEqual({ type: "manual", value: 1 });
    expect(normalizePhonoscopeGlowOverlay({ blendMode: "screen" }, fallback).blendModeSource)
      .toEqual({ type: "manual", value: 0 });
    expect(normalizePhonoscopeGlowOverlay({ blendMode: "overlay" }, fallback).blendModeSource)
      .toEqual({ type: "manual", value: 2 });
  });

  it("falls back to screen for an unknown legacy blend mode", () => {
    expect(normalizePhonoscopeGlowOverlay({ blendMode: "hard-light" }, fallback).blendModeSource)
      .toEqual({ type: "manual", value: 0 });
  });

  it("prefers a stored source over a stale legacy blend mode", () => {
    expect(normalizePhonoscopeGlowOverlay({
      blendMode: "screen",
      blendModeSource: { type: "manual", value: 1 },
    }, fallback).blendModeSource).toEqual({ type: "manual", value: 1 });
  });

  it("keeps the current sources when a stored one is unusable", () => {
    const current: PhonoscopeGlowOverlay = {
      blendModeSource: { type: "manual", value: 1 },
      blurSource: { type: "manual", value: 6 },
      opacitySource: { type: "manual", value: 55 },
    };
    expect(normalizePhonoscopeGlowOverlay({
      blendModeSource: { type: "future-driver" },
      blurSource: { type: "future-driver" },
      opacitySource: null,
    }, current)).toEqual(current);
  });

  it("returns the fallback untouched when the whole block is missing", () => {
    expect(normalizePhonoscopeGlowOverlay(undefined, fallback)).toBe(fallback);
  });
});
