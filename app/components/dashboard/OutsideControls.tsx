"use client";

/**
 * The Outside card: the outside light, the weather and the camera
 * (specs/outside-card.md). In landscape the three flow left to right in that
 * order and the card fits its column without scrolling.
 */
import { PowerOff, Sun as SunIcon } from "lucide-react";
import type { DashboardZone, SpectrumCursor, SunStatus, WeatherStatus } from "../../../lib/types";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { WeatherPanel } from "./WeatherPanel";
import { CameraPanel } from "./CameraPanel";
import { useExperienceFeature } from "./experienceModeSetting";
import { classNames, dashboardEntityIsOn } from "./shared";
import { useZoneLighting, type ZoneActionHandler } from "./useZoneLighting";
import { ZoneColorEncoder } from "./ZoneControls";

const OUTSIDE_ENCODER_SIZE = 100;

export function OutsideControls({
  knobSkin,
  onZoneAction,
  spectrumCursor,
  sun,
  weather,
  zone,
}: {
  knobSkin?: "auto" | "dark" | "light";
  onZoneAction?: ZoneActionHandler;
  spectrumCursor?: SpectrumCursor;
  sun?: SunStatus | null;
  weather: WeatherStatus | null;
  zone: DashboardZone;
}) {
  // Devices with the camera feature off skip the camera panel entirely: hls.js
  // video decode is one of the heaviest steady-state costs on old tablets.
  const showCamera = useExperienceFeature("camera");
  const outsideLight =
    zone.entities.find((entity) => entity.domain === "light") ?? zone.entities.find((entity) => entity.isIllumination);
  const unavailable = outsideLight ? ["unknown", "unavailable"].includes(outsideLight.state) : true;
  const isOn = outsideLight ? dashboardEntityIsOn(outsideLight) : false;

  const noZoneAction: ZoneActionHandler = async () => undefined;
  const lighting = useZoneLighting({
    spectrumCursor,
    sun,
    zone,
    onZoneAction: onZoneAction ?? noZoneAction,
  });

  return (
    <div className="outside-control-grid grid gap-5">
      <section className="outside-light-card border border-neutral-700 bg-neutral-950/70 p-5">
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase text-cyan-300">Exterior Circuit</p>
            <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">Outside Light</h2>
          </div>
          <div className="border border-cyan-300/50 px-3 py-2 text-xs font-black uppercase text-cyan-200">
            {outsideLight?.state ?? "missing"}
          </div>
        </header>

        <div className="outside-light-controls">
          <ZoneColorEncoder
            brightness={lighting.brightness}
            colorEnabled={isOn}
            disabled={unavailable || !lighting.hasLightDevices}
            knobSkin={knobSkin}
            label=""
            size={OUTSIDE_ENCODER_SIZE}
            spectrum={lighting.spectrum}
            zoneId={zone.id}
            onBrightnessChange={lighting.setLocalBrightness}
            onBrightnessCommit={(value) => void lighting.commitBrightness(value)}
            onColorCommit={(rgb, brightnessPct, cursor) => void lighting.commitColor(rgb, brightnessPct, cursor)}
            onSpectrumChange={lighting.rememberSpectrum}
          />
          {/* On is always full white, however the knob was left
              (specs/outside-card.md). The knob still turns afterwards. */}
          <div className="quick-button-pair">
            <MomentaryFeedbackButton
              type="button"
              aria-label="Outside light on, full white"
              aria-pressed={isOn}
              className={classNames("quick-button border", isOn && "quick-button-active")}
              disabled={unavailable || !lighting.hasLightDevices}
              onClick={() => void lighting.applyPreset("white")}
            >
              <SunIcon className="h-4 w-4" aria-hidden="true" />
              <span>On</span>
            </MomentaryFeedbackButton>
            <MomentaryFeedbackButton
              type="button"
              aria-label="Outside light off"
              aria-pressed={!isOn}
              className={classNames("quick-button border", !isOn && "quick-button-active")}
              disabled={unavailable || !lighting.hasLightDevices}
              onClick={() => void lighting.turnOff()}
            >
              <PowerOff className="h-4 w-4" aria-hidden="true" />
              <span>Off</span>
            </MomentaryFeedbackButton>
          </div>
        </div>
      </section>

      <WeatherPanel weather={weather} />

      {showCamera ? <CameraPanel cameraId="outside" className="outside-camera-panel" /> : null}
    </div>
  );
}
