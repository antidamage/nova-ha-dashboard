"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  DashboardPreferences,
  ClimateControlState,
  DashboardZone,
  RouterStatus,
  SpectrumCursor,
  SunStatus,
  WeatherStatus,
} from "../../../../lib/types";
import type { EntityActionInput } from "../../../../lib/aircon-control";
import { AppleTVEncoder } from "../../AppleTVEncoder";
import { PanelAppleTVPresets } from "../appleTVPresets";
import { dialPresetPull } from "../../rotaryEncoderGeometry";
import { BedroomTemperaturePanel, LoungeEnvironmentPanel } from "../EnvironmentPanels";
import { AdvancedFold } from "../AdvancedFold";
import { AppleTVPlaylistEditor } from "./AppleTVPlaylistEditor";
import { IconButton } from "../IconButton";
import { ZoneLightEvents } from "./ZoneLightEvents";
import { ZoneRulePresetRow } from "../zoneLightRulesClient";
import { selectPrimaryZonePanel } from "../panel-registry";
import { ModuleSlot } from "../../modules/ModuleSlot";
import { PanelSlots } from "../panel-slots/PanelSlots";
import {
  countDomainsForZone,
  dashboardEntityIsOn,
  isBedroomZone,
  isLoungeZone,
  type BedroomHeaterDevices,
  type LoungeEnvironment,
} from "../shared";
import {
  CANDLELIGHT_SPECTRUM,
  LIGHT_REMOTE_SETTING_HOLD_MS,
  WHITE_SPECTRUM,
  adaptiveCandlelightLabel,
  adaptiveCandlelightSpectrum,
  candlelightBrightnessPct,
  spectrumFromZone,
  spectrumWithCursor,
  type SpectrumValue,
} from "../lighting";
import { useRemoteSetting } from "../useRemoteSetting";
import { useAppleTVAmp } from "../appleTVAmpClient";
import { HousePartyControl } from "./HousePartyControl";
import { ZoneColorEncoder } from "./ZoneColorEncoder";
import { brightnessPctConverged, spectrumValuesEqual } from "./zone-model";

/**
 * The Lounge's two dials: half the 200px dial a lighting zone shows on its own
 * (Adeline, 2026-09-22), so the amplifier dial fits beside it. 100px is the
 * temperature knob's own floor and comfortably inside the colour dial's 50–200.
 */
export const LOUNGE_PAIR_DIAL_SIZE = 100;

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
  const amp = useAppleTVAmp();
  // The dial's preset row takes back the air under a titled dial's box, so it
  // sits just under the knob (specs/dial-preset-band.md).
  const pairStyle = {
    "--dial-preset-pull": `${dialPresetPull(LOUNGE_PAIR_DIAL_SIZE).toFixed(2)}px`,
  } as CSSProperties;

  /**
   * The zone's lighting dial and its preset row. Sized by the caller: a zone on
   * its own gives the dial the panel's 200px, and the Lounge halves it to make
   * room for the amplifier dial beside it.
   */
  const lightingControls = (size?: number, style?: CSSProperties) => (
    <div className="zone-lighting-controls" style={style}>
      <ZoneColorEncoder
        brightness={brightness}
        colorEnabled={hasActiveLights}
        disabled={!hasLightDevices}
        knobSkin={knobSkin}
        size={size}
        spectrum={spectrum}
        zoneId={zone.id}
        onBrightnessChange={setLocalBrightness}
        onBrightnessCommit={(value) => onZoneAction("brightness", { brightnessPct: value })}
        onColorCommit={(rgb, brightnessPct, cursor) => onZoneAction("color", { rgb, brightnessPct, cursor })}
        onSpectrumChange={rememberSpectrum}
      />
      <ZoneRulePresetRow
        adaptiveLabel={adaptivePresetLabel}
        hasLightDevices={hasLightDevices}
        hasSwitches={zone.counts.switch > 0}
        handlers={{ applyPreset: applyPresetAction, setLocalBrightness, rememberSpectrum, onZoneAction }}
        zoneId={zone.id}
      />
    </div>
  );

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
        {/* The zone's panel is a panel: its own controls are its content, laid out
            inside the panel's own box, and the room a slot inherits is THIS zone's
            (Adeline, 2026-09-25). */}
        <PanelSlots className="panel-slots-fill" dividesHeight roomId={zone.id} surface="zone-panel">
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
                /* House Party owns its own full-width row; everything else in
                   Advanced sits beneath it (specs/portrait-layout.md round 2).
                   Landscape flattens both wrappers with `display: contents`. */
                <div className="zone-advanced-stack">
                  <HousePartyControl
                    disabled={!hasLightDevices}
                    enabled={housePartyEnabled}
                    onToggle={toggleHouseParty}
                  />
                  <div className="zone-advanced-rest">
                    {/* The dial's preset buttons play these playlists, and the
                        Lounge is where the dial is mounted beside the lights
                        (Adeline, 2026-09-22). */}
                    {loungeZone ? <AppleTVPlaylistEditor /> : null}
                    {bedroomZone ? <BedroomTemperaturePanel temperature={bedroomTemperature ?? null} /> : null}
                    {loungeZone ? <LoungeEnvironmentPanel environment={loungeEnvironment ?? null} /> : null}
                    <ZoneLightEvents
                      lights={lightEntities}
                      zone={zone}
                    />
                  </div>
                </div>
              }
            >
              {loungeZone
                ? (
                  /* The Lounge mounts the same amplifier dial beside its
                     lighting dial — the room's lights and its music at once —
                     so both are halved and sit as a pair (Adeline, 2026-09-22). */
                  <div className="zone-dial-pair" style={pairStyle}>
                    {lightingControls(LOUNGE_PAIR_DIAL_SIZE, pairStyle)}
                    <div className="zone-lighting-controls zone-amplifier-controls" style={pairStyle}>
                      <AppleTVEncoder
                        ariaLabel="Apple TV volume"
                        knobSkin={knobSkin}
                        muted={amp.muted}
                        size={LOUNGE_PAIR_DIAL_SIZE}
                        volume={amp.volume}
                        onMuteChange={amp.setMuted}
                        onVolumeChange={amp.setVolume}
                      />
                      <PanelAppleTVPresets />
                    </div>
                  </div>
                )
                : lightingControls()}
            </AdvancedFold>
          )}
        </div>
        <ModuleSlot id="zone.controls.after" context={{ zone }} />
        </PanelSlots>
      </div>
    </section>
  );
}
