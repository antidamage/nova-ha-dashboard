"use client";

import { Flame, PartyPopper, Power, PowerOff, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DashboardPreferences,
  ClimateControlState,
  DashboardZone,
  RouterStatus,
  SpectrumCursor,
  SunStatus,
  WeatherStatus,
} from "../../../lib/types";
import type { EntityActionInput } from "../../../lib/aircon-control";
import { ColorEncoder, type ColorEncoderChannel } from "../ColorEncoder";
import { hsvToRgb, rgbToHsv, type Hsva } from "../colorEncoderModel";
import { BedroomTemperaturePanel, LoungeEnvironmentPanel } from "./EnvironmentPanels";
import { AdvancedFold } from "./AdvancedFold";
import { IconButton } from "./IconButton";
import { LabeledSlideSwitch } from "../SlideSwitch";
import { ZoneLightEvents } from "./ZoneLightEvents";
import { selectPrimaryZonePanel } from "./panel-registry";
import { ModuleSlot } from "../modules/ModuleSlot";
import {
  countDomainsForZone,
  dashboardEntityIsOn,
  isBedroomZone,
  isLoungeZone,
  type BedroomHeaterDevices,
  type LoungeEnvironment,
} from "./shared";
import {
  BRIGHTNESS_CONVERGENCE_TOLERANCE_PCT,
  CANDLELIGHT_SPECTRUM,
  LIGHT_REMOTE_SETTING_HOLD_MS,
  WHITE_SPECTRUM,
  adaptiveCandlelightLabel,
  adaptiveCandlelightSpectrum,
  candlelightBrightnessPct,
  spectrumFromZone,
  spectrumWithCursor,
  type SpectrumValue,
} from "./lighting";
import { useRemoteSetting } from "./useRemoteSetting";

/**
 * House Party for one zone: the visualiser may animate this zone's lights.
 * Lives in the zone's Advanced section (specs/advanced-fold.md); the master
 * switch stays on the Visualiser config page.
 */
function HousePartyControl({
  disabled,
  enabled,
  onToggle,
}: {
  disabled: boolean;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="zone-party-control border border-fuchsia-400/30 bg-fuchsia-950/20 p-4">
      <div className="zone-party-control-row">
        <span className="zone-party-control-label">
        <PartyPopper className="h-6 w-6 text-fuchsia-300" aria-hidden="true" />
          House Party
        </span>
        <LabeledSlideSwitch
          checked={enabled}
          disabled={disabled}
          icon={<PartyPopper className="h-4 w-4" />}
          label="House Party"
          onChange={onToggle}
        />
      </div>
    </section>
  );
}

/**
 * Whether a zone's reported brightness has reached what was set. The zone value
 * is an average over its lit fixtures, so allow for per-fixture rounding of the
 * commanded percent into Home Assistant's `0..255` scale.
 */
function brightnessPctConverged(remotePct: number, localPct: number) {
  return Math.abs(remotePct - localPct) <= BRIGHTNESS_CONVERGENCE_TOLERANCE_PCT;
}

function spectrumValuesEqual(left: SpectrumValue, right: SpectrumValue) {
  return (
    left.cursor.x === right.cursor.x &&
    left.cursor.y === right.cursor.y &&
    left.preview[0] === right.preview[0] &&
    left.preview[1] === right.preview[1] &&
    left.preview[2] === right.preview[2]
  );
}

/**
 * The zone's one colour-and-level control: a 200px `ColorEncoder`
 * (specs/color-encoder.md). Hue and saturation become `rgb_color` at full
 * value; the brightness light is the zone's `brightness_pct`. There is no
 * second brightness control on the card.
 *
 * With every light off, hue and saturation are inert — a colour command would
 * otherwise turn the zone on in a colour nobody could see being chosen — but
 * brightness still works, since raising it is how the zone comes back on.
 */
