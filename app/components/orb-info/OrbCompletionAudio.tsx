"use client";
import { useEffect, useRef } from "react";
import { timerSoundSlot } from "../../../lib/orb-timer-model";
import { useDeviceTheme } from "../accentColor";
import { useOrbSettings } from "./useOrbSettings";
import { useOrbTimer } from "./useOrbTimer";
import { playUxSound, resolveUxSoundUrl } from "../dashboard/controlSound";
/**
 * The one sounding a finished countdown has. It is generic on purpose: the
 * washing machine's notification is an ordinary household timer
 * (specs/power-meters.md, "The wash's timer"), so a completed wash arrives here
 * as a timer and needs nothing of its own.
 */
export function OrbCompletionAudio() {
  const { timer, now } = useOrbTimer();
  const { hasTimer } = useOrbSettings();
  const { theme } = useDeviceTheme();
  const liveIds = useRef(new Set<string>());
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set<string>();
    // The chime goes through the Web Audio engine the rest of the UX sounds
    // use, not a fresh HTMLAudioElement: an element created minutes after the
    // last gesture is subject to the browser's autoplay policy and was silently
    // refused, so a completed timer made no sound at all even though it had
    // claimed the chime slot. The engine's AudioContext is already running from
    // an earlier press (specs/ux-sounds.md, "Playback").
    const play = async (id: string, key: string, claimUrl: string, body: object) => {
      live.add(id);
      if (attempted.current.has(key)) return;
      attempted.current.add(key);
      try {
        const response = await fetch(claimUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error("Chime claim failed");
        if ((await response.json()).claimed && liveIds.current.has(id)) playUxSound("timerAlert");
      } catch { attempted.current.delete(key); }
    };
    const slot = timerSoundSlot(timer, now);
    // The chime is whatever the theme assigns to `timerAlert`. null means None:
    // stay silent, and do not claim the chime either, so no screen is left
    // thinking it played.
    const timerUrl = resolveUxSoundUrl("timerAlert");
    if (timer && slot !== null && timerUrl) void play(timer.id, `${timer.id}:${hasTimer ? slot : "once"}`,
      "/api/orb-timer", { command: "chime", id: timer.id, slot });
    liveIds.current = live;
  }, [timer, now, hasTimer, theme.uxSounds]);
  useEffect(() => () => { liveIds.current.clear(); }, []);
  return null;
}
