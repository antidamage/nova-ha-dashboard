"use client";

/**
 * Config page shell: the next/dynamic section imports (kept here by literal
 * path, so no section file has to move) and the per-category section list.
 * Everything around them lives in config/workspace/:
 *
 *   types.ts / constants.ts              ConfigCategoryId; categories, legacy hash map, path prefix, sign-out URL
 *   config-path-model.ts                 parse/sync the /config/<category>/<slug> path
 *   useConfigDeepLink.ts                 category resolution, URL sync, deep-link lifecycle
 *   useConfigScrollMemory.ts             scroll restore and remember
 *   useSessionExpiryRedirect.ts          leave for / when the session ends
 *   useConfigCategoryNavigation.ts       active category, nav wiring, Back
 *   useConfigTransfer.ts                 shared-config load, import/export state
 *   ConfigWorkspaceLayout.tsx            page chrome: actions, category nav, breadcrumb, heading
 *   ConfigPageActions.tsx                Back / Log out buttons, signOut
 *   ConfigCategoryNav.tsx                category button row
 *   SecretsAccordion.tsx                 Secrets accordion, StatusPill
 *   ConfigTransferAccordion.tsx          Config Import/Export accordion, ToolbarButton
 *   system-data-model.ts                 setupRows, downloadJson
 */
import { History, Paintbrush, ShieldCheck, UserRound } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import type { AppleTvSwipeSettings } from "../../lib/appletv-swipe";
import type { AgentPreferences, VoicePreferences, WatchfacePreferences } from "../../lib/types";
import type { SunThemeStatus, ThemeStorageValue } from "./accentColor";
import { ConfigAccordion } from "./ConfigControls";
import { SystemControlConfig } from "./SystemControlConfig";
import { ConfigTransferAccordion } from "./config/workspace/ConfigTransferAccordion";
import { ConfigWorkspaceLayout } from "./config/workspace/ConfigWorkspaceLayout";
import { SecretsAccordion } from "./config/workspace/SecretsAccordion";
import { useConfigCategoryNavigation } from "./config/workspace/useConfigCategoryNavigation";
import { useConfigTransfer } from "./config/workspace/useConfigTransfer";
import { useSessionExpiryRedirect } from "./config/workspace/useSessionExpiryRedirect";

export type { ConfigCategoryId } from "./config/workspace/types";

const AccentConfig = dynamic(() => import("./AccentConfig").then((module) => module.AccentConfig));
const AgentAdministration = dynamic(() => import("./AgentAdministration").then((module) => module.AgentAdministration));
const AgentConfig = dynamic(() => import("./AgentConfig").then((module) => module.AgentConfig));
const AgentNameConfig = dynamic(() => import("./AgentNameConfig").then((module) => module.AgentNameConfig));
const ClimateConfig = dynamic(() => import("./ClimateConfig").then((module) => module.ClimateConfig));
const AppleTvSwipeConfig = dynamic(() => import("./AppleTvSwipeConfig").then((module) => module.AppleTvSwipeConfig));
const CameraConfig = dynamic(() => import("./CameraConfig").then((module) => module.CameraConfig));
const StatusOrbInfoConfig = dynamic(() => import("./StatusOrbInfoConfig").then((module) => module.StatusOrbInfoConfig));
const HistoryPanel = dynamic(() => import("./HistoryPanel").then((module) => module.HistoryPanel));
const ManagedComputersConfig = dynamic(() => import("./ManagedComputersConfig").then((module) => module.ManagedComputersConfig));
const ModulesConfig = dynamic(() => import("./ModulesConfig").then((module) => module.ModulesConfig));
const PhonoscopeConfig = dynamic(() => import("./PhonoscopeConfig").then((module) => module.PhonoscopeConfig));
const RemindersConfig = dynamic(() => import("./RemindersConfig").then((module) => module.RemindersConfig));
const UpdateConfig = dynamic(() => import("./UpdateConfig").then((module) => module.UpdateConfig));
const UserDataConfig = dynamic(() => import("./UserDataConfig").then((module) => module.UserDataConfig));
const VoiceConfig = dynamic(() => import("./VoiceConfig").then((module) => module.VoiceConfig));
const VoiceInfrastructureConfig = dynamic(() => import("./VoiceInfrastructureConfig").then((module) => module.VoiceInfrastructureConfig));
const VoiceTrainingConfig = dynamic(() => import("./VoiceTrainingConfig").then((module) => module.VoiceTrainingConfig));
const WaveshareWatchfaceConfig = dynamic(() => import("./WaveshareWatchfaceConfig").then((module) => module.WaveshareWatchfaceConfig));

