"use client";

import { readExperienceFeatures } from "../dashboard/experienceModeSetting";
import type { TutorialStep, TutorialTargetKind } from "./steps";

/**
 * Finding the real control a step points at (specs/tutorial-mode.md, "Target
 * resolution"): the first match in page order that is laid out. The tour
 * never navigates to find one; a step with no target is skipped.
 */

const laidOut = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

function first(selector: string, accept: (element: Element) => boolean = () => true): HTMLElement | null {
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    if (element.closest("[data-tutorial-ui]")) continue;
    if (laidOut(element) && accept(element)) return element;
  }
  return null;
}

export function findTarget(kind: TutorialTargetKind): HTMLElement | null {
  switch (kind) {
    case "help-button":
      return first(".tutorial-help-button");
    case "light":
      return first(".zone-color-encoder");
    case "presets":
      return first(".zone-lighting-presets");
    case "aircon":
      // The climate knob whose dial names an air conditioner (AirconKnob's
      // aria-label), not the heater's.
      return first(".rotary-encoder.temperature-encoder", (element) =>
        /air conditioner/i.test(element.querySelector(".rotary-encoder-dial")?.getAttribute("aria-label") ?? ""));
    case "orb":
      return first(".nova-avatar-host");
    case "fold":
      return first(".advanced-fold:not([data-foldless])", (element) =>
        (element as HTMLElement).dataset.open !== "true" && Boolean(element.querySelector(".advanced-fold-divider")));
    case "page":
      return document.body;
  }
}

/** The dial inside a knob target: what the copy lines its own dial up with. */
export function dialOf(target: Element): HTMLElement | null {
  return target.matches(".rotary-encoder-dial") ? (target as HTMLElement) : target.querySelector(".rotary-encoder-dial");
}

function featureOn(feature: NonNullable<TutorialStep["requires"]>) {
  const features = readExperienceFeatures();
  if (feature === "statusOrb") return features.statusOrb && Boolean(document.querySelector(".nova-avatar-host"));
  return features.background && !document.documentElement.hasAttribute("data-nova-no-background");
}

/** The steps that can run on this page right now, in order. */
export function resolveSteps(steps: readonly TutorialStep[]): TutorialStep[] {
  return steps.filter((step) => {
    if (step.requires && !featureOn(step.requires)) return false;
    return findTarget(step.target) !== null;
  });
}
