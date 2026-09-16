"use client";

import { COMPANION_ROUTABLE_PASSES, type CompanionRouteChoice } from "../../../../lib/voice-settings";
import CompanionStatusCard from "../../CompanionStatusCard";
import { ConfigSelect } from "../../ConfigSelect";
import { SwitchRow } from "../../SlideSwitch";
import type { VoicePipelineController } from "./useVoicePipelineSettings";
import { COMPANION_PASS_LABELS, COMPANION_ROUTE_OPTIONS } from "./voice-infrastructure-model";

// Companion device switches and the per-pass route pickers.
export function PipelineCompanionSection({ pipeline }: { pipeline: VoicePipelineController }) {
  const { settings, effectiveSwitches, effectiveRoutes, commit, loadEffectiveRoutes } = pipeline;

  return (
    <>
      <p className="mt-2 text-xs font-black uppercase text-neutral-400">Companion device</p>
      <CompanionStatusCard />

      <div className="grid gap-1.5">
        {/* Both fall back to the voice server's live state rather than to a
            fixed default, so a box is never shown ticked for a deployment
            where the setting is actually off. */}
        <SwitchRow
          checked={settings.companionEnabled ?? effectiveSwitches.enabled}
          detail="Turning this off restores the voice server's previous behaviour exactly."
          label="Use the companion device"
          onChange={(companionEnabled) => {
            void commit("companionEnabled", companionEnabled).then(loadEffectiveRoutes);
          }}
        />
        <SwitchRow
          checked={settings.companionForceLocal ?? effectiveSwitches.forceLocal}
          detail="Keeps every pass here without disconnecting the device. Applies straight away."
          label="Force everything to the voice server"
          onChange={(companionForceLocal) => {
            void commit("companionForceLocal", companionForceLocal).then(loadEffectiveRoutes);
          }}
        />
      </div>

      <p className="mt-2 text-xs font-black uppercase text-neutral-400">Where each pass runs</p>
      <div className="grid gap-3">
        {COMPANION_ROUTABLE_PASSES.map((pass) => (
          <ConfigSelect
            key={pass}
            ariaLabel={`${COMPANION_PASS_LABELS[pass]} runs on`}
            label={COMPANION_PASS_LABELS[pass]}
            options={COMPANION_ROUTE_OPTIONS}
            value={
              settings.companionRoutes[pass]
              ?? (effectiveRoutes[pass] as CompanionRouteChoice | undefined)
              ?? "local"
            }
            onChange={(choice) => {
              void commit("companionRoutes", { [pass]: choice }).then(loadEffectiveRoutes);
            }}
          />
        ))}
      </div>
    </>
  );
}
