"use client";

import {
  Activity,
  AudioLines,
  Box,
  Check,
  CircleDot,
  Clock3,
  Contrast,
  CopyPlus,
  Dice5,
  House,
  ListOrdered,
  MonitorOff,
  Moon,
  Music2,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Trash2,
  Upload,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CheckboxRow,
  ColorIntensitySlider,
  ColorSpectrum,
  ColorWidget,
  ConfigAccordion,
  EnvelopeSliderControlPanel,
  RangeSliderControlPanel,
  SliderControlPanel,
} from "./ConfigControls";
import { ConfigSelect } from "./ConfigSelect";
import { ModalOverlay } from "./ModalOverlay";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import type { ThemeColorValue } from "./accentColor";
import { decimalStepGranularity } from "../../lib/slider-step";

export type ModuleSetting = {
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
  paletteSlots: Array<{ id: string; label: string; defaultRgb: [number, number, number] }>;
};

type Config = {
  activeModuleId: string;
  activeModuleVersion: string;
  idleBehavior: "ambient" | "black" | "return";
  message: string;
  messageScaleSource: ParameterSource;
  glowOverlay: GlowOverlay;
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
  moduleParameterSources: Record<string, Record<string, ParameterSource>>;
  pendingStructuralModuleSettings: Record<string, Record<string, number>>;
  moduleReloadGenerations: Record<string, number>;
  colorGroups: ColorGroup[];
  moduleColorGroupIds: Record<string, string>;
  editorPreviewColorGroupId: string;
  editorPreviewColorThemeId: string;
};

export type GlowOverlay = {
  blendModeSource: ParameterSource;
  blurSource: ParameterSource;
  opacitySource: ParameterSource;
};

export type ParameterSource =
  | { type: "manual"; value: number }
  | { type: "random"; min: number; max: number; cadence: "beat" | "downbeat" | "bar" | "song" | "interval"; intervalSeconds: number; transitionSeconds: number }
  | { type: "beat" | "downbeat" | "energy" | "bass" | "mid" | "treble"; min: number; max: number; attackSeconds: number; holdSeconds: number; releaseSeconds: number };

export function envelopeDurations(source: Extract<ParameterSource, { attackSeconds: number }>): [number, number, number] {
  const finiteOr = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return [
    Math.max(0, finiteOr(source.attackSeconds, 0.05)),
    Math.max(0, finiteOr(source.holdSeconds, 0)),
    Math.max(0, finiteOr(source.releaseSeconds, 0.6)),
  ];
}
type VisualiserColorValue = ThemeColorValue & { opacity: number };
type ColorTheme = {
  id: string;
  name: string;
  colors: Record<string, VisualiserColorValue>;
  parameterOverrides: Record<string, Record<string, ParameterSource>>;
};
type ColorGroup = {
  id: string; moduleId: string; name: string; themes: ColorTheme[]; order: "sequential" | "shuffle";
  changeMode: "interval" | "song" | "downbeat"; waitSeconds: number; transitionSeconds: number;
  housePartyHueMode: "follow" | "complement";
  housePartyBrightnessMode: "follow" | "oppose" | "ignore";
};
type Payload = {
  config: Config; modules: ModuleSummary[];
  error?: string;
};
const MESSAGE_SCALE_SETTING: ModuleSetting = {
  id: "messageScale",
  label: "Message scale",
  description: "Centered scale applied to the user-defined visualiser message.",
  control: "slider",
  min: 0.1,
  max: 5,
  step: 0.1,
  default: 1,
  affects: ["message"],
  curve: { type: "linear", exponent: 1 },
  options: [],
  section: "Message",
  updateMode: "smooth",
};
// The glow overlay's three driven parameters. Declared as settings so they use
// the same `ParameterDriverControls` as every other driven value: the manual
// control and the driver picker are one control, not two.
const GLOW_BLUR_SETTING: ModuleSetting = {
  id: "glowBlur",
  label: "Blur amount",
  description: "Softness of the glow laid back over the finished picture.",
  control: "slider",
  min: 0,
  max: 20,
  step: 0.1,
  default: 0,
  affects: ["glow"],
  curve: { type: "linear", exponent: 1 },
  options: [],
  section: "Glow overlay",
  updateMode: "smooth",
};
const GLOW_OPACITY_SETTING: ModuleSetting = {
  id: "glowOpacity",
  label: "Opacity",
  description: "How much of the glow layer is blended in. Zero disables the pass entirely.",
  control: "slider",
  min: 0,
  max: 100,
  step: 1,
  default: 0,
  affects: ["glow"],
  curve: { type: "linear", exponent: 1 },
  options: [],
  section: "Glow overlay",
  updateMode: "smooth",
};
// Blend mode as a driven parameter. Every driver produces a continuous number,
// so the modes sit on a whole-numbered axis and both engines snap to the
// nearest — no cross-fade, because a swap on the beat should read as a switch.
// A step of 1 keeps the manual choice and both driver endpoints on real modes.
// Modes are only ever appended: a stored driver range is a pair of numbers on
// this axis, so renumbering would silently repoint existing configurations.
const GLOW_BLEND_SETTING: ModuleSetting = {
  id: "glowBlend",
  label: "Blend mode",
  description: "How the glow layer is blended in, as a driven parameter.",
  control: "select",
  min: 0,
  max: 2,
  step: 1,
  default: 0,
  affects: ["glow"],
  curve: { type: "linear", exponent: 1 },
  options: [
    { value: 0, label: "Screen" },
    { value: 1, label: "Multiply" },
    { value: 2, label: "Overlay" },
  ],
  section: "Glow overlay",
  updateMode: "smooth",
};
const GLOW_BLEND_ICONS: Record<number, ReactNode> = {
  0: <Sun />,
  1: <Moon />,
  2: <Contrast />,
};
const THEME_TIME_MAX_SECONDS = 600;
const THEME_TIME_SLIDER_MAX = 100;
const THEME_TIME_LOG_OFFSET = 10;

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

// The transition is the one theme time worth setting finely: a quarter-second
// difference in a cross-fade is visible, where a quarter second on a 60-second
// wait is not. It therefore resolves to one decimal place across the short end
// of the same logarithmic slider, and only joins the coarse ladder above it.
function themeTransitionFromSlider(position: number) {
  const normalized = Math.max(0, Math.min(THEME_TIME_SLIDER_MAX, position)) / THEME_TIME_SLIDER_MAX;
  const rawSeconds = THEME_TIME_LOG_OFFSET
    * Math.expm1(Math.log1p(THEME_TIME_MAX_SECONDS / THEME_TIME_LOG_OFFSET) * normalized);
  const rounded = rawSeconds <= 30 ? Math.round(rawSeconds * 10) / 10 : themeTimeFromSlider(position);
  return Math.max(0, Math.min(THEME_TIME_MAX_SECONDS, rounded));
}

