"use client";

import { Tv } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  APPLETV_SWIPE_DEFAULTS,
  APPLETV_SWIPE_RANGES,
  normalizeAppleTvSwipe,
  type AppleTvSwipeSettings,
} from "../../lib/appletv-swipe";
import { ConfigAccordion, SliderControlPanel } from "./ConfigControls";

// Per-knob presentation: label, the readout suffix, and a one-line "what this
// does" caption shown under the slider. Order here is the order on screen.
const FIELDS: {
  key: keyof AppleTvSwipeSettings;
  label: string;
  unit: string;
  caption: string;
  color: [number, number, number];
}[] = [
  {
    key: "hierarchyCharge",
    label: "Back-Out Grip",
    unit: "swipes",
    caption: "Swipes in a row needed to reverse one level out of a menu.",
    color: [255, 0, 187],
  },
  {
    key: "componentGroupCharge",
    label: "Group Grip",
    unit: "swipes",
    caption: "Swipes needed to cross between devices (e.g. aircon → heater).",
    color: [180, 95, 240],
  },
  {
    key: "resetMs",
    label: "Grip Window",
    unit: "ms",
    caption: "How long swipe pressure builds up before it relaxes.",
    color: [120, 130, 255],
  },
  {
    key: "moveIntervalMs",
    label: "Step Interval",
    unit: "ms",
    caption: "Minimum gap between focus moves. Lower feels more sensitive.",
    color: [60, 220, 240],
  },
  {
    key: "detachMs",
    label: "Detach Dwell",
    unit: "ms",
    caption: "Hold time before focus leaves a control on the first push.",
    color: [80, 200, 160],
  },
  {
    key: "nudgePx",
    label: "Rubber-Band Hint",
    unit: "px",
    caption: "How far the focused control nudges before it breaks free. 0 = off.",
    color: [255, 170, 70],
  },
];

export function AppleTvSwipeConfig({
  initialSettings,
}: {
  initialSettings?: Partial<AppleTvSwipeSettings> | null;
}) {
  const [settings, setSettings] = useState<AppleTvSwipeSettings>(() =>
    normalizeAppleTvSwipe(initialSettings ?? APPLETV_SWIPE_DEFAULTS),
  );
  // Guards the load poll from clobbering a value the user is mid-drag on.
  const draggingRef = useRef(false);

  const load = useCallback(async () => {
    if (draggingRef.current) {
      return;
    }
    try {
      const response = await fetch("/api/layout", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Layout settings request failed: ${response.status}`);
      }
      const data = (await response.json()) as { layout?: { swipe?: Partial<AppleTvSwipeSettings> } };
      if (!draggingRef.current) {
        setSettings(normalizeAppleTvSwipe(data.layout?.swipe ?? APPLETV_SWIPE_DEFAULTS));
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load Apple TV swipe settings", error);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const commitField = useCallback(async (key: keyof AppleTvSwipeSettings, value: number) => {
    draggingRef.current = false;
    const next = normalizeAppleTvSwipe({ ...settings, [key]: value });
    setSettings(next);
    try {
      const response = await fetch("/api/layout", {
        body: JSON.stringify({ swipe: { [key]: next[key] } }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Layout settings update failed: ${response.status}`);
      }
      const data = (await response.json()) as { layout?: { swipe?: Partial<AppleTvSwipeSettings> } };
      if (data.layout?.swipe && !draggingRef.current) {
        setSettings(normalizeAppleTvSwipe(data.layout.swipe));
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to update Apple TV swipe settings", error);
    }
  }, [settings]);

  return (
    <ConfigAccordion
      id="appletv-swipe"
      title="Apple TV Expert Settings"
      icon={<Tv className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <p className="mb-4 text-sm leading-relaxed text-neutral-400">
        Tunes the trackpad swipe feel on the Apple TV dashboard — how hard you must
        swipe to back out of a menu or cross between devices, and the rubber-band
        hint the focused control gives before it breaks free. Changes apply live.
      </p>

      <div className="grid gap-4">
        {FIELDS.map((field) => {
          const range = APPLETV_SWIPE_RANGES[field.key];
          const value = settings[field.key];
          return (
            <div key={field.key} className="grid gap-1.5">
              <SliderControlPanel
                ariaLabel={field.label}
                ariaValueText={`${value} ${field.unit}`}
                color={field.color}
                intensity={100}
                label={field.label}
                max={range.max}
                min={range.min}
                step={range.step}
                value={value}
                valueText={field.unit === "swipes" ? `${value}×` : `${value} ${field.unit}`}
                onChange={(next) => {
                  draggingRef.current = true;
                  setSettings((current) => ({ ...current, [field.key]: next }));
                }}
                onCommit={(next) => void commitField(field.key, next)}
              />
              <p className="px-1 text-xs leading-snug text-neutral-500">{field.caption}</p>
            </div>
          );
        })}
      </div>
    </ConfigAccordion>
  );
}
