"use client";

import type { LucideIcon } from "lucide-react";
import type { DashboardZone, SpectrumCursor, SunStatus } from "../../../../lib/types";
import { adaptiveCandlelightLabel } from "../lighting";
import { RuleIcon, triggerRulePreset, useZoneLightRules } from "../zoneLightRulesClient";
import { dashboardEntityIsOn } from "../shared";
import { useZoneLighting, type ZoneActionHandler } from "../useZoneLighting";
import { ZoneColorEncoder } from "../ZoneControls";
import { QUICK_ENCODER_SIZE } from "./dial-model";
import { QuickButton, QuickSegment } from "./QuickSegment";

/** The Home zone's single colour control plus Candlelight and Off. */
export function QuickLightsSegment({
  knobSkin,
  size = QUICK_ENCODER_SIZE,
  spectrumCursor,
  sun,
  zone,
  onZoneAction,
}: {
  /** Forwarded to ColorEncoder; see DeviceTheme.knobSkin, specs/color-encoder.md. */
  knobSkin?: "auto" | "dark" | "light";
  /** Dial diameter; the card shrinks it to fit a narrow portrait screen. */
  size?: number;
  spectrumCursor?: SpectrumCursor;
  sun?: SunStatus | null;
  zone: DashboardZone;
  onZoneAction: ZoneActionHandler;
}) {
  const lighting = useZoneLighting({ spectrumCursor, sun, zone, onZoneAction });
  const lightEntities = zone.entities.filter((entity) => entity.domain === "light");
  const hasActiveLights = lightEntities.some(dashboardEntityIsOn);
  const presetLabel = adaptiveCandlelightLabel(sun);
  const { presets: rulePresets } = useZoneLightRules(zone.id);

  return (
    <QuickSegment className="quick-segment-lights" label={`${zone.name} lights`}>
      <div className="quick-segment-lead">
        <ZoneColorEncoder
          brightness={lighting.brightness}
          className="quick-access-encoder"
          colorEnabled={hasActiveLights}
          disabled={!lighting.hasLightDevices}
          knobSkin={knobSkin}
          label="All lights"
          size={size}
          spectrum={lighting.spectrum}
          zoneId={zone.id}
          onBrightnessChange={lighting.setLocalBrightness}
          onBrightnessCommit={(value) => void lighting.commitBrightness(value)}
          onColorCommit={(rgb, brightnessPct, cursor) => void lighting.commitColor(rgb, brightnessPct, cursor)}
          onSpectrumChange={lighting.rememberSpectrum}
        />
      </div>
      <div className="quick-button-pair">
        {/* The zone's rule presets, as on its card, without On: the dial is
            already how this card turns the lights on (specs/zone-light-events.md). */}
        {rulePresets.filter((rule) => !(rule.kind === "preset" && rule.builtin === "on")).map((rule) => {
          const off = rule.kind === "preset" && rule.builtin === "off";
          return (
            <QuickButton
              key={rule.id}
              disabled={off ? !lighting.hasLightDevices && zone.counts.switch === 0 : !lighting.hasLightDevices}
              icon={((props: { className?: string }) => <RuleIcon rule={rule} className={props.className} />) as unknown as LucideIcon}
              iconOnly
              label={rule.kind === "adaptive" ? presetLabel : rule.name ?? "Preset"}
              onClick={() => void triggerRulePreset(rule, {
                applyPreset: lighting.applyPreset,
                setLocalBrightness: lighting.setLocalBrightness,
                rememberSpectrum: lighting.rememberSpectrum,
                onZoneAction,
              })}
            />
          );
        })}
      </div>
    </QuickSegment>
  );
}
