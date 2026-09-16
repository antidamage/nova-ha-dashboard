"use client";

import { useEffect, useRef, useState } from "react";
import type { BedroomHeaterMode, BedroomHeaterPreferences } from "../../../../lib/types";
import {
  BEDROOM_HEATER_MAX_TARGET_C,
  BEDROOM_HEATER_MIN_TARGET_C,
  bedroomHeaterMode,
  bedroomHeaterTargetTemperature,
} from "../../../../lib/bedroom-heater-control";
import { formatTemperature } from "../shared";
import { AIRCON_TEMPERATURE_SEND_DEBOUNCE_MS, CLIMATE_MODE_COMMIT_DEBOUNCE_MS } from "./constants";
import { saveBedroomHeater } from "./client";

/**
 * The bedroom heater's mode, target and sleep-timer writes.
 *
 * Mode and target were optimistic — applied locally before the server agreed.
 * A heater is not a light: showing "Off" over a running 2 kW element because a
 * POST silently hung is the failure that sent Adeline looking for a schedule
 * that had already been deleted. The card now shows the server's value, plus a
 * pending marker while a save is in flight, and reverts loudly if it fails.
 * See specs/bedroom-heater-control-integrity.md §2.
 */
export function useBedroomHeaterCommands({
  onNotice,
  preferences,
}: {
  onNotice?: (message: string) => void;
  preferences?: BedroomHeaterPreferences;
}) {
  const persistedMode = bedroomHeaterMode(preferences);
  const persistedTarget = bedroomHeaterTargetTemperature(preferences);

  const [mode, setMode] = useState<BedroomHeaterMode>(persistedMode);
  const [target, setTarget] = useState(persistedTarget);
  const [pending, setPending] = useState<{ mode?: BedroomHeaterMode; target?: number } | null>(null);
  const temperatureSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeSaveSequence = useRef(0);

  const persistedTimerEndsAt = typeof preferences?.offTimerEndsAt === "string" ? preferences.offTimerEndsAt : null;
  const [localTimerEndsAt, setLocalTimerEndsAt] = useState<string | null>(persistedTimerEndsAt);

  useEffect(() => {
    setMode(persistedMode);
  }, [persistedMode]);

  useEffect(() => {
    setTarget(persistedTarget);
  }, [persistedTarget]);

  useEffect(() => {
    setLocalTimerEndsAt(persistedTimerEndsAt);
  }, [persistedTimerEndsAt]);

  useEffect(() => {
    return () => {
      if (temperatureSendTimerRef.current) {
        clearTimeout(temperatureSendTimerRef.current);
      }
    };
  }, []);

  // iOS suspends a home-screen web app rather than unmounting it, so the cleanup
  // above never runs when the phone is locked. A debounced target armed in the
  // last two seconds before that would sit frozen and then fire on resume —
  // hours later — writing a stale target over whatever the server held by then.
  // A queued save is discarded on hide; the card re-syncs from the server on
  // resume instead. See specs/bedroom-heater-control-integrity.md §3.
  useEffect(() => {
    const discardQueuedSave = () => {
      if (temperatureSendTimerRef.current) {
        clearTimeout(temperatureSendTimerRef.current);
        temperatureSendTimerRef.current = null;
        setTarget(persistedTarget);
        setPending(null);
      }
    };

    // pagehide gets its own unconditional handler. Gating it on
    // visibilityState === "hidden" made it dead code on exactly the path it
    // exists for: Safari can fire pagehide (bfcache, app quit) without a
    // preceding visibility transition, and that is the suspension that strands
    // a queued save until resume.
    const discardOnHidden = () => {
      if (document.visibilityState === "hidden") discardQueuedSave();
    };

    document.addEventListener("visibilitychange", discardOnHidden);
    window.addEventListener("pagehide", discardQueuedSave);
    return () => {
      document.removeEventListener("visibilitychange", discardOnHidden);
      window.removeEventListener("pagehide", discardQueuedSave);
    };
  }, [persistedTarget]);

  const chooseMode = (next: BedroomHeaterMode) => {
    if (next === mode) {
      return Promise.resolve();
    }
    // Off means the heater is off, so a pending sleep timer has nothing left to
    // do; it would otherwise fire over a later Auto.
    const clearTimer = next === "off" && localTimerEndsAt !== null;
    // Last request wins, not last response. Two quick taps (Auto then Off) fire
    // two independent POSTs; without this the Auto reply landing second would
    // repaint the card to Auto over the user's Off — the card asserting a state
    // the server does not hold, which is the whole failure this spec exists to
    // close. Only the newest tap may write mode.
    const sequence = modeSaveSequence.current + 1;
    modeSaveSequence.current = sequence;
    const isCurrent = () => modeSaveSequence.current === sequence;

    setPending((current) => ({ ...current, mode: next }));
    if (clearTimer) {
      setLocalTimerEndsAt(null);
    }
    // Auto hands over to the server thermostat, which the save evaluates
    // immediately — pressing Auto must not itself force the element on, only
    // ask the thermostat to decide. Off drives the switch directly.
    return saveBedroomHeater(clearTimer ? { mode: next, offTimerEndsAt: null } : { mode: next })
      .then((saved) => {
        if (isCurrent()) setMode(bedroomHeaterMode(saved));
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        setMode(persistedMode);
        if (clearTimer) {
          setLocalTimerEndsAt(persistedTimerEndsAt);
        }
        onNotice?.(
          `Heater ${next === "off" ? "Off" : "Auto"} did not save — still ${persistedMode === "off" ? "Off" : "Auto"}. ${
            error instanceof Error ? error.message : "Save failed"
          }`,
        );
      })
      .finally(() => {
        if (isCurrent()) {
          setPending((current) => (current ? { ...current, mode: undefined } : null));
        }
      });
  };

  // Same debounce shape as the air conditioner's target: only the last value is
  // ever sent, and the auto loop picks it up on its next tick.
  const changeTarget = async (next: number) => {
    const clamped = Math.min(BEDROOM_HEATER_MAX_TARGET_C, Math.max(BEDROOM_HEATER_MIN_TARGET_C, next));
    setPending((current) => ({ ...current, target: clamped }));
    if (temperatureSendTimerRef.current) {
      clearTimeout(temperatureSendTimerRef.current);
    }
    temperatureSendTimerRef.current = setTimeout(() => {
      temperatureSendTimerRef.current = null;
      void saveBedroomHeater({ temperature: clamped })
        .then((saved) => {
          setTarget(bedroomHeaterTargetTemperature(saved));
        })
        .catch((error: unknown) => {
          setTarget(persistedTarget);
          onNotice?.(
            `Heater target did not save — still ${formatTemperature(persistedTarget)}. ${
              error instanceof Error ? error.message : "Save failed"
            }`,
          );
        })
        .finally(() => {
          setPending((current) => (current ? { ...current, target: undefined } : null));
        });
    }, AIRCON_TEMPERATURE_SEND_DEBOUNCE_MS);
  };

  // Expiry is enforced by the unified server climate controller, not
  // here: the whole point of a bedroom sleep timer is that it fires with every
  // dashboard client asleep. This side only sets and displays it.
  const setOffTimer = (offTimerEndsAt: string | null) => {
    setLocalTimerEndsAt(offTimerEndsAt);
    void saveBedroomHeater({ offTimerEndsAt }).catch(() => {
      setLocalTimerEndsAt(persistedTimerEndsAt);
    });
  };

  // ── The temperature knob (specs/temperature-encoder.md) ───────────────────

  // The knob's lights move on the tap and the mode is saved once the taps
  // settle, as on the air conditioner. The heater has two lights, Auto and Off.
  const [pendingMode, setPendingMode] = useState<BedroomHeaterMode | null>(null);
  const modeCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRunStartRef = useRef<BedroomHeaterMode | null>(null);

  useEffect(() => {
    return () => {
      if (modeCommitTimerRef.current) {
        clearTimeout(modeCommitTimerRef.current);
      }
    };
  }, []);

  const chooseModeAfterTaps = (next: BedroomHeaterMode) => {
    if (modeRunStartRef.current === null) {
      modeRunStartRef.current = mode;
    }
    setPendingMode(next);
    if (modeCommitTimerRef.current) {
      clearTimeout(modeCommitTimerRef.current);
    }
    modeCommitTimerRef.current = setTimeout(() => {
      modeCommitTimerRef.current = null;
      const from = modeRunStartRef.current;
      modeRunStartRef.current = null;
      setPendingMode(null);
      if (next !== from) {
        void chooseMode(next);
      }
    }, CLIMATE_MODE_COMMIT_DEBOUNCE_MS);
  };

  const [timerNow, setTimerNow] = useState(() => Date.now());
  const offTimerEndsAtMs = localTimerEndsAt ? new Date(localTimerEndsAt).getTime() : null;
  const offTimerMinutes = offTimerEndsAtMs === null || !Number.isFinite(offTimerEndsAtMs)
    ? 0
    : Math.max(0, Math.ceil((offTimerEndsAtMs - timerNow) / 60000));

  useEffect(() => {
    if (offTimerEndsAtMs === null) {
      return;
    }

    setTimerNow(Date.now());
    const timer = window.setInterval(() => {
      setTimerNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [offTimerEndsAtMs]);

  /** The timer ring's value: 0 clears it, and anything else starts the heater. */
  const setOffTimerMinutes = async (minutes: number) => {
    if (minutes <= 0) {
      setOffTimer(null);
      return;
    }
    if (mode === "off") {
      await chooseMode("auto");
    }
    setOffTimer(new Date(Date.now() + minutes * 60000).toISOString());
  };

  return {
    changeTarget,
    chooseMode,
    chooseModeAfterTaps,
    localTimerEndsAt,
    mode,
    /** What the knob's lights show: the tapped mode until it is saved. */
    displayedMode: pendingMode ?? mode,
    /** The target to display: an unsaved tap while it is in flight, else the server's. */
    displayedTarget: pending?.target ?? target,
    offTimerMinutes,
    setOffTimer,
    setOffTimerMinutes,
  };
}
