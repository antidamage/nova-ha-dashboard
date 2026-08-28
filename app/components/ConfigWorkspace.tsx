"use client";

import { ArrowDownUp, ArrowLeft, AudioLines, Blocks, Bot, Database, Download, History, KeyRound, MonitorSmartphone, Paintbrush, Palette, ShieldAlert, ShieldCheck, Upload, UserRound } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SecretSetupStatus } from "../../lib/config-schema";
import type { DashboardConfig } from "../../lib/config-schema";
import type { AppleTvSwipeSettings } from "../../lib/appletv-swipe";
import type { AgentPreferences, VoicePreferences, WatchfacePreferences } from "../../lib/types";
import type { SunThemeStatus, ThemeStorageValue } from "./accentColor";
import { ConfigAccordion } from "./ConfigControls";
import { getActiveConfigCategory, getConfigUiState, setActiveConfigCategory, setConfigScroll } from "./configUiState";
import { ConfigPreviewBackground, ConfigPreviewBackgroundProvider } from "./ConfigPreviewBackground";
import { requestManagedDesktopWallpaperSync } from "./managed-computers-client";
import { loadSharedConfig, readSharedConfigCache, saveSharedConfig } from "./sharedConfigCache";
import { SystemControlConfig } from "./SystemControlConfig";
import { ThemeChangeNotificationSecret } from "./ThemeChangeNotificationSecret";
import { UpdateBanner } from "./UpdateBanner";
import { ReloadButton } from "./ReloadButton";

const isDemoMode = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";