export function ZoneColorEncoder({
  brightness,
  className,
  colorEnabled,
  disabled,
  knobSkin,
  label = "Lights",
  size = 200,
  spectrum,
  zoneId,
  onBrightnessChange,
  onBrightnessCommit,
  onColorCommit,
  onSpectrumChange,
}: {
  brightness: number;
  /** Added to the wrapper, for surfaces that lay the dial out differently. */
  className?: string;
  colorEnabled: boolean;
  disabled: boolean;
  /** Forwarded to ColorEncoder; see DeviceTheme.knobSkin, specs/color-encoder.md. */
  knobSkin?: "auto" | "dark" | "light";
  label?: string;
  /** Dial diameter in px; the zone card uses 200, Quick Access 56. */
  size?: number;
  spectrum: SpectrumValue;
  zoneId: string;
  onBrightnessChange: (value: number) => void;
  onBrightnessCommit: (value: number) => void;
  onColorCommit: (rgb: [number, number, number], brightnessPct: number, cursor: SpectrumCursor) => void;
  onSpectrumChange: (value: SpectrumValue) => void;
}) {
  // Lighting opens on brightness: dimming a room is what this card is reached
  // for, colour far less often (Adeline, 2026-09-11).
  const channelRef = useRef<ColorEncoderChannel>("brightness");
  // Grey and white carry no hue. Remember the last real one so turning
  // saturation down to zero and back up does not snap the dial to red.
  const hueMemory = useRef<Record<string, number>>({});
  const derived = rgbToHsv(spectrum.preview);
  if (derived.s >= 1) hueMemory.current[zoneId] = derived.h;
  const value: Hsva = {
    h: derived.s >= 1 ? derived.h : hueMemory.current[zoneId] ?? derived.h,
    s: derived.s,
    v: brightness,
    a: 100,
  };

  const spectrumFor = (next: Hsva): SpectrumValue => ({
    cursor: { x: next.h / 359, y: 1 - next.s / 100 },
    preview: hsvToRgb(next.h, next.s, 100),
  });

  return (
    <div className={className ? `zone-color-encoder ${className}` : "zone-color-encoder"}>
      <ColorEncoder
        ariaLabel="Zone lights"
        defaultChannel="brightness"
        demoTooltipTitle="Lights"
        demoTooltip="Tap to switch between brightness, saturation and hue. Turn it like a knob."
        disabled={disabled}
        knobSkin={knobSkin}
        label={label}
        size={size}
        value={value}
        onActiveChannelChange={(channel) => {
          channelRef.current = channel;
        }}
        onChange={(next) => {
          if (channelRef.current === "brightness") {
            onBrightnessChange(Math.round(next.v));
            return;
          }
          if (!colorEnabled) return;
          if (next.s >= 1) hueMemory.current[zoneId] = next.h;
          onSpectrumChange(spectrumFor(next));
        }}
        onCommit={(next) => {
          if (channelRef.current === "brightness") {
            onBrightnessCommit(Math.round(next.v));
            return;
          }
          if (!colorEnabled) return;
          const committed = spectrumFor(next);
          onColorCommit(committed.preview, Math.round(next.v) || 100, committed.cursor);
        }}
      />
    </div>
  );
}

