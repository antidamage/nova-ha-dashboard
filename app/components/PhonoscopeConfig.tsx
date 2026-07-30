"use client";

import { Activity, Box, RefreshCw, Trash2, Upload, Waves } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckboxRow, ConfigAccordion, SliderControlPanel } from "./ConfigControls";

type ModuleSetting = {
  id: string;
  label: string;
  description?: string;
  control?: "slider" | "number" | "toggle" | "select";
  min: number;
  max: number;
  step: number;
  default: number;
  affects?: string[];
  curve?: {
    type: "linear" | "power";
    exponent: number;
  };
  options?: Array<{ label: string; value: number }>;
  section?: string;
  updateMode?: "smooth" | "structural";
};

type ModuleSummary = {
  id: string;
  version: string;
  name: string;
  description: string;
  dimension: "2d" | "3d";
  builtin: boolean;
  hash: string;
  settings: ModuleSetting[];
};

type Config = {
  activeModuleId: string;
  activeModuleVersion: string;
  idleBehavior: "ambient" | "black" | "return";
  quality: "auto" | "high" | "balanced" | "performance";
  message: string;
  statusOverlay: boolean;
  transitionMs: number;
  housePartyRandomHueOffset: number;
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
  themeGroups: ThemeGroup[];
  moduleThemeGroupIds: Record<string, string>;
};

type ThemeGroupEntry = { themeId: string; baseVariant: "dark" | "light"; swapOnDownbeat: boolean; genres: string[] };
type ThemeGroup = {
  id: string; name: string; themes: ThemeGroupEntry[]; order: "sequential" | "shuffle";
  changeMode: "interval" | "song" | "downbeat"; waitSeconds: number; transitionSeconds: number; useGenres: boolean;
  housePartyHueMode: "follow" | "complement";
  housePartyBrightnessMode: "follow" | "oppose" | "ignore";
};
type ThemeLibraryEntry = { id: string; name: string; themeSet: unknown };
type Payload = {
  config: Config; modules: ModuleSummary[];
  themeLibrary?: { entries?: ThemeLibraryEntry[] }; error?: string;
};
const GENRE_SUGGESTIONS = [
  "Alternative", "Blues", "Classical", "Country", "Dance", "Electronic", "Folk",
  "Grunge", "Hip-Hop/Rap", "Hyperpop", "Indie", "Jazz", "Latin", "Metal", "Pop",
  "Punk", "R&B/Soul", "Reggae", "Rock", "Soundtrack",
];
const GENRE_SUGGESTION_SET = new Set(GENRE_SUGGESTIONS);
const THEME_TIME_MAX_SECONDS = 600;
const THEME_TIME_SLIDER_MAX = 100;
const THEME_TIME_LOG_OFFSET = 10;

function parseGenreInput(value: string) {
  return [...new Set(value.split(",").map((genre) => genre.trim()).filter(Boolean))];
}

function customGenres(genres: string[]) {
  return genres.filter((genre) => !GENRE_SUGGESTION_SET.has(genre));
}

function themeTimeSliderPosition(seconds: number) {
  const clamped = Math.max(0, Math.min(THEME_TIME_MAX_SECONDS, seconds));
  return Math.log1p(clamped / THEME_TIME_LOG_OFFSET)
    / Math.log1p(THEME_TIME_MAX_SECONDS / THEME_TIME_LOG_OFFSET)
    * THEME_TIME_SLIDER_MAX;
}

function themeTimeFromSlider(position: number) {
  const normalized = Math.max(0, Math.min(THEME_TIME_SLIDER_MAX, position)) / THEME_TIME_SLIDER_MAX;
  const rawSeconds = THEME_TIME_LOG_OFFSET
    * Math.expm1(Math.log1p(THEME_TIME_MAX_SECONDS / THEME_TIME_LOG_OFFSET) * normalized);
  const rounded = rawSeconds <= 30
    ? Math.round(rawSeconds)
    : rawSeconds <= 120
      ? Math.round(rawSeconds / 5) * 5
      : rawSeconds <= 300
        ? Math.round(rawSeconds / 15) * 15
        : Math.round(rawSeconds / 30) * 30;
  return Math.max(0, Math.min(THEME_TIME_MAX_SECONDS, rounded));
}

function moduleKey(module: Pick<ModuleSummary, "id" | "version">) {
  return `${module.id}@${module.version}`;
}