export function ConfigWorkspace({
  initialAgentSettings,
  initialAutoUpdate,
  initialSwipe,
  initialSun,
  initialTheme,
  initialVoiceSettings,
  initialWatchface,
}: {
  initialAgentSettings?: AgentPreferences | null;
  initialAutoUpdate?: boolean;
  initialSwipe?: AppleTvSwipeSettings | null;
  initialSun?: SunThemeStatus | null;
  initialTheme?: ThemeStorageValue | null;
  initialVoiceSettings?: VoicePreferences | null;
  initialWatchface?: WatchfacePreferences | null;
}) {
  const systemLoadStartedRef = useRef(false);

  useSessionExpiryRedirect();

  const { activeCategory, activeMeta, categoryNavRef, handleBack, selectCategory } = useConfigCategoryNavigation();
  const { busy, config, fileInputRef, importFile, load, message, rows } = useConfigTransfer();

  useEffect(() => {
    if (activeCategory === "system-data" && !systemLoadStartedRef.current) {
      systemLoadStartedRef.current = true;
      void load();
    }
  }, [activeCategory, load]);

  return (
    <ConfigWorkspaceLayout
      activeCategory={activeCategory}
      activeMeta={activeMeta}
      categoryNavRef={categoryNavRef}
      initialSun={initialSun}
      initialTheme={initialTheme}
      onBack={handleBack}
      selectCategory={selectCategory}
    >
            {activeCategory === "assistant" ? (
              <>
                <ConfigAccordion id="identity" title="Identity" icon={<UserRound className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
                  <AgentNameConfig />
                </ConfigAccordion>
                <AgentConfig initialSettings={initialAgentSettings} />
                <ConfigAccordion id="authority" title="Agent Authority" icon={<ShieldCheck className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
                  <AgentAdministration />
                </ConfigAccordion>
              </>
            ) : null}
            {activeCategory === "voice-people" ? (
              <>
                <VoiceInfrastructureConfig initialSettings={initialVoiceSettings} />
                <VoiceConfig initialSettings={initialVoiceSettings} />
                <VoiceTrainingConfig />
                <UserDataConfig />
              </>
            ) : null}
            {activeCategory === "appearance-dashboard" ? (
              <>
                <ConfigAccordion id="appearance" title="Theme & Experience" icon={<Paintbrush className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
                  <AccentConfig initialSun={initialSun} initialTheme={initialTheme} />
                </ConfigAccordion>
                <RemindersConfig />
                <StatusOrbInfoConfig initialSettings={initialWatchface} />
                <ClimateConfig />
                <AppleTvSwipeConfig initialSettings={initialSwipe} />
                <PhonoscopeConfig />
              </>
            ) : null}
            {activeCategory === "devices" ? (
              <>
                <ManagedComputersConfig />
                <WaveshareWatchfaceConfig initialSettings={initialWatchface} />
                <CameraConfig />
              </>
            ) : null}
            {activeCategory === "modules" ? <ModulesConfig /> : null}
            {activeCategory === "system-data" ? (
              <>
        {/*
          History leads this category: when someone comes looking for it they
          have usually just lost something, and hunting past Secrets and
          Transfer to find the way back is the wrong first experience.
        */}
        <ConfigAccordion id="history" title="History" icon={<History className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
          <HistoryPanel />
        </ConfigAccordion>
        <SecretsAccordion rows={rows} />

        <ConfigTransferAccordion busy={busy} config={config} fileInputRef={fileInputRef} importFile={importFile} message={message} />

        <UpdateConfig initialAutoUpdate={initialAutoUpdate} />

        <SystemControlConfig />
              </>
            ) : null}
    </ConfigWorkspaceLayout>
  );
}