export function ZoneControls({
  bedroomHeater,
  bedroomTemperature,
  climateControl,
  desktopSleepBusy,
  desktopWakeBusy,
  knobSkin,
  loungeEnvironment,
  sun,
  zone,
  onDesktopSleep,
  onDesktopWake,
  onEntityActions,
  onNotice,
  onZoneAction,
  preferences,
  router,
  spectrumCursor,
  weather,
}: {
  bedroomHeater?: BedroomHeaterDevices;
  bedroomTemperature?: number | null;
  climateControl?: ClimateControlState;
  desktopSleepBusy?: boolean;
  desktopWakeBusy?: boolean;
  /** Forwarded to ColorEncoder; see DeviceTheme.knobSkin, specs/color-encoder.md. */
  knobSkin?: "auto" | "dark" | "light";
  loungeEnvironment?: LoungeEnvironment | null;
  sun?: SunStatus | null;
  zone: DashboardZone;
  onDesktopSleep?: (computer: { id: string; name: string }) => void;
  onDesktopWake?: (computer: { id: string; name: string }) => void;
  onEntityActions: (actions: EntityActionInput[], toast: string) => Promise<void>;
  /** Surface a message without issuing a command — used for save failures. */
  onNotice?: (message: string) => void;
  onZoneAction: (action: string, body?: Record<string, unknown>) => Promise<void>;
  preferences?: DashboardPreferences;
  router?: RouterStatus;
  spectrumCursor?: SpectrumCursor;
  weather?: WeatherStatus | null;
}) {
  const spectrumByZone = useRef<Record<string, SpectrumValue>>({});
  const remoteSpectrum = useMemo(
    () => spectrumWithCursor(spectrumFromZone(zone), spectrumCursor) ?? spectrumByZone.current[zone.id] ?? CANDLELIGHT_SPECTRUM,
    [spectrumCursor?.x, spectrumCursor?.y, zone],
  );
  // While the zone is mid-transition the server publishes where it is going, so
  // the control binds to that target rather than to the averaged waypoint the
  // fixtures currently report. A client that did not issue the command therefore
  // shows the destination immediately instead of watching the fade.
  const { setLocalValue: setLocalBrightness, value: brightness } = useRemoteSetting({
    isConverged: brightnessPctConverged,
    isTransitional: Boolean(zone.brightnessTransition),
    key: zone.id,
    remoteValue: zone.brightnessTransition?.targetPct ?? zone.brightnessPct,
  });
  const { setLocalValue: setLocalSpectrum, value: spectrum } = useRemoteSetting({
    isEqual: spectrumValuesEqual,
    key: zone.id,
    onRemoteAccept: (value) => {
      spectrumByZone.current[zone.id] = value;
    },
    remoteValue: remoteSpectrum,
    timeoutMs: LIGHT_REMOTE_SETTING_HOLD_MS,
  });
  const bedroomZone = isBedroomZone(zone);
  const loungeZone = isLoungeZone(zone);
  // A primary panel (power/network/climate/outside) takes over the whole zone
  // body; otherwise this is a lighting zone with the spectrum/intensity controls.
  const primaryPanel = selectPrimaryZonePanel(zone);
  const lightingZone = !primaryPanel;
  const lightEntities = useMemo(
    () => (lightingZone ? zone.entities.filter((entity) => entity.domain === "light") : []),
    [lightingZone, zone.entities],
  );
  const hasLightDevices = lightEntities.length > 0;
  const hasActiveLights = lightEntities.some(dashboardEntityIsOn);
  // House Party, back in the zone panel after a concurrent session's WIP
  // commit dropped it while its backend stayed live (specs/landscape-layout.md).
  const persistedHouseParty = preferences?.lighting?.housePartyZones?.[zone.id]?.enabled ?? false;
  const [housePartyEnabled, setHousePartyEnabled] = useState(persistedHouseParty);
  const [housePartyBusy, setHousePartyBusy] = useState(false);

  useEffect(() => {
    setHousePartyEnabled(persistedHouseParty);
  }, [persistedHouseParty, zone.id]);

  const toggleHouseParty = useCallback(async () => {
    const enabled = !housePartyEnabled;
    setHousePartyEnabled(enabled);
    setHousePartyBusy(true);
    try {
      const response = await fetch(`/api/phonoscope/house-party/zones/${encodeURIComponent(zone.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("House Party setting failed");
    } catch {
      setHousePartyEnabled(!enabled);
    } finally {
      setHousePartyBusy(false);
    }
  }, [housePartyEnabled, zone.id]);
  const rememberSpectrum = useCallback(
    (value: SpectrumValue) => {
      spectrumByZone.current[zone.id] = value;
      setLocalSpectrum(value);
    },
    [setLocalSpectrum, zone.id],
  );

  const applyPresetAction = useCallback(
    (action: "on" | "candlelight" | "white") => {
      const nextSpectrum = action === "white" ? WHITE_SPECTRUM : adaptiveCandlelightSpectrum(sun);
      const nextBrightness = action === "white" ? 100 : candlelightBrightnessPct(sun);
      setLocalBrightness(nextBrightness);
      rememberSpectrum(nextSpectrum);
      onZoneAction(action, { brightnessPct: nextBrightness, cursor: nextSpectrum.cursor, rgb: nextSpectrum.preview });
    },
    [onZoneAction, rememberSpectrum, setLocalBrightness, sun],
  );

  const adaptivePresetLabel = adaptiveCandlelightLabel(sun);

  return (
    <section data-lighting-zone={lightingZone || undefined} className="zone-panel relative flex min-h-[620px] flex-col border border-neutral-700 bg-neutral-950/70 p-5 shadow-2xl">
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      <header className="zone-panel-header flex flex-col gap-4">
        <div className="min-w-0">
          <p className="zone-panel-kicker text-sm font-black uppercase text-cyan-300">Zone Control</p>
          {/* No device-count chips (Adeline, 2026-09-12): how many lights,
              switches or climate devices a zone holds is not something she
              ever wants to read. */}
          <h1 className="zone-panel-title mt-1 text-4xl font-black uppercase text-neutral-50 sm:text-5xl">{zone.name}</h1>
        </div>
      </header>

      <div className="mt-8 grid gap-5">
        <div className="lighting-column grid gap-5">
          {primaryPanel ? (
            primaryPanel.render({
              zone,
              desktopSleepBusy,
              desktopWakeBusy,
              router,
              weather,
              preferences,
              loungeEnvironment,
              bedroomHeater,
              climateControl,
              sun,
              spectrumCursor,
              knobSkin,
              onDesktopSleep,
              onDesktopWake,
              onEntityActions,
              onZoneAction,
              onNotice,
            })
          ) : (
            <AdvancedFold
              advanced={
                <>
                  {bedroomZone ? <BedroomTemperaturePanel temperature={bedroomTemperature ?? null} /> : null}
                  {loungeZone ? <LoungeEnvironmentPanel environment={loungeEnvironment ?? null} /> : null}
                  <HousePartyControl
                    disabled={!hasLightDevices}
                    enabled={housePartyEnabled}
                    onToggle={toggleHouseParty}
                  />
                  <ZoneLightEvents lights={lightEntities} zone={zone} />
                </>
              }
            >
              <div className="zone-lighting-controls">
                <ZoneColorEncoder
                  brightness={brightness}
                  colorEnabled={hasActiveLights}
                  disabled={!hasLightDevices}
                  knobSkin={knobSkin}
                  spectrum={spectrum}
                  zoneId={zone.id}
                  onBrightnessChange={setLocalBrightness}
                  onBrightnessCommit={(value) => onZoneAction("brightness", { brightnessPct: value })}
                  onColorCommit={(rgb, brightnessPct, cursor) => onZoneAction("color", { rgb, brightnessPct, cursor })}
                  onSpectrumChange={rememberSpectrum}
                />
                <div className="zone-lighting-presets" role="group" aria-label="Lighting presets">
                  <IconButton label={`On: ${adaptivePresetLabel}`} disabled={!hasLightDevices} variant="yellow" onClick={() => applyPresetAction("on")}>
                    <Power aria-hidden="true" /><span>On</span>
                  </IconButton>
                  <IconButton
                    label={adaptivePresetLabel}
                    disabled={!hasLightDevices}
                    variant="yellow"
                    onClick={() => applyPresetAction("candlelight")}
                  >
                    <Flame aria-hidden="true" /><span>Adaptive</span>
                  </IconButton>
                  <IconButton
                    label="White"
                    disabled={!hasLightDevices}
                    variant="white"
                    onClick={() => applyPresetAction("white")}
                  >
                    <Sun aria-hidden="true" /><span>White</span>
                  </IconButton>
                  <IconButton label="Off" disabled={!hasLightDevices && zone.counts.switch === 0} variant="pink" onClick={() => onZoneAction("off")}>
                    <PowerOff aria-hidden="true" /><span>Off</span>
                  </IconButton>
                </div>
              </div>
            </AdvancedFold>
          )}
        </div>
        <ModuleSlot id="zone.controls.after" context={{ zone }} />
      </div>
    </section>
  );
}