function formatThemeSeconds(seconds: number) {
  return `${seconds.toFixed(1)}s`;
}

function moduleKey(module: Pick<ModuleSummary, "id" | "version">) {
  return `${module.id}@${module.version}`;
}

// Every Phonoscope value resolves to a single decimal place. Module manifests
// are free to declare finer steps, but two- and three-decimal precision was
// never readable on a slider at television distance and never audibly changed
// the picture, so anything finer than 0.1 is coerced up here — for the stepping
// as well as for the read-out, which keeps the two in agreement.
function phonoscopeStep(step: number) {
  return step >= 0.1 ? step : 0.1;
}

function clampSetting(setting: ModuleSetting, value: number) {
  if (setting.control === "toggle") return value >= 0.5 ? 1 : 0;
  if (setting.control === "select") {
    return setting.options?.some((option) => option.value === value) ? value : setting.default;
  }
  const clamped = Math.max(setting.min, Math.min(setting.max, value));
  const step = decimalStepGranularity(phonoscopeStep(setting.step));
  const stepped = setting.min + Math.round((clamped - setting.min) / step) * step;
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
  const decimals = Math.min(1, Math.max(0, (String(phonoscopeStep(setting.step)).split(".")[1] ?? "").length));
  return value.toFixed(decimals);
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultSource(setting: ModuleSetting, inherited: number): ParameterSource {
  return { type: "manual", value: clampSetting(setting, inherited) };
}

export function sourceWithType(
  setting: ModuleSetting,
  source: ParameterSource,
  type: ParameterSource["type"],
): ParameterSource {
  if (type === source.type) return source;
  if (type === "manual") {
    return {
      type,
      value: clampSetting(setting, source.type === "manual" ? source.value : source.max),
    };
  }
  if (source.type !== "manual") {
    const min = clampSetting(setting, source.min);
    const max = Math.max(min, clampSetting(setting, source.max));
    if (type === "random") {
      return source.type === "random"
        ? { ...source, type, min, max }
        : { type, min, max, cadence: "beat", intervalSeconds: 4, transitionSeconds: 0.5 };
    }
    return source.type === "random"
      ? { type, min, max, attackSeconds: 0.05, holdSeconds: 0, releaseSeconds: 0.6 }
      : { ...source, type, min, max };
  }
  const value = clampSetting(setting, source.value);
  const spread = Math.max(decimalStepGranularity(setting.step), (setting.max - setting.min) * 0.2);
  // A setting whose values are named choices only has somewhere to travel if
  // the driven range spans them: shrinking towards the manual value the way a
  // continuous setting does would hand back a driver that can never change the
  // choice it is driving.
  const namedChoices = setting.control === "select" && (setting.options?.length ?? 0) > 1;
  const max = namedChoices ? setting.max : value;
  const min = namedChoices ? setting.min : Math.min(max, clampSetting(setting, max - spread));
  if (type === "random") {
    return { type, min, max, cadence: "beat", intervalSeconds: 4, transitionSeconds: 0.5 };
  }
  return { type, min, max, attackSeconds: 0.05, holdSeconds: 0, releaseSeconds: 0.6 };
}

export function visualiserThemePreviewColors(colors: ColorTheme["colors"]) {
  const rgb = (ids: string[], fallback: string) => {
    const value = ids.map((id) => colors[id]).find(Boolean);
    if (!value) return fallback;
    const intensity = Number.isFinite(value.intensity) ? value.intensity : 100;
    const opacity = Number.isFinite(value.opacity) ? value.opacity : 100;
    const scale = intensity / 100;
    return `rgb(${value.rgb.map((part) => Math.round(part * scale)).join(" ")} / ${opacity / 100})`;
  };
  return {
    background: rgb(["backgroundPrimary", "background"], "#000"),
    dot: rgb(["dotPrimary", "primary"], "#777"),
    glow: rgb(["glowPrimary", "secondary"], "#ddd"),
  };
}

export function visualiserThemePreviewGradient(colors: ColorTheme["colors"]) {
  const preview = visualiserThemePreviewColors(colors);
  return `linear-gradient(135deg, ${preview.background} 0 33.333%, ${preview.dot} 33.333% 66.666%, ${preview.glow} 66.666%)`;
}

function themeSwatch(theme: ColorTheme) {
  return (
    <span
      className="cyber-select-swatch"
      aria-hidden="true"
      style={{ background: visualiserThemePreviewGradient(theme.colors) }}
    />
  );
}

function hasThemeColors(theme: ColorTheme) {
  return Object.values(theme.colors).some((color) =>
    Array.isArray(color.rgb)
    && color.rgb.length === 3
    && color.rgb.every(Number.isFinite)
  );
}

function parameterSourceIcon(type: ParameterSource["type"]) {
  switch (type) {
    case "manual": return <SlidersHorizontal />;
    case "random": return <Dice5 />;
    case "beat": return <Activity />;
    case "downbeat": return <AudioLines />;
    case "energy": return <Zap />;
    case "bass": return <Waves />;
    case "mid": return <AudioLines />;
    case "treble": return <Sparkles />;
  }
}

function ParameterDriverControls({
  inherited,
  manualOptionIcons,
  onCommit,
  onPreview,
  setting,
  source,
}: {
  inherited: number;
  /** Optional glyphs for a `select` setting's manual listbox. */
  manualOptionIcons?: Record<number, ReactNode>;
  onCommit: (source: ParameterSource) => void;
  onPreview: (source: ParameterSource) => void;
  setting: ModuleSetting;
  source: ParameterSource;
}) {
  // A setting whose values are named choices keeps its listbox for the manual
  // case rather than degrading to a two-position slider. Driven, it is the
  // ordinary range/envelope pair: the endpoints are still the named choices,
  // and the engines threshold whatever the driver produces between them.
  const manualOptions = setting.control === "select" ? setting.options ?? [] : [];
  return (
    <div className="grid gap-3">
      <ConfigSelect
        label="Parameter source"
        value={source.type}
        options={(["manual", "random", "beat", "downbeat", "energy", "bass", "mid", "treble"] as ParameterSource["type"][]).map((type) => ({
          value: type,
          label: type.charAt(0).toUpperCase() + type.slice(1),
          icon: parameterSourceIcon(type),
        }))}
        onChange={(type) => onCommit(sourceWithType(setting, source, type))}
      />
      {source.type === "manual" && manualOptions.length > 0 ? (
        <ConfigSelect
          ariaLabel={`${setting.label} manual value`}
          label="Manual"
          value={String(clampSetting(setting, source.value))}
          options={manualOptions.map((option) => ({
            value: String(option.value),
            label: option.label,
            icon: manualOptionIcons?.[option.value],
          }))}
          onChange={(value) => onCommit({
            type: "manual",
            value: clampSetting(setting, Number(value)),
          })}
        />
      ) : source.type === "manual" ? (
        <SliderControlPanel
          ariaLabel={`${setting.label} manual value`}
          ariaValueText={formatSettingValue(setting, source.value)}
          color={[34, 211, 238]}
          label="Manual"
          min={0}
          max={1}
          step={0.001}
          value={sliderPosition(setting, source.value)}
          valueText={formatSettingValue(setting, source.value)}
          snapValue={sliderPosition(setting, inherited)}
          onPreview={(position) => onPreview({ type: "manual", value: sliderValue(setting, position) })}
          onCommit={(position) => onCommit({ type: "manual", value: sliderValue(setting, position) })}
        />
      ) : (
        <>
          <RangeSliderControlPanel
            ariaLabel={`${setting.label} driven range`}
            label="Minimum / Maximum"
            min={setting.min}
            max={setting.max}
            step={setting.step}
            value={[source.min, source.max]}
            formatValue={(value) => formatSettingValue(setting, value)}
            onPreview={([min, max]) => onPreview({ ...source, min, max })}
            onCommit={([min, max]) => onCommit({ ...source, min, max })}
          />
          {source.type === "random" ? (
            <>
              <ConfigSelect
                label="Random cadence"
                value={source.cadence}
                options={[
                  { value: "beat", label: "Beat", icon: <Activity /> },
                  { value: "downbeat", label: "Downbeat", icon: <AudioLines /> },
                  { value: "bar", label: "Bar", icon: <ListOrdered /> },
                  { value: "song", label: "Song", icon: <Music2 /> },
                  { value: "interval", label: "Timed interval", icon: <Clock3 /> },
                ]}
                onChange={(cadence) => onCommit({ ...source, cadence })}
              />
              {source.cadence === "interval" ? (
                <SliderControlPanel
                  ariaLabel="Random interval"
                  ariaValueText={`${source.intervalSeconds} seconds`}
                  color={[34, 211, 238]}
                  label="Interval"
                  min={0.25}
                  max={60}
                  step={0.1}
                  value={source.intervalSeconds}
                  valueText={`${source.intervalSeconds.toFixed(1)}s`}
                  onPreview={(intervalSeconds) => onPreview({ ...source, intervalSeconds })}
                  onCommit={(intervalSeconds) => onCommit({ ...source, intervalSeconds })}
                />
              ) : null}
              <SliderControlPanel
                ariaLabel="Random transition"
                ariaValueText={`${source.transitionSeconds} seconds`}
                color={[34, 211, 238]}
                label="Transition"
                min={0}
                max={10}
                step={0.1}
                value={source.transitionSeconds}
                valueText={`${source.transitionSeconds.toFixed(1)}s`}
                onPreview={(transitionSeconds) => onPreview({ ...source, transitionSeconds })}
                onCommit={(transitionSeconds) => onCommit({ ...source, transitionSeconds })}
              />
            </>
          ) : (
            <EnvelopeSliderControlPanel
              ariaLabel={`${setting.label} envelope`}
              value={envelopeDurations(source)}
              onPreview={([attackSeconds, holdSeconds, releaseSeconds]) => onPreview({ ...source, attackSeconds, holdSeconds, releaseSeconds })}
              onCommit={([attackSeconds, holdSeconds, releaseSeconds]) => onCommit({ ...source, attackSeconds, holdSeconds, releaseSeconds })}
            />
          )}
        </>
      )}
    </div>
  );
}

export function PhonoscopeConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [themeModal, setThemeModal] = useState(false);
  const [draftGroups, setDraftGroups] = useState<ColorGroup[]>([]);
  const [draftGroupId, setDraftGroupId] = useState("");
  const [draftThemeId, setDraftThemeId] = useState("");
  const [activeColorSlot, setActiveColorSlot] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<"group" | "theme" | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const editorSaveChain = useRef<Promise<void>>(Promise.resolve());
  const editorPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/phonoscope/config", { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error ?? "Failed to load Phonoscope");
      setConfig(payload.config);
      setModules(payload.modules);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load Phonoscope");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      setConfig(payload.config);
      // No "saved" banner: settings commit on every slider release, and the
      // status line sits above the controls, so showing then clearing it shifts
      // the page out from under the gesture. Only failures are announced.
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save Phonoscope");
      await load();
    } finally {
      if (!quiet) setBusy(false);
    }
  }, [load]);
  const activeModule = useMemo(
    () => modules.find((module) => module.id === config?.activeModuleId && module.version === config?.activeModuleVersion),
    [config, modules],
  );
  const activeModuleColorGroups = config && activeModule
    ? config.colorGroups.filter((group) => group.moduleId === activeModule.id)
    : [];
  const activeColorGroup = config && activeModule
    ? activeModuleColorGroups.find((group) => group.id === config.moduleColorGroupIds[activeModule.id])
      ?? activeModuleColorGroups[0]
    : undefined;
  const draftGroup = draftGroups.find((group) => group.id === draftGroupId);
  const draftTheme = draftGroup?.themes.find((theme) => theme.id === draftThemeId) ?? draftGroup?.themes[0];
  const persistEditor = useCallback((
    groups: ColorGroup[],
    groupId: string,
    themeId: string,
    preview = true,
  ) => {
    if (!config || !activeModule) return Promise.resolve();
    const next: Config = {
      ...config,
      colorGroups: [
        ...config.colorGroups.filter((group) => group.moduleId !== activeModule.id),
        ...groups.map((group) => ({ ...group, moduleId: activeModule.id })),
      ],
      moduleColorGroupIds: groupId
        ? { ...config.moduleColorGroupIds, [activeModule.id]: groupId }
        : config.moduleColorGroupIds,
      editorPreviewColorGroupId: preview ? groupId : "",
      editorPreviewColorThemeId: preview ? themeId : "",
    };
    editorSaveChain.current = editorSaveChain.current
      .catch(() => undefined)
      .then(async () => { await save(next, { quiet: preview }); });
    return editorSaveChain.current;
  }, [activeModule, config, save]);
  const cancelQueuedEditorSave = useCallback(() => {
    if (editorPreviewTimer.current !== null) {
      clearTimeout(editorPreviewTimer.current);
      editorPreviewTimer.current = null;
    }
  }, []);
  const queueEditorSave = useCallback((groups: ColorGroup[], groupId: string, themeId: string) => {
    // Dot controls emit many preview samples while dragging. Coalesce them to
    // a short cadence so edits are saved and broadcast during the gesture
    // without turning one drag into dozens of preference writes.
    cancelQueuedEditorSave();
    editorPreviewTimer.current = setTimeout(() => {
      editorPreviewTimer.current = null;
      void persistEditor(groups, groupId, themeId);
    }, 75);
  }, [cancelQueuedEditorSave, persistEditor]);
  useEffect(() => cancelQueuedEditorSave, [cancelQueuedEditorSave]);
  const updateDraftGroup = (patch: Partial<ColorGroup>, commit = false) => {
    const next = draftGroups.map((group) => group.id === draftGroupId ? { ...group, ...patch } : group);
    setDraftGroups(next);
    if (commit) {
      cancelQueuedEditorSave();
      void persistEditor(next, draftGroupId, draftThemeId);
    } else {
      queueEditorSave(next, draftGroupId, draftThemeId);
    }
  };
  const updateDraftTheme = (patch: Partial<ColorTheme>, commit = false) => {
    const next = draftGroups.map((group) => group.id !== draftGroupId ? group : {
      ...group,
      themes: group.themes.map((theme) => theme.id === draftTheme?.id ? { ...theme, ...patch } : theme),
    });
    setDraftGroups(next);
    if (commit) {
      cancelQueuedEditorSave();
      void persistEditor(next, draftGroupId, draftThemeId);
    } else {
      queueEditorSave(next, draftGroupId, draftThemeId);
    }
  };
  const openThemeModal = () => {
    if (!config || !activeModule) return;
    const groups = structuredClone(activeModuleColorGroups);
    if (!groups.length) return;
    setDraftGroups(groups);
    const group = activeColorGroup ?? groups[0];
    setDraftGroupId(group?.id ?? "");
    setDraftThemeId(group?.themes[0]?.id ?? "");
    setThemeModal(true);
    void persistEditor(groups, group?.id ?? "", group?.themes[0]?.id ?? "");
  };

  const closeThemeModal = useCallback(async () => {
    cancelQueuedEditorSave();
    await persistEditor(draftGroups, draftGroupId, draftThemeId, false);
    setThemeModal(false);
    setActiveColorSlot(null);
    setRenaming(null);
  }, [cancelQueuedEditorSave, draftGroupId, draftGroups, draftThemeId, persistEditor]);

  const updateOverride = (setting: ModuleSetting, source: ParameterSource | null, commit = false) => {
    if (!activeModule || !draftTheme) return;
    const moduleOverrides = { ...(draftTheme.parameterOverrides[activeModule.id] ?? {}) };
    if (source) moduleOverrides[setting.id] = source;
    else delete moduleOverrides[setting.id];
    const parameterOverrides = { ...draftTheme.parameterOverrides };
    if (Object.keys(moduleOverrides).length) parameterOverrides[activeModule.id] = moduleOverrides;
    else delete parameterOverrides[activeModule.id];
    updateDraftTheme({ parameterOverrides }, commit);
  };

  const finishRename = () => {
    const name = nameDraft.trim();
    if (!name) return;
    if (renaming === "group") updateDraftGroup({ name: name.slice(0, 60) }, true);
    if (renaming === "theme") updateDraftTheme({ name: name.slice(0, 60) }, true);
    setRenaming(null);
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
            <ConfigSelect
              label="Active module"
              ariaLabel="Active visualiser module"
              value={moduleKey(activeModule ?? modules[0])}
              disabled={busy}
              options={modules.map((module) => ({
                value: moduleKey(module),
                label: module.name,
                detail: module.dimension.toUpperCase(),
                icon: module.dimension === "3d" ? <Box /> : <Square />,
              }))}
              onChange={(key) => {
                const selected = modules.find((module) => moduleKey(module) === key);
                if (selected) void save({ ...config, activeModuleId: selected.id, activeModuleVersion: selected.version });
              }}
            />

            {activeModule?.description ? <p className="text-sm text-neutral-400">{activeModule.description}</p> : null}

            <ModalOverlay
              open={themeModal}
              onClose={() => void closeThemeModal()}
              ariaLabel="Visualiser colour effects"
              className="grid max-h-[92vh] w-[min(1100px,94vw)] gap-4 overflow-y-auto border border-cyan-500/40 bg-neutral-950 p-5"
            >
              <header className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-black uppercase text-cyan-100">Visualiser colour effects</h2>
                  <p className="mt-1 text-sm text-neutral-400">Colour group → colour theme → parameter override → parameter source</p>
                </div>
                <MomentaryFeedbackButton type="button" className="icon-link" aria-label="Close effects editor" onClick={() => void closeThemeModal()}>
                  <X className="h-5 w-5" />
                </MomentaryFeedbackButton>
              </header>

              {draftGroup ? (
                <>
                  <div className="grid gap-3">
                    <ConfigSelect
                      label="Colour group"
                      value={draftGroup.id}
                      options={draftGroups.map((group) => {
                        const previewTheme = group.themes.find(hasThemeColors);
                        return {
                          value: group.id,
                          label: group.name,
                          detail: `${group.themes.length} colour theme${group.themes.length === 1 ? "" : "s"}`,
                          icon: previewTheme ? undefined : <Palette />,
                          swatch: previewTheme ? themeSwatch(previewTheme) : undefined,
                        };
                      })}
                      onChange={(id) => {
                        const group = draftGroups.find((candidate) => candidate.id === id);
                        const themeId = group?.themes[0]?.id ?? "";
                        setDraftGroupId(id);
                        setDraftThemeId(themeId);
                        void persistEditor(draftGroups, id, themeId);
                      }}
                    />
                    {renaming === "group" ? (
                      <div className="theme-library-name-field">
                        <input
                          className="cyber-text-input"
                          value={nameDraft}
                          aria-label="Colour group name"
                          maxLength={60}
                          onChange={(event) => setNameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") finishRename();
                            if (event.key === "Escape") setRenaming(null);
                          }}
                        />
                        <MomentaryFeedbackButton type="button" className="icon-link" aria-label="Confirm group name" onClick={finishRename}><Check className="h-5 w-5" /></MomentaryFeedbackButton>
                        <MomentaryFeedbackButton type="button" className="icon-link" aria-label="Cancel group rename" onClick={() => setRenaming(null)}><X className="h-5 w-5" /></MomentaryFeedbackButton>
                      </div>
                    ) : (
                      <div className="theme-library-actions">
                        <MomentaryFeedbackButton type="button" className="theme-library-button" onClick={() => {
                          const id = createId("color_group");
                          const source = draftGroup.themes[0] ?? activeColorGroup?.themes[0];
                          const next: ColorGroup = {
                            ...draftGroup,
                            id,
                            name: "New Colour Group",
                            themes: source ? [{ ...structuredClone(source), id: createId("theme"), name: "Default" }] : [],
                          };
                          const groups = [...draftGroups, next];
                          setDraftGroups(groups);
                          setDraftGroupId(id);
                          setDraftThemeId(next.themes[0]?.id ?? "");
                          void persistEditor(groups, id, next.themes[0]?.id ?? "");
                          setRenaming("group");
                          setNameDraft(next.name);
                        }}><Plus className="h-4 w-4" />New</MomentaryFeedbackButton>
                        <MomentaryFeedbackButton type="button" className="theme-library-button" onClick={() => {
                          const id = createId("color_group");
                          const next = structuredClone({
                            ...draftGroup,
                            id,
                            name: `${draftGroup.name} Copy`,
                            themes: draftGroup.themes.map((theme) => ({ ...theme, id: createId("theme") })),
                          });
                          const groups = [...draftGroups, next];
                          setDraftGroups(groups);
                          setDraftGroupId(id);
                          setDraftThemeId(next.themes[0]?.id ?? "");
                          void persistEditor(groups, id, next.themes[0]?.id ?? "");
                        }}><CopyPlus className="h-4 w-4" />Duplicate</MomentaryFeedbackButton>
                        <MomentaryFeedbackButton type="button" className="theme-library-button" onClick={() => {
                          setRenaming("group");
                          setNameDraft(draftGroup.name);
                        }}><Pencil className="h-4 w-4" />Rename</MomentaryFeedbackButton>
                        <MomentaryFeedbackButton
                          type="button"
                          className="theme-library-button theme-library-button-danger"
                          disabled={draftGroups.length <= 1}
                          onClick={() => {
                            const remaining = draftGroups.filter((group) => group.id !== draftGroup.id);
                            setDraftGroups(remaining);
                            setDraftGroupId(remaining[0]?.id ?? "");
                            setDraftThemeId(remaining[0]?.themes[0]?.id ?? "");
                            void persistEditor(remaining, remaining[0]?.id ?? "", remaining[0]?.themes[0]?.id ?? "");
                          }}
                        ><Trash2 className="h-4 w-4" />Delete</MomentaryFeedbackButton>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <ConfigSelect
                      label="Order"
                      value={draftGroup.order}
                      options={[
                        { value: "sequential", label: "Sequential", detail: "Use the listed order", icon: <ListOrdered /> },
                        { value: "shuffle", label: "Shuffle", detail: "Avoid repeating the current theme", icon: <Shuffle /> },
                      ]}
                      onChange={(order) => updateDraftGroup({ order }, true)}
                    />
                    <ConfigSelect
                      label="Change colour theme"
                      value={draftGroup.changeMode}
                      options={[
                        { value: "interval", label: "On timer", icon: <Clock3 /> },
                        { value: "song", label: "On song", icon: <Music2 /> },
                        { value: "downbeat", label: "On downbeat", icon: <AudioLines /> },
                      ]}
                      onChange={(changeMode) => updateDraftGroup({ changeMode }, true)}
                    />
                    {draftGroup.changeMode === "interval" ? (
                      <SliderControlPanel
                        ariaLabel="Colour theme wait time"
                        ariaValueText={`${draftGroup.waitSeconds} seconds`}
                        color={[34, 211, 238]}
                        label="Wait"
                        min={0}
                        max={THEME_TIME_SLIDER_MAX}
                        step={1}
                        value={themeTimeSliderPosition(draftGroup.waitSeconds)}
                        valueText={`${draftGroup.waitSeconds}s`}
                        onPreview={(position) => updateDraftGroup({ waitSeconds: themeTimeFromSlider(position) })}
                        onCommit={(position) => updateDraftGroup({ waitSeconds: themeTimeFromSlider(position) }, true)}
                      />
                    ) : null}
                    <SliderControlPanel
                      ariaLabel="Colour theme transition time"
                      ariaValueText={`${draftGroup.transitionSeconds.toFixed(1)} seconds`}
                      color={[34, 211, 238]}
                      label="Transition"
                      min={0}
                      max={THEME_TIME_SLIDER_MAX}
                      // A quarter of a slider position is a tenth of a second at
                      // the short end of the logarithmic curve, so every value
                      // the quantiser can return is actually reachable.
                      step={0.25}
                      value={themeTimeSliderPosition(draftGroup.transitionSeconds)}
                      valueText={formatThemeSeconds(draftGroup.transitionSeconds)}
                      onPreview={(position) => updateDraftGroup({ transitionSeconds: themeTransitionFromSlider(position) })}
                      onCommit={(position) => updateDraftGroup({ transitionSeconds: themeTransitionFromSlider(position) }, true)}
                    />
                    <ConfigSelect
                      label="House Party hue"
                      value={draftGroup.housePartyHueMode}
                      options={[
                        { value: "follow", label: "Follow hue", icon: <Waves /> },
                        { value: "complement", label: "Complement hue", icon: <Contrast /> },
                      ]}
                      onChange={(housePartyHueMode) => updateDraftGroup({ housePartyHueMode }, true)}
                    />
                    <ConfigSelect
                      label="House Party brightness"
                      value={draftGroup.housePartyBrightnessMode}
                      options={[
                        { value: "follow", label: "Follow brightness", icon: <Sun /> },
                        { value: "oppose", label: "Oppose brightness", icon: <Contrast /> },
                        { value: "ignore", label: "Ignore brightness", icon: <CircleDot /> },
                      ]}
                      onChange={(housePartyBrightnessMode) => updateDraftGroup({ housePartyBrightnessMode }, true)}
                    />
                  </div>

                  {draftTheme ? (
                    <div className="grid gap-4 border-t border-neutral-800 pt-4">
                      <ConfigSelect
                        label="Colour theme"
                        value={draftTheme.id}
                      options={draftGroup.themes.map((theme) => ({
                        value: theme.id,
                        label: theme.name,
                        detail: `${Object.keys(theme.parameterOverrides[activeModule?.id ?? ""] ?? {}).length} parameter overrides`,
                        icon: hasThemeColors(theme) ? undefined : <Palette />,
                        swatch: hasThemeColors(theme) ? themeSwatch(theme) : undefined,
                      }))}
                        onChange={(themeId) => {
                          setDraftThemeId(themeId);
                          void persistEditor(draftGroups, draftGroupId, themeId);
                        }}
                      />
                      {renaming === "theme" ? (
                        <div className="theme-library-name-field">
                          <input className="cyber-text-input" value={nameDraft} aria-label="Colour theme name" maxLength={60}
                            onChange={(event) => setNameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") finishRename();
                              if (event.key === "Escape") setRenaming(null);
                            }} />
                          <MomentaryFeedbackButton type="button" className="icon-link" aria-label="Confirm theme name" onClick={finishRename}><Check className="h-5 w-5" /></MomentaryFeedbackButton>
                          <MomentaryFeedbackButton type="button" className="icon-link" aria-label="Cancel theme rename" onClick={() => setRenaming(null)}><X className="h-5 w-5" /></MomentaryFeedbackButton>
                        </div>
                      ) : (
                        <div className="theme-library-actions">
                          <MomentaryFeedbackButton type="button" className="theme-library-button" onClick={() => {
                            const id = createId("theme");
                            const next = { ...structuredClone(draftTheme), id, name: "New Colour Theme" };
                            const themes = [...draftGroup.themes, next];
                            updateDraftGroup({ themes }, true);
                            setDraftThemeId(id);
                            void persistEditor(
                              draftGroups.map((group) => group.id === draftGroupId ? { ...group, themes } : group),
                              draftGroupId,
                              id,
                            );
                            setRenaming("theme");
                            setNameDraft(next.name);
                          }}><Plus className="h-4 w-4" />New</MomentaryFeedbackButton>
                          <MomentaryFeedbackButton type="button" className="theme-library-button" onClick={() => {
                            const id = createId("theme");
                            const next = { ...structuredClone(draftTheme), id, name: `${draftTheme.name} Copy` };
                            const themes = [...draftGroup.themes, next];
                            updateDraftGroup({ themes }, true);
                            setDraftThemeId(id);
                            void persistEditor(
                              draftGroups.map((group) => group.id === draftGroupId ? { ...group, themes } : group),
                              draftGroupId,
                              id,
                            );
                          }}><CopyPlus className="h-4 w-4" />Duplicate</MomentaryFeedbackButton>
                          <MomentaryFeedbackButton type="button" className="theme-library-button" onClick={() => {
                            setRenaming("theme");
                            setNameDraft(draftTheme.name);
                          }}><Pencil className="h-4 w-4" />Rename</MomentaryFeedbackButton>
                          <MomentaryFeedbackButton type="button" className="theme-library-button theme-library-button-danger"
                            disabled={draftGroup.themes.length <= 1}
                            onClick={() => {
                              const themes = draftGroup.themes.filter((theme) => theme.id !== draftTheme.id);
                              updateDraftGroup({ themes }, true);
                              setDraftThemeId(themes[0]?.id ?? "");
                              void persistEditor(
                                draftGroups.map((group) => group.id === draftGroupId ? { ...group, themes } : group),
                                draftGroupId,
                                themes[0]?.id ?? "",
                              );
                            }}><Trash2 className="h-4 w-4" />Delete</MomentaryFeedbackButton>
                        </div>
                      )}

                      <div>
                        <h3 className="mb-3 font-black uppercase text-neutral-200">Colours</h3>
                        <div className="theme-widget-flow">
                          {(activeModule?.paletteSlots ?? []).map((slot) => {
                            const value = draftTheme.colors[slot.id] ?? {
                              rgb: slot.defaultRgb,
                              intensity: 100,
                              opacity: 100,
                              cursor: { x: 0.5, y: 0.5 },
                            };
                            return (
                              <ColorWidget
                                key={slot.id}
                                active={activeColorSlot === slot.id}
                                detail={slot.id === "primaryText"
                                  ? "Message over the visualiser"
                                  : slot.id === "secondaryText"
                                    ? "Track, artist, lyric and status information"
                                    : `${activeModule?.name ?? "Module"} palette colour`}
                                label={slot.label}
                                rgb={value.rgb}
                                intensity={value.intensity}
                                swatchOpacity={Math.max(0.12, value.opacity / 100)}
                                onToggle={() => setActiveColorSlot((current) => current === slot.id ? null : slot.id)}
                              >
                                <ColorSpectrum
                                  label={slot.label}
                                  value={value}
                                  onPreview={(color) => updateDraftTheme({ colors: { ...draftTheme.colors, [slot.id]: { ...color, opacity: value.opacity } } })}
                                  onCommit={(color) => updateDraftTheme({ colors: { ...draftTheme.colors, [slot.id]: { ...color, opacity: value.opacity } } }, true)}
                                />
                                <ColorIntensitySlider
                                  label={slot.label}
                                  value={value}
                                  onPreview={(color) => updateDraftTheme({ colors: { ...draftTheme.colors, [slot.id]: { ...color, opacity: value.opacity } } })}
                                  onCommit={(color) => updateDraftTheme({ colors: { ...draftTheme.colors, [slot.id]: { ...color, opacity: value.opacity } } }, true)}
                                />
                                <SliderControlPanel
                                  ariaLabel={`${slot.label} opacity`}
                                  ariaValueText={`${Math.round(value.opacity)}%`}
                                  color={value.rgb}
                                  dotOpacity={value.opacity / 100}
                                  intensity={value.intensity}
                                  label="Opacity"
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={value.opacity}
                                  valueText={`${Math.round(value.opacity)}%`}
                                  onPreview={(opacity) => updateDraftTheme({
                                    colors: { ...draftTheme.colors, [slot.id]: { ...value, opacity } },
                                  })}
                                  onCommit={(opacity) => updateDraftTheme({
                                    colors: { ...draftTheme.colors, [slot.id]: { ...value, opacity } },
                                  }, true)}
                                />
                              </ColorWidget>
                            );
                          })}
                        </div>
                      </div>

                      {activeModule?.settings.length ? (
                        <div className="grid gap-3">
                          <h3 className="font-black uppercase text-neutral-200">Parameter overrides</h3>
                          <p className="text-sm text-neutral-400">Unchanged parameters inherit the module baseline. Revert removes an override rather than copying the current value.</p>
                          {activeModule.settings.map((setting) => {
                            const inherited = config.moduleSettings[activeModule.id]?.[setting.id] ?? setting.default;
                            const source = draftTheme.parameterOverrides[activeModule.id]?.[setting.id];
                            const canDrive = setting.updateMode !== "structural"
                              && setting.control !== "toggle" && setting.control !== "select";
                            return (
                              <div key={setting.id} className="grid gap-3 border border-neutral-800 bg-neutral-950/45 p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <span>
                                    <span className="block font-bold uppercase text-neutral-200">{setting.label}</span>
                                    <span className="text-xs text-neutral-500">
                                      {setting.updateMode === "structural"
                                        ? "Structural · baseline only"
                                        : source ? `Overridden · ${source.type}` : `Inherited · ${formatSettingValue(setting, inherited)}`}
                                    </span>
                                  </span>
                                  {source ? (
                                    <MomentaryFeedbackButton type="button" className="config-page-button" onClick={() => updateOverride(setting, null, true)}>
                                      <RotateCcw className="h-4 w-4" />Revert to inherited
                                    </MomentaryFeedbackButton>
                                  ) : setting.updateMode !== "structural" ? (
                                    <MomentaryFeedbackButton type="button" className="config-page-button" onClick={() => updateOverride(setting, defaultSource(setting, inherited), true)}>
                                      <Plus className="h-4 w-4" />Override
                                    </MomentaryFeedbackButton>
                                  ) : null}
                                </div>
                                {source ? (
                                  <>
                                    <ConfigSelect
                                      label="Parameter source"
                                      value={source.type}
                                      options={(canDrive
                                        ? ["manual", "random", "beat", "downbeat", "energy", "bass", "mid", "treble"]
                                        : ["manual"]).map((type) => ({
                                          value: type as ParameterSource["type"],
                                          label: type.charAt(0).toUpperCase() + type.slice(1),
                                          icon: parameterSourceIcon(type as ParameterSource["type"]),
                                        }))}
                                      onChange={(type) => updateOverride(setting, sourceWithType(setting, source, type), true)}
                                    />
                                    {source.type === "manual" ? (
                                      setting.control === "toggle" ? (
                                        <CheckboxRow checked={source.value >= 0.5} label={setting.label}
                                          detail={setting.description ?? "Manual theme override"}
                                          onChange={(checked) => updateOverride(setting, { type: "manual", value: checked ? 1 : 0 }, true)} />
                                      ) : setting.control === "select" ? (
                                        <ConfigSelect
                                          label="Manual value"
                                          value={String(source.value)}
                                          options={(setting.options ?? []).map((option) => ({
                                            value: String(option.value),
                                            label: option.label,
                                            icon: <CircleDot />,
                                          }))}
                                          onChange={(value) => updateOverride(setting, { type: "manual", value: Number(value) }, true)}
                                        />
                                      ) : (
                                        <SliderControlPanel
                                          ariaLabel={`${setting.label} manual value`}
                                          ariaValueText={formatSettingValue(setting, source.value)}
                                          color={[34, 211, 238]}
                                          label="Manual"
                                          min={0}
                                          max={1}
                                          step={0.001}
                                          value={sliderPosition(setting, source.value)}
                                          valueText={formatSettingValue(setting, source.value)}
                                          snapValue={sliderPosition(setting, inherited)}
                                          onPreview={(position) => updateOverride(setting, { type: "manual", value: sliderValue(setting, position) })}
                                          onCommit={(position) => updateOverride(setting, { type: "manual", value: sliderValue(setting, position) }, true)}
                                        />
                                      )
                                    ) : (
                                      <>
                                        <RangeSliderControlPanel
                                          ariaLabel={`${setting.label} driven range`}
                                          label="Minimum / Maximum"
                                          min={setting.min}
                                          max={setting.max}
                                          step={setting.step}
                                          value={[source.min, source.max]}
                                          formatValue={(value) => formatSettingValue(setting, value)}
                                          onPreview={([min, max]) => updateOverride(setting, { ...source, min, max })}
                                          onCommit={([min, max]) => updateOverride(setting, { ...source, min, max }, true)}
                                        />
                                        {source.type === "random" ? (
                                          <>
                                            <ConfigSelect
                                              label="Random cadence"
                                              value={source.cadence}
                                              options={[
                                                { value: "beat", label: "Beat", icon: <Activity /> },
                                                { value: "downbeat", label: "Downbeat", icon: <AudioLines /> },
                                                { value: "bar", label: "Bar", icon: <ListOrdered /> },
                                                { value: "song", label: "Song", icon: <Music2 /> },
                                                { value: "interval", label: "Timed interval", icon: <Clock3 /> },
                                              ]}
                                              onChange={(cadence) => updateOverride(setting, { ...source, cadence }, true)}
                                            />
                                            {source.cadence === "interval" ? (
                                              <SliderControlPanel ariaLabel="Random interval" ariaValueText={`${source.intervalSeconds} seconds`}
                                                color={[34, 211, 238]} label="Interval" min={0.25} max={60} step={0.1}
                                                value={source.intervalSeconds} valueText={`${source.intervalSeconds.toFixed(1)}s`}
                                                onPreview={(intervalSeconds) => updateOverride(setting, { ...source, intervalSeconds })}
                                                onCommit={(intervalSeconds) => updateOverride(setting, { ...source, intervalSeconds }, true)} />
                                            ) : null}
                                            <SliderControlPanel ariaLabel="Random transition" ariaValueText={`${source.transitionSeconds} seconds`}
                                              color={[34, 211, 238]} label="Transition" min={0} max={10} step={0.1}
                                              value={source.transitionSeconds} valueText={`${source.transitionSeconds.toFixed(1)}s`}
                                              onPreview={(transitionSeconds) => updateOverride(setting, { ...source, transitionSeconds })}
                                              onCommit={(transitionSeconds) => updateOverride(setting, { ...source, transitionSeconds }, true)} />
                                          </>
                                        ) : (
                                          <EnvelopeSliderControlPanel ariaLabel={`${setting.label} envelope`}
                                            value={envelopeDurations(source)}
                                            onPreview={([attackSeconds, holdSeconds, releaseSeconds]) => updateOverride(setting, { ...source, attackSeconds, holdSeconds, releaseSeconds })}
                                            onCommit={([attackSeconds, holdSeconds, releaseSeconds]) => updateOverride(setting, { ...source, attackSeconds, holdSeconds, releaseSeconds }, true)} />
                                        )}
                                      </>
                                    )}
                                  </>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="text-xs text-neutral-500">Changes save when a control is selected or a slider is released. Closing restores the configured theme sequence.</p>
                </>
              ) : null}
            </ModalOverlay>

            {/* Legacy dashboard-theme editor retained in source history only.
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
                        ariaValueText={`${draftGroup.transitionSeconds.toFixed(1)} seconds`}
                        color={[34, 211, 238]}
                        label="Transition"
                        min={0}
                        max={THEME_TIME_SLIDER_MAX}
                        step={0.25}
                        value={themeTimeSliderPosition(draftGroup.transitionSeconds)}
                        valueText={formatThemeSeconds(draftGroup.transitionSeconds)}
                        onPreview={(position) => updateDraftGroup({ transitionSeconds: themeTransitionFromSlider(position) })}
                        onCommit={(position) => updateDraftGroup({ transitionSeconds: themeTransitionFromSlider(position) })}
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

            */}
            <div className="grid gap-4 sm:grid-cols-2">
              <ConfigSelect
                label="Idle behavior"
                value={config.idleBehavior}
                options={[
                  { value: "ambient", label: "Ambient module", icon: <Sparkles /> },
                  { value: "black", label: "Black screen", icon: <MonitorOff /> },
                  { value: "return", label: "Return to dashboard", icon: <House /> },
                ]}
                onChange={(idleBehavior) => void save({ ...config, idleBehavior })}
              />
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

            <div className="grid gap-3 border border-neutral-800 bg-neutral-950/45 p-3 text-sm">
              <span className="font-bold uppercase text-neutral-300">Message scaling</span>
              <p className="text-xs text-neutral-500">
                Scale the message outward from its centre. Attack is the ramp-up time; release is the ramp-down time.
              </p>
              <ParameterDriverControls
                inherited={1}
                setting={MESSAGE_SCALE_SETTING}
                source={config.messageScaleSource}
                onPreview={(messageScaleSource) => setConfig({ ...config, messageScaleSource })}
                onCommit={(messageScaleSource) => void save({ ...config, messageScaleSource })}
              />
            </div>

            <div className="grid gap-3 border border-neutral-800 bg-neutral-950/45 p-3 text-sm">
              <span className="font-bold uppercase text-neutral-300">Glow overlay</span>
              <p className="text-xs text-neutral-500">
                A blurred copy of the finished picture, laid back over it as the last pass —
                after the visualiser and after the message, so everything on screen glows.
                Opacity zero switches the layer off.
              </p>
              <span className="text-xs font-bold uppercase text-neutral-400">Blend mode</span>
              <p className="text-xs text-neutral-500">
                Driven, the mode swaps as a hard cut wherever its driver crosses from one
                mode to the next — a beat or downbeat source flips it on the beat. Leave
                it on Manual for a fixed mode.
              </p>
              <ParameterDriverControls
                inherited={0}
                manualOptionIcons={GLOW_BLEND_ICONS}
                setting={GLOW_BLEND_SETTING}
                source={config.glowOverlay.blendModeSource}
                onPreview={(blendModeSource) => setConfig({
                  ...config,
                  glowOverlay: { ...config.glowOverlay, blendModeSource },
                })}
                onCommit={(blendModeSource) => void save({
                  ...config,
                  glowOverlay: { ...config.glowOverlay, blendModeSource },
                })}
              />
              <span className="text-xs font-bold uppercase text-neutral-400">Blur amount</span>
              <ParameterDriverControls
                inherited={0}
                setting={GLOW_BLUR_SETTING}
                source={config.glowOverlay.blurSource}
                onPreview={(blurSource) => setConfig({
                  ...config,
                  glowOverlay: { ...config.glowOverlay, blurSource },
                })}
                onCommit={(blurSource) => void save({
                  ...config,
                  glowOverlay: { ...config.glowOverlay, blurSource },
                })}
              />
              <span className="text-xs font-bold uppercase text-neutral-400">Opacity</span>
              <ParameterDriverControls
                inherited={0}
                setting={GLOW_OPACITY_SETTING}
                source={config.glowOverlay.opacitySource}
                onPreview={(opacitySource) => setConfig({
                  ...config,
                  glowOverlay: { ...config.glowOverlay, opacitySource },
                })}
                onCommit={(opacitySource) => void save({
                  ...config,
                  glowOverlay: { ...config.glowOverlay, opacitySource },
                })}
              />
            </div>

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
                {section.toLowerCase() === "physics" && activeModuleColorGroups.length ? (
                  <div className="flex w-full justify-end">
                    <MomentaryFeedbackButton
                      type="button"
                      className="config-page-button config-page-button-primary"
                      onClick={openThemeModal}
                    >
                      <Palette className="h-4 w-4" />
                      Advanced parameters and colours
                    </MomentaryFeedbackButton>
                  </div>
                ) : null}
                {settings.map((setting) => {
                  const saved = setting.updateMode === "structural"
                    ? config.moduleSettings[activeModule.id]?.[setting.id] ?? setting.default
                    : config.moduleSettings[activeModule.id]?.[setting.id] ?? setting.default;
                  const nextConfig = (value: number, restart = false): Config => ({
                    ...config,
                    moduleSettings: {
                      ...config.moduleSettings,
                      [activeModule.id]: {
                        ...(config.moduleSettings[activeModule.id] ?? {}),
                        [setting.id]: clampSetting(setting, value),
                      },
                    },
                    ...(restart ? {
                      moduleReloadGenerations: {
                        ...config.moduleReloadGenerations,
                        [activeModule.id]: (config.moduleReloadGenerations[activeModule.id] ?? 0) + 1,
                      },
                    } : {}),
                  });
                  const parameterSource = config.moduleParameterSources[activeModule.id]?.[setting.id]
                    ?? defaultSource(setting, saved);
                  const parameterSourceConfig = (source: ParameterSource): Config => ({
                    ...config,
                    moduleSettings: source.type === "manual" ? {
                      ...config.moduleSettings,
                      [activeModule.id]: {
                        ...(config.moduleSettings[activeModule.id] ?? {}),
                        [setting.id]: clampSetting(setting, source.value),
                      },
                    } : config.moduleSettings,
                    moduleParameterSources: {
                      ...config.moduleParameterSources,
                      [activeModule.id]: {
                        ...(config.moduleParameterSources[activeModule.id] ?? {}),
                        [setting.id]: source,
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
                      {setting.control !== "toggle" ? (
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
                          onChange={(checked) => void save(nextConfig(
                            checked ? 1 : 0,
                            setting.updateMode === "structural",
                          ))}
                        />
                      ) : setting.control === "select" ? (
                        <ConfigSelect
                          label={setting.label}
                          value={String(saved)}
                          options={(setting.options ?? []).map((option) => ({
                            value: String(option.value),
                            label: option.label,
                            icon: <CircleDot />,
                          }))}
                          onChange={(value) => void save(nextConfig(
                            Number(value),
                            setting.updateMode === "structural",
                          ))}
                        />
                      ) : setting.updateMode !== "structural" ? (
                        <ParameterDriverControls
                          inherited={saved}
                          setting={setting}
                          source={parameterSource}
                          onPreview={(source) => setConfig(parameterSourceConfig(source))}
                          onCommit={(source) => void save(parameterSourceConfig(source))}
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
                            void save(nextConfig(sliderValue(setting, position), true));
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
    </ConfigAccordion>
  );
}
