"use client";

import { House, MonitorOff, Sparkles, Waves } from "lucide-react";
import { ConfigSelect } from "../../ConfigSelect";
import { ConfigAccordion } from "../../ConfigControls";
import { ColorThemeLibrary } from "../../phonoscope/ColorThemeLibrary";
import { PhonoscopeClipboardProvider } from "../../phonoscope/clipboard";
import { PhonoscopeEditingLockProvider } from "../../phonoscope/editing-lock";
import { SoloIndicator } from "../../phonoscope/SoloControls";
import { ControlSettingsPanel, type ControlSettings } from "../../phonoscope/ControlSettingsPanel";
import { ProviderSwitches } from "./ProviderSwitches";
import { ModulePackagesSection } from "./ModulePackagesSection";
import { moduleKey } from "./phonoscope-config-model";
import type { Config } from "./types";
import { usePhonoscopeConfig } from "./usePhonoscopeConfig";

/**
 * The Phonoscope config section. State and the save boundary are in
 * `usePhonoscopeConfig`; the module package list is `ModulePackagesSection`
 * (specs/agent-token-footprint.md §4).
 */
export function PhonoscopeConfig() {
  const {
    config, setConfig, modules, busy, message, diagnostics, fileRef,
    editingLock, load, save, preview, commit, activeModule,
    uploadPackage, removeModule, loadDiagnostics,
  } = usePhonoscopeConfig();

  return (
    <ConfigAccordion
      id="phonoscope"
      title="Phonoscope"
      icon={<Waves className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      {/*
        One clipboard for the whole panel, so a lane copied out of one settings
        group can be pasted into another.
      */}
      <PhonoscopeClipboardProvider>
      {/*
        One editing lock for the whole panel: any name field below can hold the
        panel's state still while it is being typed into, wherever in the
        hierarchy it sits.
      */}
      <PhonoscopeEditingLockProvider value={editingLock}>
      {config ? (
        <SoloIndicator
          colorThemeName={config.colorThemes
            .find((theme) => theme.id === config.soloColorThemeId)?.name ?? ""}
          settingsGroupName={config.settingsGroups
            .find((group) => group.id === config.soloSettingsGroupId)?.name ?? ""}
          onClearColorTheme={() => commit({ ...config, soloColorThemeId: "" })}
          onClearSettingsGroup={() => commit({ ...config, soloSettingsGroupId: "" })}
        />
      ) : null}
      <div className="grid gap-4 p-3">
        {message ? <p className="text-sm text-red-300">{message}</p> : null}
        {!config ? <p className="text-sm text-neutral-400">Loading…</p> : (
          <>
            <ConfigSelect
              label="Visualiser"
              value={config.activeModuleId ? moduleKey({
                id: config.activeModuleId, version: config.activeModuleVersion,
              }) : ""}
              options={modules.map((module) => ({
                value: moduleKey(module),
                label: module.name,
                detail: `${module.id}@${module.version}`,
              }))}
              onChange={(value) => {
                const [id, version] = value.split("@");
                void save({ ...config, activeModuleId: id, activeModuleVersion: version });
              }}
            />

            <ConfigSelect
              label="Idle behavior"
              value={config.idleBehavior}
              options={[
                { value: "ambient", label: "Ambient module", icon: <Sparkles /> },
                { value: "black", label: "Black screen", icon: <MonitorOff /> },
                { value: "return", label: "Return to dashboard", icon: <House /> },
              ]}
              onChange={(idleBehavior) => void save({
                ...config,
                idleBehavior: idleBehavior as Config["idleBehavior"],
              })}
            />

            {/*
              A picked list rather than a slider: the useful values are a handful
              of round durations spread over three orders of magnitude, and a
              linear 0-3600 slider would put all of them in its first inch.
            */}
            <ConfigSelect
              label="Screensaver after"
              value={String(config.screensaverSeconds)}
              options={[
                { value: "0", label: "Off", detail: "The idle behaviour above is the whole story." },
                ...[60, 300, 600, 1_800, 3_600].map((seconds) => ({
                  value: String(seconds),
                  label: seconds < 3_600
                    ? `${seconds / 60} minute${seconds === 60 ? "" : "s"}`
                    : "1 hour",
                })),
              ]}
              onChange={(seconds) => void save({
                ...config,
                screensaverSeconds: Number(seconds),
              })}
            />
            <p className="-mt-1 text-xs text-neutral-500">
              With no music for this long the picture fades to black and one of your images bounces
              around the screen. It is picked at random when the screensaver starts and stays put
              until music comes back.
            </p>

            <label className="grid gap-2 text-sm">
              <span className="font-black uppercase text-neutral-200">Message</span>
              <input
                type="text"
                className="border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
                maxLength={160}
                placeholder="Optional message shown in the visualiser — emojis welcome ✨"
                value={config.message}
                onChange={(event) => setConfig({ ...config, message: event.target.value })}
                // This one holds the lock directly: the provider is below this
                // component, so `useEditLock` has nothing to read up here.
                onFocus={editingLock.acquire}
                onBlur={(event) => {
                  editingLock.release();
                  void save({ ...config, message: event.currentTarget.value });
                }}
              />
              <span className="text-xs text-neutral-500">
                Overrides whatever centre image the live colour theme supplies. Leave it blank and
                the theme&rsquo;s image shows; a theme with no image draws nothing. Sizing for both
                is the <strong>Centre</strong> effect under Settings.
              </span>
            </label>

            {activeModule ? (
              <>
                <ControlSettingsPanel
                  moduleId={activeModule.id}
                  moduleSettings={activeModule.settings}
                  value={config}
                  onChange={(next: ControlSettings, isCommit) => {
                    const merged = { ...config, ...next };
                    if (isCommit) commit(merged); else preview(merged);
                  }}
                  // The two libraries a colour theme group draws from belong
                  // side by side, so the theme library is passed in rather than
                  // rendered as a sibling below the whole panel.
                  colorThemeLibrary={
                    <ColorThemeLibrary
                      moduleId={activeModule.id}
                      paletteSlots={activeModule.paletteSlots}
                      soloId={config.soloColorThemeId}
                      onSolo={(themeId) => commit({ ...config, soloColorThemeId: themeId })}
                      themes={config.colorThemes.filter((theme) => theme.moduleId === activeModule.id)}
                      onChange={(themes, isCommit) => {
                        const merged = {
                          ...config,
                          colorThemes: [
                            ...config.colorThemes.filter((theme) => theme.moduleId !== activeModule.id),
                            ...themes,
                          ],
                        };
                        if (isCommit) commit(merged); else preview(merged);
                      }}
                    />
                  }
                />
              </>
            ) : null}

            <ProviderSwitches config={config} save={save} />
          </>
        )}

        <ModulePackagesSection
          busy={busy}
          fileRef={fileRef}
          load={load}
          loadDiagnostics={loadDiagnostics}
          modules={modules}
          removeModule={removeModule}
          uploadPackage={uploadPackage}
        />

        {diagnostics ? <pre className="max-h-72 overflow-auto border border-neutral-800 bg-black p-3 text-xs text-cyan-100">{diagnostics}</pre> : null}
      </div>
      </PhonoscopeEditingLockProvider>
      </PhonoscopeClipboardProvider>
    </ConfigAccordion>
  );
}
