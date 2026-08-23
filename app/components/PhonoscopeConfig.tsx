"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Box, House, MonitorOff, RefreshCw, Sparkles, Trash2, Upload, Waves,
} from "lucide-react";
import type {
  PhonoscopeColorGroup,
  PhonoscopeColorTheme,
  PhonoscopeHouseParty,
  PhonoscopeSettingsGroup,
} from "../../lib/types";
import { ConfigSelect } from "./ConfigSelect";
import { CheckboxRow, ConfigAccordion } from "./ConfigControls";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import { ColorThemeLibrary, type PaletteSlot } from "./phonoscope/ColorThemeLibrary";
import { PhonoscopeClipboardProvider } from "./phonoscope/clipboard";
import {
  PhonoscopeEditingLockProvider, useEditLock, usePhonoscopeEditingLock,
} from "./phonoscope/editing-lock";
import { SoloIndicator } from "./phonoscope/SoloControls";
import { ControlSettingsPanel, type ControlSettings } from "./phonoscope/ControlSettingsPanel";
import type { ModuleSetting } from "./phonoscope/effectCatalogue";

export type { ModuleSetting };

type ModuleSummary = {
  id: string;
  packageName: string;
  version: string;
  name: string;
  description: string;
  dimension: "2d" | "3d";
  hash: string;
  builtin: boolean;
  settings: ModuleSetting[];
  paletteSlots: PaletteSlot[];
  previewUrl?: string;
};

type Config = {
  activeModuleId: string;
  activeModuleVersion: string;
  idleBehavior: "ambient" | "black" | "return";
  screensaverSeconds: number;
  message: string;
  statusOverlay: boolean;
  transitionMs: number;
  providers: {
    spotify: boolean;
    songle: boolean;
    essentia: boolean;
    reccoBeats: boolean;
    lrclib: boolean;
  };
  moduleSettings: Record<string, Record<string, number>>;
  pendingStructuralModuleSettings: Record<string, Record<string, number>>;
  moduleReloadGenerations: Record<string, number>;
  settingsGroups: PhonoscopeSettingsGroup[];
  colorThemes: PhonoscopeColorTheme[];
  colorGroups: PhonoscopeColorGroup[];
  moduleColorGroupIds: Record<string, string>;
  chooseColorGroupByGenre: boolean;
  structuralSettings: Record<string, number>;
  houseParty: PhonoscopeHouseParty;
  soloColorThemeId: string;
  soloSettingsGroupId: string;
  editorPreviewColorGroupId: string;
  editorPreviewColorEntryId: string;
};

type Payload = { config: Config; modules: ModuleSummary[]; error?: string };

function moduleKey(module: Pick<ModuleSummary, "id" | "version">) {
  return `${module.id}@${module.version}`;
}

