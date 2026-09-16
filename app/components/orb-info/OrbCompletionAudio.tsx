"use client";
import { useEffect, useRef } from "react";
import type { Task } from "../../../lib/types";
import { washReminder } from "../../../lib/wash-reminder";
import { timerSoundSlot } from "../../../lib/orb-timer-model";
import { useDeviceTheme } from "../accentColor";
import { useOrbSettings } from "./useOrbSettings";
import { useOrbTimer } from "./useOrbTimer";
import { playUxSound, resolveUxSoundUrl } from "../dashboard/controlSound";
export function OrbCompletionAudio({ tasks }: { tasks: Task[] }) {
  const { timer, now } = useOrbTimer();
  const { hasTimer, hasWashing } = useOrbSettings();
  const { theme } = useDeviceTheme();
  const liveIds = useRef(new Set<string>());
  const attempted = useRef(new Set<string>());
  const sounds = useRef(new Map<string, HTMLAudioElement>());
  useEffect(() => {
    const live = new Set<string>();
    // The timer chime goes through the Web Audio engine the rest of the UX
    // sounds use, not a fresh HTMLAudioElement: an element created minutes
    // after the last gesture is subject to the browser's autoplay policy and
    // was silently refused, so a completed timer made no sound at all even
    // though it had claimed the chime slot. The engine's AudioContext is
    // already running from an earlier press (specs/ux-sounds.md, "Playback").
    const play = async (id: string, key: string, url: string | null, claimUrl: string, body: object) => {
      live.add(id);
      if (attempted.current.has(key)) return;
      attempted.current.add(key);
      try {
        const response = await fetch(claimUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error("Chime claim failed");
        if ((await response.json()).claimed && liveIds.current.has(id)) {
          if (url === null) { playUxSound("timerAlert"); return; }
          sounds.current.get(id)?.pause();
          const audio = new Audio(url); sounds.current.set(id, audio);
          void audio.play().catch(() => undefined);
        }
      } catch { attempted.current.delete(key); }
    };
    const slot = timerSoundSlot(timer, now);
    // The chime is whatever the theme assigns to `timerAlert`. null means None:
    // stay silent, and do not claim the chime either, so no screen is left
    // thinking it played. `null` as the play() url means "use the engine".
    const timerUrl = resolveUxSoundUrl("timerAlert");
    if (timer && slot !== null && timerUrl) void play(timer.id, `${timer.id}:${hasTimer ? slot : "once"}`,
      null, "/api/orb-timer", { command: "chime", id: timer.id, slot });
    for (const task of tasks) {
      if (washReminder(task)?.phase !== "active" || task.dismissedAt || task.alertDismissedAt) continue;
      const elapsed = now - Date.parse(task.start);
      if (elapsed < 0 || (hasWashing && elapsed >= 300_000)) continue;
      void play(task.id, `${task.id}:${hasWashing ? Math.floor(elapsed / 30_000) : "once"}`,
        `/api/power/washing-machine/audio?taskId=${encodeURIComponent(task.id)}`, "/api/power/washing-machine/chime", { taskId: task.id });
    }
    liveIds.current = live;
    for (const [id, audio] of sounds.current) if (!live.has(id)) { audio.pause(); sounds.current.delete(id); }

  }, [timer, now, tasks, hasTimer, hasWashing, theme.uxSounds]);
  useEffect(() => () => { liveIds.current.clear(); for (const audio of sounds.current.values()) audio.pause(); sounds.current.clear(); }, []);
  return null;
}
