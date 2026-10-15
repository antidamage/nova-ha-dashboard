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
import { useSettingCooldown } from "./useSettingCooldown";

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
    key: "firstStepPct",
    label: "First Step",
    unit: "% pad",
    caption: "Swipe distance for the first move. Lower feels more sensitive.",
    color: [60, 220, 240],
  },
  {
    key: "nextStepPct",
    label: "Extra Step",
    unit: "% pad",
    caption: "Further distance for each additional move in one swipe. First + extra = a full-pad swipe moves 2.",
    color: [80, 200, 160],
  },
  {
    key: "flowFirstStepPct",
    label: "Flow First Step",
    unit: "% pad",
    caption: "First-step distance when a swipe follows another in the same direction.",
    color: [120, 130, 255],
  },
  {
    key: "boundaryResistance",
    label: "Group Stickiness",
    unit: "×",
    caption: "Extra distance to cross into another group of the band. 1 = none.",
    color: [180, 95, 240],
  },
  {
    key: "adjustStepPct",
    label: "Dial Step",
    unit: "% pad",
    caption: "Distance per value step when adjusting an unlocked dial.",
    color: [255, 0, 187],
  },
  {
    key: "flickSpeed",
    label: "Flick Speed",
    unit: "pad/s",
    caption: "Lift speed at which a short swipe counts as a flick.",
    color: [255, 170, 70],
  },
  {
    key: "coastSpeedPerItem",
    label: "Coast Speed",
    unit: "pad/s",
    caption: "Extra lift speed needed for each item a flick carries on.",
    color: [240, 200, 80],
  },
  {
    key: "coastMax",
    label: "Coast Limit",
    unit: "items",
    caption: "Most items a flick may carry on after lift. 0 = no coasting.",
    color: [100, 220, 120],
  },
  {
    key: "nudgePx",
    label: "Lean",
    unit: "px",
    caption: "How far the focused control leans toward the swipe. 0 = off.",
    color: [255, 120, 90],
  },
  {
    key: "holdDelayMs",
    label: "Hold Delay",
    unit: "ms",
    caption: "Held clickpad edge: wait before repeating.",
    color: [90, 160, 255],
  },
  {
    key: "repeatMs",
    label: "Hold Repeat",
    unit: "ms",
    caption: "Held clickpad edge: time between repeats.",
    color: [160, 120, 255],
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
  // Guards the load poll from clobbering a value the user is mid-drag on
  // (draggingRef) and for a few seconds after release (the cooldown), so the
  // slider can't rubber-band back before the commit round-trips.
  const draggingRef = useRef(false);
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  const load = useCallback(async () => {
    if (draggingRef.current || isCoolingDown()) {
      return;
    }
    try {
      const response = await fetch("/api/layout", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Layout settings request failed: ${response.status}`);
      }
      const data = (await response.json()) as { layout?: { swipe?: Partial<AppleTvSwipeSettings> } };
      if (!draggingRef.current && !isCoolingDown()) {
        setSettings(normalizeAppleTvSwipe(data.layout?.swipe ?? APPLETV_SWIPE_DEFAULTS));
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load Apple TV swipe settings", error);
    }
  }, [isCoolingDown]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const commitField = useCallback(async (key: keyof AppleTvSwipeSettings, value: number) => {
    draggingRef.current = false;
    markInteraction();
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
  }, [markInteraction, settings]);

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
        Tunes the remote's swipe feel on the Apple TV dashboard — how far a swipe
        must travel to move, how a flick carries on, and how the focused control
        leans as you push. Distances are a share of the touch pad's width.
        Changes apply live.
      </p>

      <div className="grid gap-4">
        {FIELDS.map((field) => {
          const range = APPLETV_SWIPE_RANGES[field.key];
          const value = Math.round(settings[field.key] * 100) / 100;
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
                valueText={field.unit === "×" ? `${value}×` : `${value} ${field.unit}`}
                onPreview={(next) => {
                  draggingRef.current = true;
                  markInteraction();
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
