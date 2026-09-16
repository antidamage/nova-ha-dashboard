"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { markInput as markVoiceInput, type useVoiceMode } from "../../dashboard/voiceMode";
import type { useVoiceSpeechPhase } from "../../dashboard/voiceSpeech";
import { SPEECH_RETURN_FALLBACK_MS, speechScaleFor } from "./avatar-model";

type SpeechPhase = ReturnType<typeof useVoiceSpeechPhase>;

export function useSpeechMigration({
  hostRef,
  speechPhase,
  hidden,
  forceVisible,
  speechOnly,
  size,
}: {
  hostRef: RefObject<HTMLDivElement | null>;
  speechPhase: SpeechPhase;
  hidden: boolean;
  forceVisible: boolean;
  speechOnly: boolean;
  size: number;
}) {
  // Voice speech migration: on "speaking" the fixed host animates from its
  // resting spot to the viewport centre and enlarges; on "ending"/"idle" it
  // animates back. The travel is expressed as CSS variables consumed by the
  // .nova-avatar-speaking transform (globals.css) so lite mode's
  // instant-transition blanket rule applies automatically. speechOnly hosts
  // are already centred by their own class and only fade.
  useEffect(() => {
    if (hidden || forceVisible || speechOnly) return;
    const host = hostRef.current;
    if (!host) return;
    if (speechPhase === "speaking") {
      // Anchor = the transform origin (top centre), which scroll scaling
      // cannot move — so the measurement is stable mid-animation.
      const rect = host.getBoundingClientRect();
      const anchorX = rect.left + rect.width / 2;
      const anchorY = rect.top;
      const scale = speechScaleFor(window.innerWidth, window.innerHeight, size);
      host.style.setProperty("--nova-avatar-speech-x", `${window.innerWidth / 2 - anchorX}px`);
      host.style.setProperty("--nova-avatar-speech-y", `${window.innerHeight / 2 - (scale * size) / 2 - anchorY}px`);
      host.style.setProperty("--nova-avatar-speech-scale", scale.toFixed(4));
      host.classList.remove("nova-avatar-returning");
      host.classList.add("nova-avatar-speaking");
      return;
    }
    if (!host.classList.contains("nova-avatar-speaking")) return;
    // Return journey: the transient .nova-avatar-returning class carries the
    // transition (the base rule must stay transition-free so scroll scaling
    // never lags), removed once the orb lands.
    host.classList.add("nova-avatar-returning");
    host.classList.remove("nova-avatar-speaking");
    const land = () => host.classList.remove("nova-avatar-returning");
    const timer = window.setTimeout(land, SPEECH_RETURN_FALLBACK_MS);
    host.addEventListener("transitionend", land, { once: true });
    return () => {
      window.clearTimeout(timer);
      host.removeEventListener("transitionend", land);
    };
  }, [speechPhase, hidden, forceVisible, speechOnly, size]);
}

export function useSpeechEndIdleReset({
  speechPhase,
  voiceInteractive,
  voice,
}: {
  speechPhase: SpeechPhase;
  voiceInteractive: boolean;
  voice: ReturnType<typeof useVoiceMode>;
}) {
  // Reset the voice idle timer at the END of agent speech: while Nova speaks the
  // turn is held open, and when speech finishes the follow-up window restarts.
  const prevSpeechPhaseRef = useRef(speechPhase);
  const voiceActive = voice.active;
  useEffect(() => {
    const prev = prevSpeechPhaseRef.current;
    prevSpeechPhaseRef.current = speechPhase;
    if (voiceInteractive && voiceActive && prev !== "idle" && speechPhase === "idle") {
      markVoiceInput();
    }
  }, [speechPhase, voiceInteractive, voiceActive]);
}

export function useSpeechOnlyFade({
  hostRef,
  speechOnly,
  speechPhase,
  size,
}: {
  hostRef: RefObject<HTMLDivElement | null>;
  speechOnly: boolean;
  speechPhase: SpeechPhase;
  size: number;
}) {
  // speechOnly fade-in: the host mounts already at the viewport centre, so
  // the visible class is added one frame later for the opacity transition to
  // actually run.
  const [speechOnlyVisible, setSpeechOnlyVisible] = useState(false);
  useEffect(() => {
    if (!speechOnly) return;
    const host = hostRef.current;
    if (host) {
      host.style.setProperty(
        "--nova-avatar-speech-scale",
        speechScaleFor(window.innerWidth, window.innerHeight, size).toFixed(4),
      );
    }
    if (speechPhase === "speaking") {
      const raf = requestAnimationFrame(() => setSpeechOnlyVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setSpeechOnlyVisible(false);
  }, [speechOnly, speechPhase, size]);
  return speechOnlyVisible;
}
