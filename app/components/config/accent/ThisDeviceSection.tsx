"use client";

import type { useAutoFullscreenSetting } from "../../dashboard/autoFullscreenSetting";
import type { useExperienceFeatures } from "../../dashboard/experienceModeSetting";
import type { useStatusOrbInfoSetting } from "../../dashboard/statusOrbInfoSetting";
import type { useAgentName } from "../../AgentNameContext";
import { LightingTintZoneSelect } from "../../LightingTintZoneSelect";
import { SwitchRow } from "../../SlideSwitch";
import { VoiceInputDeviceGroup } from "../../VoiceInputDeviceGroup";

export function ThisDeviceSection({
  agentName,
  autoFullscreen,
  setAutoFullscreen,
  experienceFeatures,
  setExperienceFeature,
  followVisualizerWhenActive,
  onFollowVisualizerChange,
  statusOrbInfoVisible,
  setStatusOrbInfoVisible,
}: {
  agentName: ReturnType<typeof useAgentName>["agentName"];
  autoFullscreen: ReturnType<typeof useAutoFullscreenSetting>[0];
  setAutoFullscreen: ReturnType<typeof useAutoFullscreenSetting>[1];
  experienceFeatures: ReturnType<typeof useExperienceFeatures>[0];
  setExperienceFeature: ReturnType<typeof useExperienceFeatures>[1];
  /**
   * Host-wide setting (shared theme config), not a per-device one. Its
   * load/write error is drawn by AccentConfig, outside this fold: a collapsed
   * fold would hide a failed shared-config load.
   */
  followVisualizerWhenActive: boolean;
  onFollowVisualizerChange: (checked: boolean) => void;
  statusOrbInfoVisible: ReturnType<typeof useStatusOrbInfoSetting>[0];
  setStatusOrbInfoVisible: ReturnType<typeof useStatusOrbInfoSetting>[1];
}) {
  // The section title lives on the wrapping ConfigAccordion ("This Device",
  // id="this-device" in AccentConfig), so the body opens on the first control.
  return (
          <div className="grid gap-3">
            <VoiceInputDeviceGroup agentName={agentName} />
            <SwitchRow
              checked={autoFullscreen}
              label="Auto Fullscreen"
              detail={autoFullscreen ? `This device keeps ${agentName} fullscreen` : "This device opens without requesting fullscreen"}
              onChange={setAutoFullscreen}
            />
            <SwitchRow
              checked={experienceFeatures.statusOrb}
              label="Show Status Orb"
              detail={
                experienceFeatures.statusOrb
                  ? "This device renders the animated status orb"
                  : "Status orb hidden — no canvas animation or load/gym polling"
              }
              onChange={(checked) => setExperienceFeature("statusOrb", checked)}
            />
            <SwitchRow
              checked={statusOrbInfoVisible}
              label="Show Status Orb Info"
              detail={
                statusOrbInfoVisible
                  ? "Shows the information line inside the orb, including the gym count"
                  : "Status orb information is hidden on this device"
              }
              onChange={setStatusOrbInfoVisible}
            />
            <SwitchRow
              checked={experienceFeatures.background}
              label="Show Background"
              detail={
                experienceFeatures.background
                  ? "This device renders the animated WebGL background"
                  : "Background off — the flat theme colour only, no grid or overlays"
              }
              onChange={(checked) => setExperienceFeature("background", checked)}
            />
            <SwitchRow
              checked={experienceFeatures.camera}
              label="Show Camera"
              detail={
                experienceFeatures.camera
                  ? "This device renders the live camera feed"
                  : "Camera off — skips hls.js video decode, one of the heaviest costs"
              }
              onChange={(checked) => setExperienceFeature("camera", checked)}
            />
            <SwitchRow
              checked={experienceFeatures.worldMap}
              label="Show World Map"
              detail={
                experienceFeatures.worldMap
                  ? "This device renders the live maplibre map with radar"
                  : "Map off — a static “Map Offline” placeholder is shown instead"
              }
              onChange={(checked) => setExperienceFeature("worldMap", checked)}
            />
            <LightingTintZoneSelect />
            <SwitchRow
              checked={followVisualizerWhenActive}
              label="Follow visualiser when active"
              detail={
                followVisualizerWhenActive
                  ? "Dashboard colours temporarily blend into the active visualiser theme"
                  : "Dashboard colours remain on the selected theme"
              }
              onChange={onFollowVisualizerChange}
            />
          </div>
  );
}