function clampSetting(setting: ModuleSetting, value: number) {
  if (setting.control === "toggle") return value >= 0.5 ? 1 : 0;
  if (setting.control === "select") {
    return setting.options?.some((option) => option.value === value) ? value : setting.default;
  }
  const clamped = Math.max(setting.min, Math.min(setting.max, value));
  const stepped = setting.min + Math.round((clamped - setting.min) / setting.step) * setting.step;
  return Number(Math.max(setting.min, Math.min(setting.max, stepped)).toFixed(12));
}

function sliderPosition(setting: ModuleSetting, value: number) {
  const normalized = (value - setting.min) / Math.max(Number.EPSILON, setting.max - setting.min);
  const clamped = Math.max(0, Math.min(1, normalized));
  return setting.curve?.type === "power" ? Math.pow(clamped, 1 / setting.curve.exponent) : clamped;
}

function sliderValue(setting: ModuleSetting, position: number) {
  const curved = setting.curve?.type === "power"
    ? Math.pow(Math.max(0, Math.min(1, position)), setting.curve.exponent)
    : position;
  return clampSetting(setting, setting.min + (setting.max - setting.min) * curved);
}

function formatSettingValue(setting: ModuleSetting, value: number) {
  if (setting.control === "toggle") return value >= 0.5 ? "On" : "Off";
  if (setting.control === "select") {
    return setting.options?.find((option) => option.value === value)?.label ?? String(value);
  }
  const decimals = Math.min(4, Math.max(0, (String(setting.step).split(".")[1] ?? "").length));
  return value.toFixed(decimals);
}

