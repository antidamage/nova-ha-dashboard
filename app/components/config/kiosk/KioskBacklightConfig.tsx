"use client";

import { SunMoon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_KIOSK_BACKLIGHT,
  KIOSK_BRIGHTNESS_MIN,
  KIOSK_DIM_MIN,
  KIOSK_LEVEL_MAX,
  KIOSK_SWALLOW_BELOW_PCT,
  normalizeKioskBacklightSettings,
  type KioskBacklightPeriod,
  type KioskBacklightPeriodName,
  type KioskBacklightSettings,
} from "../../../../lib/kiosk-backlight/settings";
import { CheckboxRow, ConfigAccordion, SliderControlPanel } from "../../ConfigControls";
import { useSettingCooldown } from "../../useSettingCooldown";

// The same accent the Hardware Assistant's slider uses.
const SLIDER_COLOR: [number, number, number] = [60, 220, 240];
const PERIODS: { name: KioskBacklightPeriodName; title: string }[] = [
  { name: "day", title: "Day" },
  { name: "night", title: "Night" },
];

function dimNote(period: KioskBacklightPeriod) {
  if (period.dimPct === 0 && !period.offWhenDim) return "At 0% the page still shows faintly at the lowest backlight.";
  if (period.dimPct < KIOSK_SWALLOW_BELOW_PCT) return "A tap at this level only wakes the screen.";
  return null;
}

/**
 * The kiosk backlight's day and night settings (specs/kiosk-backlight.md).
 * Shared by every screen; only a wall kiosk running the backlight service acts
 * on them.
 */
export function KioskBacklightConfig() {
  const [settings, setSettings] = useState<KioskBacklightSettings>(DEFAULT_KIOSK_BACKLIGHT);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  const load = useCallback(async () => {
    if (isCoolingDown()) return;
    try {
      const response = await fetch("/api/kiosk-backlight", { cache: "no-store" });
      if (!response.ok) throw new Error(`Kiosk backlight request failed: ${response.status}`);
      const data = (await response.json()) as { settings?: unknown };
      if (!isCoolingDown()) setSettings(normalizeKioskBacklightSettings(data.settings));
    } catch (error) {
      console.error("[nova-dashboard] failed to load the kiosk backlight", error);
    }
  }, [isCoolingDown]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const preview = useCallback(
    (name: KioskBacklightPeriodName, patch: Partial<KioskBacklightPeriod>) => {
      markInteraction();
      const next = normalizeKioskBacklightSettings({
        ...settingsRef.current,
        [name]: { ...settingsRef.current[name], ...patch },
      });
      setSettings(next);
      return next;
    },
    [markInteraction],
  );

  const commit = useCallback(
    async (name: KioskBacklightPeriodName, patch: Partial<KioskBacklightPeriod>) => {
      const next = preview(name, patch);
      try {
        const response = await fetch("/api/kiosk-backlight", {
          body: JSON.stringify(next),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!response.ok) throw new Error(`Kiosk backlight update failed: ${response.status}`);
      } catch (error) {
        console.error("[nova-dashboard] failed to save the kiosk backlight", error);
      }
    },
    [preview],
  );

  return (
    <ConfigAccordion
      id="kiosk-backlight"
      title="Kiosk Display"
      icon={<SunMoon className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      <div className="grid gap-4">
        <p className="theme-display-detail">
          For wall kiosks running the backlight service; other screens ignore these. A tap brightens the screen. 30 s
          after the last touch it fades over 30 s to its dim level. Day and night follow sunrise and sunset, as the
          lights do.
        </p>
        {PERIODS.map(({ name, title }) => {
          const period = settings[name];
          const note = dimNote(period);
          return (
            <section key={name} className="grid gap-3" aria-label={`${title} backlight`}>
              <h3 className="theme-display-label zone-title-bar">{title}</h3>
              <SliderControlPanel
                ariaLabel={`${title} brightness`}
                ariaValueText={`${period.brightnessPct} percent`}
                color={SLIDER_COLOR}
                intensity={100}
                label="Brightness"
                max={KIOSK_LEVEL_MAX}
                min={KIOSK_BRIGHTNESS_MIN}
                step={1}
                value={period.brightnessPct}
                valueText={`${period.brightnessPct}%`}
                onPreview={(value) => void preview(name, { brightnessPct: value })}
                onCommit={(value) => void commit(name, { brightnessPct: value })}
              />
              <SliderControlPanel
                ariaLabel={`${title} dim level`}
                ariaValueText={`${period.dimPct} percent`}
                color={SLIDER_COLOR}
                intensity={100}
                label="Dim to"
                max={period.brightnessPct}
                min={KIOSK_DIM_MIN}
                step={1}
                value={period.dimPct}
                valueText={`${period.dimPct}%`}
                onPreview={(value) => void preview(name, { dimPct: value })}
                onCommit={(value) => void commit(name, { dimPct: value })}
              />
              {note ? <p className="theme-display-detail">{note}</p> : null}
              <CheckboxRow
                checked={period.offWhenDim}
                label="Blank the screen when dim"
                detail="2 minutes after it dims: black, at the lowest backlight."
                onChange={(checked) => void commit(name, { offWhenDim: checked })}
              />
            </section>
          );
        })}
      </div>
    </ConfigAccordion>
  );
}
