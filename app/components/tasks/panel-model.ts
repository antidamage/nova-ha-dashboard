import { ALERT_AUDIO_REPEAT_MS, ALERT_AUDIO_WINDOW_MS } from "./constants";

export function alertAudioTimingFromConfig(config: unknown) {
  const root = config as { tasks?: { alertAudio?: { alertWindowMs?: unknown; repeatMs?: unknown } } } | null;
  const audio = root?.tasks?.alertAudio;
  if (!audio) {
    return null;
  }

  const windowMs = audio.alertWindowMs;
  const repeatMs = audio.repeatMs;

  return {
    windowMs:
      typeof windowMs === "number" && Number.isFinite(windowMs) && windowMs > 0
        ? windowMs
        : ALERT_AUDIO_WINDOW_MS,
    repeatMs:
      typeof repeatMs === "number" && Number.isFinite(repeatMs) && repeatMs > 0
        ? repeatMs
        : ALERT_AUDIO_REPEAT_MS,
  };
}

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