export function PhonoscopeConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [themeLibrary, setThemeLibrary] = useState<ThemeLibraryEntry[]>([]);
  const [themeModal, setThemeModal] = useState(false);
  const [draftGroups, setDraftGroups] = useState<ThemeGroup[]>([]);
  const [draftGroupId, setDraftGroupId] = useState("");
  const [genreInputs, setGenreInputs] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/phonoscope/config", { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error ?? "Failed to load Phonoscope");
      setConfig(payload.config);
      setModules(payload.modules);
      setThemeLibrary(payload.themeLibrary?.entries ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load Phonoscope");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!themeModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [themeModal]);

  const save = useCallback(async (next: Config) => {
    setConfig(next);
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/phonoscope/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const payload = await response.json() as { config?: Config; error?: string };
      if (!response.ok || !payload.config) throw new Error(payload.error ?? "Failed to save Phonoscope");
      setConfig(payload.config);
      setMessage("Phonoscope configuration saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save Phonoscope");
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);
  const activeModule = useMemo(
    () => modules.find((module) => module.id === config?.activeModuleId && module.version === config?.activeModuleVersion),
    [config, modules],
  );
  const activeThemeGroup = config && activeModule
    ? config.themeGroups.find((group) => group.id === config.moduleThemeGroupIds[activeModule.id])
    : undefined;
  const draftGroup = draftGroups.find((group) => group.id === draftGroupId);
  const updateDraftGroup = (patch: Partial<ThemeGroup>) =>
    setDraftGroups((groups) => groups.map((group) => group.id === draftGroupId ? { ...group, ...patch } : group));
  const openThemeModal = () => {
    if (!config) return;
    const groups = structuredClone(config.themeGroups);
    setDraftGroups(groups);
    setGenreInputs(Object.fromEntries(groups.flatMap((group) => group.themes.map((theme) => [
      `${group.id}:${theme.themeId}`,
      customGenres(theme.genres).join(", "),
    ]))));
    setDraftGroupId(activeThemeGroup?.id ?? groups[0]?.id ?? "");
    setThemeModal(true);
  };

  const uploadPackage = async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("package", file);
      const response = await fetch("/api/phonoscope/modules", { method: "POST", body: form });
      const payload = await response.json() as { module?: ModuleSummary; error?: string };
      if (!response.ok || !payload.module) throw new Error(payload.error ?? "Module upload failed");
      setMessage(`Installed ${payload.module.name} ${payload.module.version}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Module upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeModule = async (module: ModuleSummary) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/phonoscope/modules/${encodeURIComponent(module.id)}/${encodeURIComponent(module.version)}`,
        { method: "DELETE" },
      );
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Module removal failed");
      setMessage(`Removed ${module.name} ${module.version}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Module removal failed");
    } finally {
      setBusy(false);
    }
  };

  const loadDiagnostics = async () => {
    const response = await fetch("/api/phonoscope/diagnostics", { cache: "no-store" });
    const payload = await response.json() as Record<string, unknown>;
    setDiagnostics(JSON.stringify(payload, null, 2));
  };

  return (
    <ConfigAccordion
      id="phonoscope"
      title="Phonoscope"
      icon={<Waves className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="grid gap-5">
        <div>
          <p className="font-black uppercase text-cyan-100">Apple TV music visualiser</p>
          <p className="mt-1 text-sm leading-relaxed text-neutral-400">
            Choose the module rendered by the Phonoscope menu item. Packages are declarative YAML and assets;
            the dashboard validates and compiles them before the Apple TV can load them.
          </p>
        </div>

        {message ? <p className="border border-cyan-500/30 bg-cyan-950/30 p-3 text-sm text-cyan-100" role="status">{message}</p> : null}

        {config ? (
          <>
            <label className="grid gap-2 text-sm">
              <span className="font-black uppercase text-neutral-200">Active module</span>
              <select
                className="border border-neutral-700 bg-neutral-950 px-3 py-3 text-neutral-100"
                value={`${config.activeModuleId}@${config.activeModuleVersion}`}
                disabled={busy}
                onChange={(event) => {
                  const selected = modules.find((module) => moduleKey(module) === event.target.value);
                  if (selected) void save({ ...config, activeModuleId: selected.id, activeModuleVersion: selected.version });
                }}
              >
                {modules.map((module) => (
                  <option key={moduleKey(module)} value={moduleKey(module)}>
                    {module.name} · {module.dimension.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            {activeModule?.description ? <p className="text-sm text-neutral-400">{activeModule.description}</p> : null}

            <button type="button" className="grid gap-1 border border-neutral-700 bg-neutral-950/60 p-3 text-left"
              onClick={openThemeModal}>
              <span className="font-black uppercase text-neutral-200">Theme group</span>
              <span className="text-sm text-cyan-200">
                {activeThemeGroup
                  ? `${activeThemeGroup.name} · ${activeThemeGroup.themes.length} themes · ${activeThemeGroup.order} · ${
                      activeThemeGroup.changeMode === "song"
                        ? "on song"
                        : activeThemeGroup.changeMode === "downbeat"
                          ? "on downbeat"
                          : `every ${activeThemeGroup.waitSeconds}s`
                    } · ${activeThemeGroup.transitionSeconds}s blend`
                  : "Dashboard theme · click to configure"}
              </span>
            </button>

            {themeModal ? createPortal((
              <div className="fixed inset-0 z-[10000] grid place-items-center overflow-y-auto bg-black/80 p-6" role="dialog" aria-modal="true">
                <div className="grid max-h-[90vh] w-full max-w-4xl gap-4 overflow-auto border border-cyan-500/40 bg-neutral-950 p-5">
                  <div className="flex items-center gap-2">
                    <select className="min-w-0 flex-1 border border-neutral-700 bg-black p-2" value={draftGroupId}
                      onChange={(event) => setDraftGroupId(event.target.value)}>
                      <option value="">Dashboard theme</option>
                      {draftGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                    <button type="button" className="config-page-button" onClick={() => {
                      const id = `theme_group_${Date.now().toString(36)}`;
                      setDraftGroups((groups) => [...groups, {
                        id, name: "New theme group", themes: [], order: "sequential",
                        changeMode: "interval", waitSeconds: 60, transitionSeconds: 3, useGenres: false,
                        housePartyHueMode: "follow", housePartyBrightnessMode: "follow",
                      }]);
                      setDraftGroupId(id);
                    }}>New group</button>
                    {draftGroup ? <button type="button" className="config-page-button" onClick={() => {
                      setDraftGroups((groups) => groups.filter((group) => group.id !== draftGroup.id));
                      setDraftGroupId("");
                    }}>Delete</button> : null}
                  </div>
                  {draftGroup ? <>
                    <input className="border border-neutral-700 bg-black p-2" value={draftGroup.name}
                      onChange={(event) => updateDraftGroup({ name: event.target.value })} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1">Order<select className="border border-neutral-700 bg-black p-2"
                        value={draftGroup.order} onChange={(event) => updateDraftGroup({ order: event.target.value as ThemeGroup["order"] })}>
                        <option value="sequential">Sequential</option><option value="shuffle">Shuffle</option>
                      </select></label>
                      <label className="grid gap-1">Change<select className="border border-neutral-700 bg-black p-2"
                        value={draftGroup.changeMode} onChange={(event) => updateDraftGroup({ changeMode: event.target.value as ThemeGroup["changeMode"] })}>
                        <option value="interval">On timer</option>
                        <option value="song">On song</option>
                        <option value="downbeat">On downbeat</option>
                      </select></label>
                      {draftGroup.changeMode === "interval" ? (
                        <SliderControlPanel
                          ariaLabel="Theme wait time"
                          ariaValueText={`${draftGroup.waitSeconds} seconds`}
                          color={[34, 211, 238]}
                          label="Wait"
                          min={0}
                          max={THEME_TIME_SLIDER_MAX}
                          step={1}
                          value={themeTimeSliderPosition(draftGroup.waitSeconds)}
                          valueText={`${draftGroup.waitSeconds}s`}
                          onPreview={(position) => updateDraftGroup({ waitSeconds: themeTimeFromSlider(position) })}
                          onCommit={(position) => updateDraftGroup({ waitSeconds: themeTimeFromSlider(position) })}
                        />
                      ) : null}
                      <SliderControlPanel
                        ariaLabel="Theme transition time"
                        ariaValueText={`${draftGroup.transitionSeconds} seconds`}
                        color={[34, 211, 238]}
                        label="Transition"
                        min={0}
                        max={THEME_TIME_SLIDER_MAX}
                        step={1}
                        value={themeTimeSliderPosition(draftGroup.transitionSeconds)}
                        valueText={`${draftGroup.transitionSeconds}s`}
                        onPreview={(position) => updateDraftGroup({ transitionSeconds: themeTimeFromSlider(position) })}
                        onCommit={(position) => updateDraftGroup({ transitionSeconds: themeTimeFromSlider(position) })}
                      />
                      <label className="flex items-center gap-2 self-end pb-1">
                        <input type="checkbox" checked={draftGroup.useGenres}
                          onChange={(event) => updateDraftGroup({ useGenres: event.target.checked })} />
                        Use song genre to choose themes
                      </label>
                      <label className="grid gap-1">House Party hue<select className="border border-neutral-700 bg-black p-2"
                        value={draftGroup.housePartyHueMode}
                        onChange={(event) => updateDraftGroup({ housePartyHueMode: event.target.value as ThemeGroup["housePartyHueMode"] })}>
                        <option value="follow">Follow hue</option>
                        <option value="complement">Complement hue</option>
                      </select></label>
                      <label className="grid gap-1">House Party brightness<select className="border border-neutral-700 bg-black p-2"
                        value={draftGroup.housePartyBrightnessMode}
                        onChange={(event) => updateDraftGroup({ housePartyBrightnessMode: event.target.value as ThemeGroup["housePartyBrightnessMode"] })}>
                        <option value="follow">Follow brightness</option>
                        <option value="oppose">Oppose brightness</option>
                        <option value="ignore">Ignore brightness</option>
                      </select></label>
                    </div>
                    <div className="grid gap-2">
                      {themeLibrary.map((theme) => {
                        const selected = draftGroup.themes.find((entry) => entry.themeId === theme.id);
                        return <div key={theme.id} className="grid gap-2 border border-neutral-800 p-3 sm:grid-cols-[auto_1fr_auto_auto]">
                          <input type="checkbox" checked={Boolean(selected)} onChange={(event) => updateDraftGroup({
                            themes: event.target.checked
                              ? [...draftGroup.themes, { themeId: theme.id, baseVariant: "dark", swapOnDownbeat: false, genres: [] }]
                              : draftGroup.themes.filter((entry) => entry.themeId !== theme.id),
                          })} />
                          <span>{theme.name}</span>
                          {selected ? <select className="bg-black" value={selected.baseVariant} onChange={(event) => updateDraftGroup({
                            themes: draftGroup.themes.map((entry) => entry.themeId === theme.id
                              ? { ...entry, baseVariant: event.target.value as "dark" | "light" } : entry),
                          })}><option value="dark">Dark normally</option><option value="light">Light normally</option></select> : null}
                          {selected ? <label><input type="checkbox" checked={selected.swapOnDownbeat} onChange={(event) => updateDraftGroup({
                            themes: draftGroup.themes.map((entry) => entry.themeId === theme.id
                              ? { ...entry, swapOnDownbeat: event.target.checked } : entry),
                          })} /> Swap on big beat</label> : null}
                          {selected ? <fieldset className="grid gap-2 sm:col-start-2 sm:col-span-3">
                            <legend className="text-xs font-black uppercase text-neutral-400">Genres</legend>
                            <details className="relative">
                              <summary className="cursor-pointer list-none border border-neutral-700 bg-black p-2 text-sm text-neutral-200 marker:content-none">
                                {selected.genres.filter((genre) => GENRE_SUGGESTION_SET.has(genre)).length
                                  ? `${selected.genres.filter((genre) => GENRE_SUGGESTION_SET.has(genre)).length} genres selected`
                                  : "Select genres"}
                              </summary>
                              <div className="absolute z-20 mt-1 grid max-h-64 w-full grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto border border-neutral-700 bg-neutral-950 p-3 shadow-2xl sm:grid-cols-3">
                                {GENRE_SUGGESTIONS.map((genre) => (
                                  <label key={genre} className="flex items-center gap-1.5 text-sm text-neutral-300">
                                    <input type="checkbox" checked={selected.genres.includes(genre)}
                                      onChange={(event) => {
                                        const genres = event.target.checked
                                          ? [...new Set([...selected.genres, genre])]
                                          : selected.genres.filter((value) => value !== genre);
                                        updateDraftGroup({
                                          themes: draftGroup.themes.map((entry) => entry.themeId === theme.id
                                            ? { ...entry, genres }
                                            : entry),
                                        });
                                      }} />
                                    {genre}
                                  </label>
                                ))}
                              </div>
                            </details>
                            <label className="grid gap-1 text-sm text-neutral-300">
                              Custom genres
                              <input className="border border-neutral-700 bg-black p-2"
                              placeholder="e.g. Shoegaze, Synthwave"
                              value={genreInputs[`${draftGroup.id}:${theme.id}`] ?? customGenres(selected.genres).join(", ")}
                              onChange={(event) => {
                                const raw = event.target.value;
                                setGenreInputs((inputs) => ({ ...inputs, [`${draftGroup.id}:${theme.id}`]: raw }));
                                const suggested = selected.genres.filter((genre) => GENRE_SUGGESTION_SET.has(genre));
                                const custom = parseGenreInput(raw)
                                  .filter((genre) => !GENRE_SUGGESTION_SET.has(genre));
                                updateDraftGroup({
                                  themes: draftGroup.themes.map((entry) => entry.themeId === theme.id
                                    ? {
                                        ...entry,
                                        genres: [...new Set([...suggested, ...custom])],
                                      }
                                    : entry),
                                });
                              }} />
                            </label>
                          </fieldset> : null}
                        </div>;
                      })}
                    </div>
                  </> : <p className="text-neutral-400">No group selected. The visualiser follows the dashboard theme.</p>}
                  <div className="flex justify-end gap-2">
                    <button type="button" className="config-page-button" onClick={() => setThemeModal(false)}>Cancel</button>
                    <button type="button" className="config-page-button config-page-button-primary" onClick={() => {
                      if (!config || !activeModule) return;
                      void save({
                        ...config, themeGroups: draftGroups,
                        moduleThemeGroupIds: draftGroupId
                          ? { ...config.moduleThemeGroupIds, [activeModule.id]: draftGroupId }
                          : Object.fromEntries(Object.entries(config.moduleThemeGroupIds).filter(([id]) => id !== activeModule.id)),
                      });
                      setThemeModal(false);
                    }}>Save</button>
                  </div>
                </div>
              </div>
            ), document.body) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-black uppercase text-neutral-200">Idle behavior</span>
                <select
                  className="border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
                  value={config.idleBehavior}
                  onChange={(event) => void save({ ...config, idleBehavior: event.target.value as Config["idleBehavior"] })}
                >
                  <option value="ambient">Ambient module</option>
                  <option value="black">Black screen</option>
                  <option value="return">Return to dashboard</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-black uppercase text-neutral-200">Quality</span>
                <select
                  className="border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
                  value={config.quality}
                  onChange={(event) => void save({ ...config, quality: event.target.value as Config["quality"] })}
                >
                  <option value="auto">Auto</option>
                  <option value="high">High</option>
                  <option value="balanced">Balanced</option>
                  <option value="performance">Performance</option>
                </select>
              </label>
            </div>

            <label className="grid gap-2 text-sm">
              <span className="font-black uppercase text-neutral-200">Message</span>
              <input
                type="text"
                className="border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
                maxLength={160}
                placeholder="Optional message shown in the visualiser — emojis welcome ✨"
                value={config.message}
                onChange={(event) => setConfig({ ...config, message: event.target.value })}
                onBlur={(event) => void save({ ...config, message: event.currentTarget.value })}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={config.providers.spotify}
                  onChange={(event) => void save({ ...config, providers: { ...config.providers, spotify: event.target.checked } })}
                />
                Spotify beat timestamps
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={config.providers.songle}
                  onChange={(event) => void save({ ...config, providers: { ...config.providers, songle: event.target.checked } })}
                />
                Songle beat timestamps
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={config.providers.essentia}
                  onChange={(event) => void save({ ...config, providers: { ...config.providers, essentia: event.target.checked } })}
                />
                Local Essentia analysis
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={config.providers.reccoBeats}
                  onChange={(event) => void save({ ...config, providers: { ...config.providers, reccoBeats: event.target.checked } })}
                />
                ReccoBeats BPM fallback
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={config.providers.lrclib}
                  onChange={(event) => void save({ ...config, providers: { ...config.providers, lrclib: event.target.checked } })}
                />
                Timed lyrics
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={config.statusOverlay}
                  onChange={(event) => void save({ ...config, statusOverlay: event.target.checked })}
                />
                Ambient status
              </label>
            </div>

            <div className="grid gap-2 text-sm">
              <SliderControlPanel
                ariaLabel="Random light hue offset range"
                ariaValueText={`±${Math.round(config.housePartyRandomHueOffset)} degrees`}
                color={[34, 211, 238]}
                label="Random light hue offset"
                min={0}
                max={180}
                step={1}
                value={config.housePartyRandomHueOffset}
                valueText={`±${Math.round(config.housePartyRandomHueOffset)}°`}
                onPreview={(value) => setConfig({
                  ...config,
                  housePartyRandomHueOffset: value,
                })}
                onCommit={(value) => void save({
                  ...config,
                  housePartyRandomHueOffset: value,
                })}
              />
              <span className="text-xs text-neutral-500">
                Each light independently samples the full −{Math.round(config.housePartyRandomHueOffset)}°
                to +{Math.round(config.housePartyRandomHueOffset)}° range on every House Party update.
              </span>
            </div>

            {activeModule?.settings.length ? (
              <div className="grid gap-4 border-t border-neutral-800 pt-4">
                <p className="font-black uppercase text-neutral-200">Module controls</p>
                {Object.entries(activeModule.settings.reduce<Record<string, ModuleSetting[]>>((groups, setting) => {
                  const section = setting.section?.trim() || "General";
                  (groups[section] ??= []).push(setting);
                  return groups;
                }, {})).map(([section, settings]) => (
                  <details key={section} className="group border border-neutral-800 bg-neutral-950/30">
                    <summary className="cursor-pointer select-none px-3 py-3 font-black uppercase text-neutral-200">
                      {section}
                    </summary>
                    <div className="grid gap-3 border-t border-neutral-800 p-3">
                {settings.map((setting) => {
                  const saved = setting.updateMode === "structural"
                    ? config.pendingStructuralModuleSettings[activeModule.id]?.[setting.id]
                      ?? config.moduleSettings[activeModule.id]?.[setting.id] ?? setting.default
                    : config.moduleSettings[activeModule.id]?.[setting.id] ?? setting.default;
                  const nextConfig = (value: number): Config => ({
                    ...config,
                    ...(setting.updateMode === "structural" ? {
                      pendingStructuralModuleSettings: {
                        ...config.pendingStructuralModuleSettings,
                        [activeModule.id]: {
                          ...(config.pendingStructuralModuleSettings[activeModule.id] ?? {}),
                          [setting.id]: clampSetting(setting, value),
                        },
                      },
                    } : {}),
                    moduleSettings: {
                      ...config.moduleSettings,
                      [activeModule.id]: {
                        ...(config.moduleSettings[activeModule.id] ?? {}),
                        ...(setting.updateMode === "structural" ? {} : { [setting.id]: clampSetting(setting, value) }),
                      },
                    },
                  });
                  const details = [
                    setting.control === "toggle" ? "" : setting.description,
                    setting.affects?.length ? `Affects ${setting.affects.join(", ")}` : "",
                    setting.curve?.type === "power" ? `Power curve ${setting.curve.exponent}` : "",
                  ].filter(Boolean);
                  return (
                    <div key={setting.id} className="grid gap-2 border border-neutral-800 bg-neutral-950/45 p-3 text-sm">
                      {setting.control !== "slider" && setting.control !== "toggle" ? (
                        <span className="flex justify-between gap-3">
                          <span className="font-bold uppercase text-neutral-300">{setting.label}</span>
                          <span className="font-mono text-cyan-200">{formatSettingValue(setting, saved)}</span>
                        </span>
                      ) : null}
                      {setting.control === "toggle" ? (
                        <CheckboxRow
                          checked={saved >= 0.5}
                          detail={setting.description ?? `${setting.label} is ${saved >= 0.5 ? "enabled" : "disabled"}.`}
                          label={setting.label}
                          onChange={(checked) => void save(nextConfig(checked ? 1 : 0))}
                        />
                      ) : setting.control === "select" ? (
                        <select
                          className="border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
                          value={saved}
                          onChange={(event) => void save(nextConfig(Number(event.target.value)))}
                        >
                          {(setting.options ?? []).map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      ) : setting.control === "number" ? (
                        <input
                          type="number"
                          className="border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
                          min={setting.min}
                          max={setting.max}
                          step={setting.step}
                          value={saved}
                          onChange={(event) => setConfig(nextConfig(Number(event.target.value)))}
                          onBlur={(event) => void save(nextConfig(Number(event.currentTarget.value)))}
                        />
                      ) : (
                        <SliderControlPanel
                          ariaLabel={setting.label}
                          ariaValueText={formatSettingValue(setting, saved)}
                          color={[34, 211, 238]}
                          label={setting.label}
                          min={0}
                          max={1}
                          step={0.001}
                          value={sliderPosition(setting, saved)}
                          valueText={formatSettingValue(setting, saved)}
                          snapValue={sliderPosition(setting, setting.default)}
                          onPreview={(position) => {
                            setConfig(nextConfig(sliderValue(setting, position)));
                          }}
                          onCommit={(position) => {
                            void save(nextConfig(sliderValue(setting, position)));
                          }}
                        />
                      )}
                      {details.length ? (
                        <span className="text-xs leading-relaxed text-neutral-500">{details.join(" · ")}</span>
                      ) : null}
                    </div>
                  );
                })}
                    </div>
                  </details>
                ))}
                {Object.keys(config.pendingStructuralModuleSettings[activeModule.id] ?? {}).length ? (
                  <button type="button" className="config-page-button config-page-button-primary" onClick={() => {
                    const pending = config.pendingStructuralModuleSettings[activeModule.id] ?? {};
                    void save({
                      ...config,
                      moduleSettings: {
                        ...config.moduleSettings,
                        [activeModule.id]: { ...(config.moduleSettings[activeModule.id] ?? {}), ...pending },
                      },
                      pendingStructuralModuleSettings: Object.fromEntries(
                        Object.entries(config.pendingStructuralModuleSettings).filter(([id]) => id !== activeModule.id),
                      ),
                      moduleReloadGenerations: {
                        ...config.moduleReloadGenerations,
                        [activeModule.id]: (config.moduleReloadGenerations[activeModule.id] ?? 0) + 1,
                      },
                    });
                  }}>Apply structural changes and restart visualiser</button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

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
            <button className="config-page-button config-page-button-primary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> Upload module package
            </button>
            <button className="config-page-button" type="button" disabled={busy} onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button className="config-page-button" type="button" onClick={() => void loadDiagnostics()}>
              <Activity className="h-4 w-4" /> Diagnostics
            </button>
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
                  <button
                    type="button"
                    className="config-page-button"
                    aria-label={`Remove ${module.name} ${module.version}`}
                    disabled={busy}
                    onClick={() => void removeModule(module)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : <span className="text-xs font-black uppercase text-cyan-300">Built in</span>}
              </div>
            ))}
          </div>
        </div>

        {diagnostics ? <pre className="max-h-72 overflow-auto border border-neutral-800 bg-black p-3 text-xs text-cyan-100">{diagnostics}</pre> : null}
      </div>
    </ConfigAccordion>
  );
}