export function PhonoscopeConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  // Held while a name field has focus. Nothing that arrives from the server may
  // replace `config` while it is: the reply describes the name as it was when
  // the request left, and applying it takes the letters typed since back out of
  // the input. See phonoscope/editing-lock.tsx.
  const { value: editingLock, isEditing } = usePhonoscopeEditingLock();

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/phonoscope/config", { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error ?? "Failed to load Phonoscope");
      // The module list is not edited here, so it is always safe to take.
      setModules(payload.modules);
      if (isEditing()) return;
      setConfig(payload.config);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load Phonoscope");
    } finally {
      setBusy(false);
    }
  }, [isEditing]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (next: Config, { quiet = false }: { quiet?: boolean } = {}) => {
    setConfig(next);
    if (!quiet) {
      setBusy(true);
      setMessage(null);
    }
    try {
      const response = await fetch("/api/phonoscope/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const payload = await response.json() as { config?: Config; error?: string };
      if (!response.ok || !payload.config) throw new Error(payload.error ?? "Failed to save Phonoscope");
      // The echo is the server's normalised copy of what was sent, so it is
      // authoritative — except over a field someone is still typing into, where
      // it is a stale snapshot of that field and applying it would undo the
      // keystrokes that happened during the round trip. The blur that ends the
      // edit commits, and that reply lands with the lock free.
      if (!isEditing()) setConfig(payload.config);
      // No "saved" banner: settings commit on every slider release, and the
      // status line sits above the controls, so showing then clearing it shifts
      // the page out from under the gesture. Only failures are announced.
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save Phonoscope");
      await load();
    } finally {
      if (!quiet) setBusy(false);
    }
  }, [load, isEditing]);

  /**
   * A preview sample. Local state only — this must not touch the network.
   *
   * Dot controls emit one of these per pointer move, and they used to be
   * coalesced to a 75ms cadence and POSTed for the whole duration of a drag.
   * Every reply re-rendered the panel from the server's echo and rebroadcast to
   * the renderer, so a single drag was dozens of saves and the thumb visibly
   * lagged the finger holding it. `ConfigControls` has always stated the
   * contract — preview is local UI state, commit is the one persistence
   * boundary — and this is that contract actually kept.
   *
   * The consequence, accepted deliberately: the renderer follows on release
   * rather than live under the thumb. A live preview, if it is wanted back,
   * belongs on a lightweight renderer-only channel, not a whole-config POST.
   */
  const preview = useCallback((next: Config) => {
    setConfig(next);
  }, []);

  const commit = useCallback((next: Config) => {
    saveChain.current = saveChain.current
      .catch(() => undefined)
      .then(async () => { await save(next, { quiet: true }); });
  }, [save]);

  const activeModule = useMemo(
    () => modules.find((module) =>
      module.id === config?.activeModuleId && module.version === config?.activeModuleVersion),
    [config, modules],
  );

  const uploadPackage = useCallback(async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/phonoscope/modules", { method: "POST", body: file });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Upload failed");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [load]);

  const removeModule = useCallback(async (module: ModuleSummary) => {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/phonoscope/modules/${encodeURIComponent(module.id)}/${encodeURIComponent(module.version)}`,
        { method: "DELETE" },
      );
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Delete failed");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }, [load]);

  const loadDiagnostics = useCallback(async () => {
    try {
      const response = await fetch("/api/phonoscope/diagnostics", { cache: "no-store" });
      setDiagnostics(JSON.stringify(await response.json(), null, 2));
    } catch (error) {
      setDiagnostics(error instanceof Error ? error.message : "Diagnostics failed");
    }
  }, []);

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

            <div className="grid gap-3 sm:grid-cols-3">
              <CheckboxRow checked={config.providers.spotify} label="Spotify beat timestamps" detail="Use Spotify timing when available"
                onChange={(spotify) => void save({ ...config, providers: { ...config.providers, spotify } })} />
              <CheckboxRow checked={config.providers.songle} label="Songle beat timestamps" detail="Use Songle timing when available"
                onChange={(songle) => void save({ ...config, providers: { ...config.providers, songle } })} />
              <CheckboxRow checked={config.providers.essentia} label="Local Essentia analysis" detail="Analyse tracks locally"
                onChange={(essentia) => void save({ ...config, providers: { ...config.providers, essentia } })} />
              <CheckboxRow checked={config.providers.reccoBeats} label="ReccoBeats BPM fallback" detail="Use BPM metadata as a fallback"
                onChange={(reccoBeats) => void save({ ...config, providers: { ...config.providers, reccoBeats } })} />
              <CheckboxRow checked={config.providers.lrclib} label="Timed lyrics" detail="Resolve synchronized lyrics"
                onChange={(lrclib) => void save({ ...config, providers: { ...config.providers, lrclib } })} />
              <CheckboxRow checked={config.statusOverlay} label="Ambient status" detail="Show music information over the visualiser"
                onChange={(statusOverlay) => void save({ ...config, statusOverlay })} />
            </div>
          </>
        )}

        <div className="grid gap-3 border-t border-neutral-800 pt-4">
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              className="hidden"
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadPackage(file);
              }}
            />
            <MomentaryFeedbackButton className="config-page-button config-page-button-primary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> Upload module package
            </MomentaryFeedbackButton>
            <MomentaryFeedbackButton className="config-page-button" type="button" disabled={busy} onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </MomentaryFeedbackButton>
            <MomentaryFeedbackButton className="config-page-button" type="button" onClick={() => void loadDiagnostics()}>
              <Activity className="h-4 w-4" /> Diagnostics
            </MomentaryFeedbackButton>
          </div>

          <div className="grid gap-2">
            {modules.map((module) => (
              <div key={moduleKey(module)} className="flex items-center justify-between gap-3 border border-neutral-800 bg-neutral-950/60 p-3 text-sm">
                <span className="flex min-w-0 items-center gap-3">
                  <Box className="h-4 w-4 shrink-0 text-cyan-300" />
                  <span className="min-w-0">
                    <span className="block truncate font-black uppercase text-neutral-100">{module.name}</span>
                    <span className="font-mono text-xs text-neutral-500">{module.id}@{module.version} · {module.dimension}</span>
                  </span>
                </span>
                {!module.builtin ? (
                  <MomentaryFeedbackButton
                    type="button"
                    className="config-page-button"
                    aria-label={`Remove ${module.name} ${module.version}`}
                    disabled={busy}
                    onClick={() => void removeModule(module)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </MomentaryFeedbackButton>
                ) : <span className="text-xs font-black uppercase text-cyan-300">Built in</span>}
              </div>
            ))}
          </div>
        </div>

        {diagnostics ? <pre className="max-h-72 overflow-auto border border-neutral-800 bg-black p-3 text-xs text-cyan-100">{diagnostics}</pre> : null}
      </div>
      </PhonoscopeEditingLockProvider>
      </PhonoscopeClipboardProvider>
    </ConfigAccordion>
  );
}
