import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeviceTheme } from "../accentColor";
import { resolveUxSoundUrl } from "../dashboard/controlSound";
import { loadSharedClientConfig, readCachedClientConfig } from "../sharedConfigCache";
import { ALERT_AUDIO_REPEAT_MS, ALERT_AUDIO_WINDOW_MS } from "./constants";
import { alertAudioTimingFromConfig } from "./panel-model";
import { jsonFetch } from "./task-api";
import type { TaskAudioStatus } from "./types";

/**
 * The reminder alert's chime: whether a clip exists, which clip the theme
 * assigns, the configured window and repeat cadence, and the play/stop/repeat
 * callbacks. Moved out of useTaskAlerts as is.
 */
export function useAlertAudio() {
  const [audioTiming, setAudioTiming] = useState({
    windowMs: ALERT_AUDIO_WINDOW_MS,
    repeatMs: ALERT_AUDIO_REPEAT_MS,
  });
  const audioWindowMs = audioTiming.windowMs;
  const audioRepeatMs = audioTiming.repeatMs;
  const [taskAudioExists, setTaskAudioExists] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Which clip the reminder alert plays, per the theme's assignment. Recomputed
  // when the assignments or the theme's own control sound change; null means
  // the action is set to None (specs/ux-sounds.md).
  const { theme: soundTheme } = useDeviceTheme();
  const reminderAlertUrl = useMemo(
    () => resolveUxSoundUrl("reminderAlert"),
    [soundTheme.uxSounds],
  );
  const audioStopTimer = useRef<number | null>(null);
  const audioRepeatTimer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;

    void jsonFetch<TaskAudioStatus>("/api/tasks/audio?status=1", { cache: "no-store" })
      .then((payload) => {
        if (alive) {
          setTaskAudioExists(payload.exists);
        }
      })
      .catch(() => {
        if (alive) {
          setTaskAudioExists(false);
        }
      });

    return () => {
      alive = false;
    };
  }, []);

  const stopAudio = useCallback(() => {
    if (audioStopTimer.current !== null) {
      window.clearTimeout(audioStopTimer.current);
      audioStopTimer.current = null;
    }

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const clearAudioCadence = useCallback(() => {
    if (audioRepeatTimer.current !== null) {
      window.clearInterval(audioRepeatTimer.current);
      audioRepeatTimer.current = null;
    }
    stopAudio();
  }, [stopAudio]);

  const playAudioWindow = useCallback(() => {
    if (!taskAudioExists || !reminderAlertUrl) {
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    stopAudio();
    audio.currentTime = 0;
    audio.play().catch((error) => {
      console.info("[nova-dashboard] task alert audio blocked or unavailable", error);
    });
    audioStopTimer.current = window.setTimeout(stopAudio, audioWindowMs);
  }, [audioWindowMs, reminderAlertUrl, stopAudio, taskAudioExists]);

  const startAudioCadence = useCallback(
    (annoy: boolean) => {
      if (!taskAudioExists) {
        clearAudioCadence();
        return;
      }

      clearAudioCadence();
      playAudioWindow();

      // Only a reminder explicitly marked as an annoyer nags. Everything else
      // gets exactly one chime per occurrence, household-wide -- see
      // `hasTaskAlertChimed`. The banner (where enabled) still waits to be
      // tapped; it just does so quietly.
      if (annoy) {
        audioRepeatTimer.current = window.setInterval(playAudioWindow, audioRepeatMs);
      }
    },
    [audioRepeatMs, clearAudioCadence, playAudioWindow, taskAudioExists],
  );

  useEffect(() => {
    const apply = (config: unknown) => {
      const timing = alertAudioTimingFromConfig(config);
      if (timing) {
        setAudioTiming(timing);
      }
    };

    apply(readCachedClientConfig());
    void loadSharedClientConfig().then(apply).catch(() => {
      // Falling back to the compiled-in cadence is fine; this is a sound.
    });
  }, []);

  return { audioRef, clearAudioCadence, reminderAlertUrl, setTaskAudioExists, startAudioCadence, taskAudioExists };
}
