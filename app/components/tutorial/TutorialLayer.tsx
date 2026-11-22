"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DeviceTheme } from "../accentColor";
import { LayerStage } from "./layers/LayerStage";
import { useLayerView } from "./layers/useLayerView";
import { Finger, type FingerHandle } from "./finger/Finger";
import { BAR_HEIGHT, captionPlacement, cutoutFor, isOffscreen, maskPath, PANEL_GAP, panelWidth, unionBox, VIEWPORT_GUTTER } from "./geometry-model";
import { installInputGuard } from "./inputGuard";
import { SandboxCopy } from "./sandbox/SandboxCopy";
import { TUTORIAL_STEPS, type TutorialStep } from "./steps";
import { findTarget, resolveSteps } from "./targets";
import { TutorialBar, TutorialPanel } from "./TutorialCaption";
import { closeTutorial, useTutorialOpen } from "./tutorialStore";
import { IDLE_EXIT_MS, PAUSED_IDLE_EXIT_MS, useFoldRestore, useIdleExit } from "./useTourLifecycle";
import { useTourPlayback } from "./useTourPlayback";
import { nextFrames, reducedMotion, settled, useCopyModes, useCopyRingLayer, useViewport } from "./tourHooks";
import { useTrackedRect } from "./useTrackedRect";