const AccentConfig = dynamic(() => import("./AccentConfig").then((module) => module.AccentConfig));
const AgentAdministration = dynamic(() => import("./AgentAdministration").then((module) => module.AgentAdministration));
const AgentConfig = dynamic(() => import("./AgentConfig").then((module) => module.AgentConfig));
const AgentNameConfig = dynamic(() => import("./AgentNameConfig").then((module) => module.AgentNameConfig));
const AppleTvSwipeConfig = dynamic(() => import("./AppleTvSwipeConfig").then((module) => module.AppleTvSwipeConfig));
const CameraConfig = dynamic(() => import("./CameraConfig").then((module) => module.CameraConfig));
const DashboardClimateConfig = dynamic(() => import("./DashboardClimateConfig").then((module) => module.DashboardClimateConfig));
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

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([`${stringify(value)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function setupRows(status?: SecretSetupStatus) {
  if (!status) {
    return [];
  }
  return [
    { label: "Home Assistant URL", ok: status.homeAssistant.urlConfigured, detail: "HA_URL" },
    { label: "Home Assistant token", ok: status.homeAssistant.tokenConfigured, detail: "HA_TOKEN" },
    { label: "iCloud username", ok: status.iCloud.usernameConfigured, detail: "ICLOUD_USERNAME" },
    { label: "iCloud app password", ok: status.iCloud.appPasswordConfigured, detail: "ICLOUD_APP_PASSWORD" },
    { label: "Powershop email", ok: status.powershop.emailConfigured, detail: "POWERSHOP_EMAIL" },
    { label: "Powershop password", ok: status.powershop.passwordConfigured, detail: "POWERSHOP_PASSWORD" },
    { label: "MCP bearer token", ok: !status.mcp.authRequired || status.mcp.bearerTokenConfigured, detail: "NOVA_DASHBOARD_MCP_TOKEN" },
  ];
}

function StatusPill({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "text-cyan-200" : "text-yellow-200"}>
      {ok ? "ready" : "needed"}
    </span>
  );
}

export type ConfigCategoryId = "assistant" | "voice-people" | "appearance-dashboard" | "devices" | "modules" | "system-data";

const CONFIG_CATEGORIES: Array<{
  id: ConfigCategoryId;
  label: string;
  detail: string;
  icon: typeof Bot;
}> = [
  { id: "assistant", label: "Assistant", detail: "Identity, runtime and authority", icon: Bot },
  { id: "voice-people", label: "Voice & People", detail: "Speech, satellites and household voices", icon: AudioLines },
  { id: "appearance-dashboard", label: "Appearance & Dashboard", detail: "Theme, status and interaction", icon: Palette },
  { id: "devices", label: "Devices", detail: "Computers, camera and hardware", icon: MonitorSmartphone },
  { id: "modules", label: "Modules", detail: "Installed extensions and their settings", icon: Blocks },
  { id: "system-data", label: "System & Data", detail: "Secrets, transfer, updates and power", icon: Database },
];

const HASH_CATEGORY: Record<string, ConfigCategoryId> = {
  agent: "assistant",
  assistant: "assistant",
  authority: "assistant",
  identity: "assistant",
  voice: "voice-people",
  "voice-infrastructure": "voice-people",
  "voice-people": "voice-people",
  "user-data": "voice-people",
  appearance: "appearance-dashboard",
  "appearance-dashboard": "appearance-dashboard",
  "status-orb-info": "appearance-dashboard",
  reminders: "appearance-dashboard",
  climate: "appearance-dashboard",
  "appletv-swipe": "appearance-dashboard",
  phonoscope: "appearance-dashboard",
  devices: "devices",
  "managed-computers": "devices",
  "hardware-assistant": "devices",
  camera: "devices",
  modules: "modules",
  module: "modules",
  extensions: "modules",
  "system-data": "system-data",
  secrets: "system-data",
  "config-transfer": "system-data",
  updates: "system-data",
  system: "system-data",
};

function categoryFromHash(): ConfigCategoryId | null {
  if (typeof window === "undefined") return null;
  return HASH_CATEGORY[window.location.hash.replace(/^#/, "")] ?? null;
}

function ToolbarButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="config-page-button"
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ConfigWorkspace({
  initialAgentSettings,
  initialAircon,
  initialAutoUpdate,
  initialSwipe,
  initialSun,
  initialTheme,
  initialVoiceSettings,
  initialWatchface,
}: {
  initialAgentSettings?: AgentPreferences | null;
  initialAircon?: DashboardConfig["dashboard"]["aircon"];
  initialAutoUpdate?: boolean;
  initialSwipe?: AppleTvSwipeSettings | null;
  initialSun?: SunThemeStatus | null;
  initialTheme?: ThemeStorageValue | null;
  initialVoiceSettings?: VoicePreferences | null;
  initialWatchface?: WatchfacePreferences | null;
}) {
  const [config, setConfig] = useState<unknown>(null);
  const [secrets, setSecrets] = useState<SecretSetupStatus | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRestoredRef = useRef(false);
  const systemLoadStartedRef = useRef(false);
  const [activeCategory, setActiveCategory] = useState<ConfigCategoryId | null>(null);
  const rows = useMemo(() => setupRows(secrets), [secrets]);
  const router = useRouter();

  // Leaving config is the moment we push wallpapers to configured managed desktops.
  // The sync is deduplicated server-side.
  const handleBack = useCallback(() => {
    void requestManagedDesktopWallpaperSync().catch((error) => {
      console.error("[nova-dashboard] managed desktop wallpaper sync failed", error);
    });
    router.push("/");
  }, [router]);

  const load = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const cached = readSharedConfigCache();
    if (cached?.config !== undefined) {
      setConfig(cached.config);
      setSecrets(cached.secrets);
    }
    try {
      const payload = await loadSharedConfig();
      setConfig(payload.config ?? null);
      setSecrets(payload.secrets);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load config");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const selectFromLocation = () => {
      const fromHash = categoryFromHash();
      const remembered = getActiveConfigCategory();
      const next = fromHash ?? (CONFIG_CATEGORIES.some(({ id }) => id === remembered) ? remembered as ConfigCategoryId : null);
      setActiveCategory(next);
    };
    selectFromLocation();
    window.addEventListener("hashchange", selectFromLocation);
    return () => window.removeEventListener("hashchange", selectFromLocation);
  }, []);

  useEffect(() => {
    if (activeCategory === "system-data" && !systemLoadStartedRef.current) {
      systemLoadStartedRef.current = true;
      void load();
    }
  }, [activeCategory, load]);

  // Restore the scroll position when returning to /config within the 5-min window.
  // Wait a beat so accordions can re-expand (which changes page height) before scrolling.
  useEffect(() => {
    if (!activeCategory || scrollRestoredRef.current) {
      return;
    }
    scrollRestoredRef.current = true;
    if (categoryFromHash()) {
      return;
    }
    const state = getConfigUiState();
    if (!state || state.scrollTop <= 0) {
      return;
    }
    // Explicit instant restore so the jump never animates on return to /config.
    const id = window.setTimeout(() => window.scrollTo({ top: state.scrollTop, behavior: "auto" }), 300);
    return () => window.clearTimeout(id);
  }, [activeCategory]);

  // Remember the scroll position (throttled to once per animation frame).
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setConfigScroll(window.scrollY);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  const applyImportedConfig = async (nextConfig: unknown) => {
    setBusy(true);
    setMessage(null);
    try {
      const payload = await saveSharedConfig(nextConfig);
      if (!payload.ok) {
        setMessage("Config import failed.");
        return;
      }
      setMessage("Config imported.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Config import failed");
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File | null) => {
    if (!file) {
      return;
    }
    try {
      await applyImportedConfig(JSON.parse(await file.text()));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Config import failed");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const selectCategory = (category: ConfigCategoryId) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const next = activeCategory === category ? null : category;
    setActiveCategory(next);
    setActiveConfigCategory(next);
    const url = new URL(window.location.href);
    url.hash = next ?? "";
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    if (next) {
      window.requestAnimationFrame(() => document.getElementById("config-category-content")?.scrollIntoView?.({ block: "start" }));
    }
  };

  const activeMeta = CONFIG_CATEGORIES.find(({ id }) => id === activeCategory);

  return (
    <ConfigPreviewBackgroundProvider initialSun={initialSun} initialTheme={initialTheme}>
      <main className="dashboard-shell config-shell min-h-screen px-4 py-5 text-neutral-100 sm:px-6" style={{ backgroundColor: "var(--cyber-bg)" }}>
        <ConfigPreviewBackground />
        <ReloadButton />
        <div className={`config-layout mx-auto grid max-w-5xl gap-4 ${activeCategory ? "" : "config-layout-categories-closed"}`}>
        <UpdateBanner context="config" />
        <nav className="config-top-actions" aria-label="Configuration actions">
          <button
            type="button"
            className="config-page-button icon-link-text-tone"
            aria-label="Back to dashboard"
            onClick={handleBack}
          >
            <ArrowLeft className="h-5 w-5" />
            Back
          </button>
        </nav>

        <nav className="config-category-nav" aria-label="Configuration categories">
          {CONFIG_CATEGORIES.map(({ detail, icon: Icon, id, label }) => {
            const selected = activeCategory === id;
            return (
              <button
                key={id}
                type="button"
                className={`config-category-button ${selected ? "config-category-button-active" : ""}`}
                aria-expanded={selected}
                aria-controls="config-category-content"
                onClick={() => selectCategory(id)}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="grid gap-1 text-left">
                  <span className="config-category-label">{label}</span>
                  <span className="config-category-detail">{detail}</span>
                </span>
              </button>
            );
          })}
        </nav>

        {activeCategory ? (
          <div id="config-category-content" className="config-category-content grid gap-4" data-category={activeCategory}>
            <header className="config-category-heading">
              <p className="config-category-kicker">Configuration</p>
              <h1>{activeMeta?.label}</h1>
              <p>{activeMeta?.detail}</p>
            </header>

            {isDemoMode && (activeCategory === "assistant" || activeCategory === "voice-people") ? (
              <aside
                className="border border-amber-400/50 bg-amber-400/10 p-4 text-sm leading-relaxed text-amber-100"
                role="status"
              >
                <strong className="font-black uppercase">Demo preview only.</strong>{" "}
                Voice and agent data is simulated here so the settings and status surfaces can be
                explored. The public demo has no microphone, speech models, household memory, training
                service, or acting agent, so these controls do not run the voice stack.
              </aside>
            ) : null}

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
                <DashboardClimateConfig initialSettings={initialAircon} />
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
        <ConfigAccordion id="secrets" title="Secrets" icon={<KeyRound className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
          <div className="panel-corner panel-corner-left" />
          <div className="panel-corner panel-corner-right" />
          <div className="mb-4 flex items-center gap-2 text-yellow-100">
            <ShieldAlert className="h-5 w-5" />
            <h2 className="text-lg font-black uppercase">Secrets</h2>
          </div>
          <div className="grid gap-3">
            <ThemeChangeNotificationSecret />
            {rows.map((row) => (
              <div key={row.detail} className="flex items-center justify-between gap-3 border-b border-neutral-800 pb-2 text-sm">
                <div>
                  <p className="font-black uppercase text-neutral-100">{row.label}</p>
                  <p className="font-mono text-xs text-neutral-500">{row.detail}</p>
                </div>
                <StatusPill ok={row.ok} />
              </div>
            ))}
          </div>
        </ConfigAccordion>

        <ConfigAccordion id="config-transfer" title="Config Import/Export" icon={<ArrowDownUp className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
          <div className="panel-corner panel-corner-left" />
          <div className="panel-corner panel-corner-right" />
          <div className="config-import-export-actions">
            <ToolbarButton disabled={!config || busy} onClick={() => downloadJson("dashboard-config.json", config)}>
              <Download className="h-4 w-4" />
              Export
            </ToolbarButton>
            <ToolbarButton disabled={busy} onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Import
            </ToolbarButton>
            <input
              ref={fileInputRef}
              aria-label="Config import file"
              className="sr-only"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void importFile(event.target.files?.[0] ?? null)}
            />
          </div>
          {message ? <p className="mt-3 text-sm font-semibold text-neutral-300">{message}</p> : null}
        </ConfigAccordion>

        <UpdateConfig initialAutoUpdate={initialAutoUpdate} />

        <SystemControlConfig />
              </>
            ) : null}
          </div>
        ) : null}
        </div>
      </main>
    </ConfigPreviewBackgroundProvider>
  );
}
