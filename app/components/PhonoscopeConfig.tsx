"use client";

import { Activity, Box, RefreshCw, Trash2, Upload, Waves } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfigAccordion } from "./ConfigControls";

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
  statusOverlay: boolean;
  transitionMs: number;
  providers: {
    reccoBeats: boolean;
    lrclib: boolean;
  };
  moduleSettings: Record<string, Record<string, number>>;
};

type Payload = { config: Config; modules: ModuleSummary[]; error?: string };

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
  const fileRef = useRef<HTMLInputElement | null>(null);

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
                    {module.name} · {module.version} · {module.dimension.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            {activeModule?.description ? <p className="text-sm text-neutral-400">{activeModule.description}</p> : null}

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

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={config.providers.reccoBeats}
                  onChange={(event) => void save({ ...config, providers: { ...config.providers, reccoBeats: event.target.checked } })}
                />
                BPM and mood enrichment
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

            {activeModule?.settings.length ? (
              <div className="grid gap-4 border-t border-neutral-800 pt-4">
                <p className="font-black uppercase text-neutral-200">Module controls</p>
                {activeModule.settings.map((setting) => {
                  const saved = config.moduleSettings[activeModule.id]?.[setting.id] ?? setting.default;
                  const nextConfig = (value: number): Config => ({
                    ...config,
                    moduleSettings: {
                      ...config.moduleSettings,
                      [activeModule.id]: {
                        ...(config.moduleSettings[activeModule.id] ?? {}),
                        [setting.id]: clampSetting(setting, value),
                      },
                    },
                  });
                  const details = [
                    setting.description,
                    setting.affects?.length ? `Affects ${setting.affects.join(", ")}` : "",
                    setting.curve?.type === "power" ? `Power curve ${setting.curve.exponent}` : "",
                  ].filter(Boolean);
                  return (
                    <label key={setting.id} className="grid gap-2 border border-neutral-800 bg-neutral-950/45 p-3 text-sm">
                      <span className="flex justify-between gap-3">
                        <span className="font-bold uppercase text-neutral-300">{setting.label}</span>
                        <span className="font-mono text-cyan-200">{formatSettingValue(setting, saved)}</span>
                      </span>
                      {setting.control === "toggle" ? (
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          checked={saved >= 0.5}
                          onChange={(event) => void save(nextConfig(event.target.checked ? 1 : 0))}
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
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.001}
                          value={sliderPosition(setting, saved)}
                          onChange={(event) => setConfig(nextConfig(sliderValue(setting, Number(event.target.value))))}
                          onPointerUp={(event) => void save(nextConfig(sliderValue(setting, Number(event.currentTarget.value))))}
                          onKeyUp={(event) => void save(nextConfig(sliderValue(setting, Number(event.currentTarget.value))))}
                        />
                      )}
                      {details.length ? (
                        <span className="text-xs leading-relaxed text-neutral-500">{details.join(" · ")}</span>
                      ) : null}
                    </label>
                  );
                })}
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