const DEMO = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
const FLASH_MS = 300;
function Tour({ theme }: { theme: DeviceTheme }) {
  const avatar = theme.avatar;
  const viewport = useViewport();
  const landscape = viewport.width > viewport.height;
  // Resolved on open and again on a layout flip, so the counter never jumps.
  const steps = useMemo(() => resolveSteps(TUTORIAL_STEPS), [landscape]); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)];
  // The target is held with the step it was found for, so nothing (the finger
  // above all) ever runs one step's script against the last step's control.
  const [resolved, setResolved] = useState<{ step: TutorialStep; element: HTMLElement | null } | null>(null);
  const target = resolved && resolved.step === step ? resolved.element : null;
  const [resetKey, setResetKey] = useState(0);
  const { manual, copyModes } = useCopyModes(step, setResetKey);
  const [flash, setFlash] = useState(false);
  // The current phase's caption, while a phased script plays (null: the step's).
  const [phase, setPhase] = useState<string | null>(null);
  useEffect(() => setPhase(null), [step]);
  const copyRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fingerRef = useRef<FingerHandle | null>(null);
  const [panelHeight, setPanelHeight] = useState(160);
  const reduced = useMemo(reducedMotion, []);

  useLayoutEffect(() => setResolved(step ? { step, element: findTarget(step.target) } : null), [step]);
  const tracked = useTrackedRect(step?.target === "page" ? null : target);
  // The copy's rings float round it in a body portal: the cut-out holds them too.
  const rings = useTrackedRect(useCopyRingLayer());
  const focus = unionBox(tracked, step?.copy ? rings : null);
  const cutout = focus ? cutoutFor(focus) : null;
  const offscreen = Boolean(cutout && isOffscreen(cutout, viewport));

  const scrollToTarget = useCallback(() => {
    if (!target || !step || step.target === "page" || step.target === "orb") return;
    // Clear of the fixed bar below and the screen edge above, with room for
    // rings that float round a knob once it unlocks.
    const rings = step.copy === "aircon" ? Math.round(target.getBoundingClientRect().height * 0.35) : 0;
    const held = target.style.scrollMargin;
    const side = `${VIEWPORT_GUTTER + rings}px`;
    target.style.scrollMargin = `${side} ${side} ${BAR_HEIGHT + PANEL_GAP + rings}px ${side}`;
    target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
    target.style.scrollMargin = held;
  }, [reduced, step, target]);
  useEffect(scrollToTarget, [scrollToTarget]);

  const exit = useCallback(() => closeTutorial(), []);
  useFoldRestore(step?.target === "fold" ? target : null);

  const indexRef = useRef(index);
  indexRef.current = index;
  const go = useCallback((delta: number) => {
    const next = indexRef.current + delta;
    if (next >= steps.length) closeTutorial();
    else setIndex(Math.max(0, next));
  }, [steps.length]);

  // Focus: to the panel on each step, kept inside the tour, back to "?" on exit.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [index]);
  useEffect(() => {
    const keepIn = (event: FocusEvent) => {
      if (event.target instanceof Element && !event.target.closest("[data-tutorial-ui], [data-portal-tag='tutorial']")) {
        panelRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("focusin", keepIn, true);
    document.documentElement.dataset.tutorialOpen = "true";
    return () => {
      document.removeEventListener("focusin", keepIn, true);
      delete document.documentElement.dataset.tutorialOpen;
      document.querySelector<HTMLElement>(".tutorial-help-button")?.focus({ preventScroll: true });
    };
  }, []);

  const within = useCallback((element: Element) => {
    if (copyRef.current?.contains(element)) return true;
    if (element.closest(".rotary-encoder-ring-layer[data-portal-tag='tutorial']")) return true;
    return step?.target === "fold" && Boolean(target?.contains(element));
  }, [step, target]);
  const getRoot = useCallback(() => (step?.copy ? copyRef.current : target), [step, target]);
  const reset = useCallback(async () => {
    if (step?.copy) setResetKey((key) => key + 1);
    await nextFrames();
    await settled(target);
  }, [step, target]);
  const draw = useCallback((view: Parameters<FingerHandle["draw"]>[0]) => fingerRef.current?.draw(view), []);

  const playback = useTourPlayback({ step, target, getRoot, within, reset, draw, reduced, onSay: setPhase });
  // The driver's own state: it is false whenever no script is running, however
  // the last one ended (finished, taken over, or cut short by Next). Paused
  // counts as idle, with a longer limit.
  const touch = useIdleExit(!DEMO, playback.driving && !playback.paused, exit, playback.paused ? PAUSED_IDLE_EXIT_MS : IDLE_EXIT_MS);
  const layers = useLayerView(step, copyRef, playback.stop, copyModes);
  const { view: layerView, close: closeLayers, opening: layersOpening } = layers;

  // The guard, and the tour's own keys, which only apply with focus in the
  // panel or bar or on nothing; on the copy, arrows and Esc are the copy's.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.isTrusted) return;
      touch();
      const active = document.activeElement;
      const free = !active || active === document.body || Boolean(active.closest("[data-tutorial-panel]"));
      if (!free) return;
      // With the layer view open, Esc goes back to the step, and Back/Next wait.
      if (layerView || layersOpening) {
        if (event.key === "Escape") closeLayers();
        return;
      }
      if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "Escape") exit();
    };
    const onMaskTap = () => {
      setFlash(true);
      window.setTimeout(() => setFlash(false), FLASH_MS);
    };
    return installInputGuard(DEMO ? "scroll-friendly" : "strict", onMaskTap, onKey);
  }, [closeLayers, exit, go, layerView, layersOpening, touch]);

  useLayoutEffect(() => {
    const height = panelRef.current?.offsetHeight;
    if (height && Math.abs(height - panelHeight) > 1) setPanelHeight(height);
  });

  if (!step) return null;
  const width = panelWidth(viewport);
  const placement = captionPlacement(offscreen ? null : cutout, viewport, { width, height: panelHeight });
  const lifted = step.target === "page" || Boolean(step.unmasked);
  // An unmasked step still marks its target, with a ring and no dimming.
  const ring = step.unmasked && step.target !== "page" ? cutout : null;

  return (
    <div className="tutorial-layer" data-tutorial-step={step.id} data-lifted={lifted ? "true" : undefined}>
      <svg className="tutorial-mask" width={viewport.width} height={viewport.height} aria-hidden="true">
        <path d={maskPath(viewport, lifted ? null : cutout)} fillRule="evenodd" />
      </svg>
      {ring ? (
        <div className="tutorial-target-ring" aria-hidden="true" style={{ transform: `translate3d(${ring.left}px, ${ring.top}px, 0)`, width: ring.width, height: ring.height }} />
      ) : null}
      {step.copy && target ? (
        <SandboxCopy ref={copyRef} kind={step.copy} target={target} step={step} avatar={avatar} resetKey={resetKey} manual={manual} />
      ) : null}
      <Finger ref={fingerRef} />
      <TutorialPanel
        ref={panelRef}
        step={step}
        caption={step.themeCycle ? step.caption : phase ?? step.caption}
        detail={step.themeCycle ? phase : null}
        placement={placement}
        width={width}
        flash={flash}
        playback={playback.slot}
        offscreen={offscreen}
        onClose={exit}
        onPlayback={() => {
          touch();
          playback.press();
        }}
        onBackToControl={scrollToTarget}
        onLayers={layers.available ? () => void layers.open() : undefined}
      />
      <TutorialBar index={index} count={steps.length} onBack={() => !layersOpening && go(-1)} onNext={() => !layersOpening && go(1)} />
      {layers.view ? (
        <LayerStage setId={layers.view.setId} control={layers.view.control} theme={theme} lead={manual ? "Shown in Manual so every ring draws." : undefined} onClose={layers.close} />
      ) : null}
    </div>
  );
}

/** The tour, portalled over the page while it is open (specs/tutorial-mode.md). */
export function TutorialLayer({ theme }: { theme: DeviceTheme }) {
  const open = useTutorialOpen();
  if (!open || typeof document === "undefined") return null;
  return createPortal(<Tour theme={theme} />, document.body);
}
