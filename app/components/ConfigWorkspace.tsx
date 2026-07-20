"use client";

import { ArrowDownUp, ArrowLeft, Download, KeyRound, ShieldAlert, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SecretSetupStatus } from "../../lib/config-schema";
import { ConfigAccordion } from "./ConfigControls";
import { getConfigUiState, setConfigScroll } from "./configUiState";
import { ConfigPreviewBackground, ConfigPreviewBackgroundProvider } from "./ConfigPreviewBackground";
import { requestManagedDesktopWallpaperSync } from "./managed-computers-client";
import { loadSharedConfig, readSharedConfigCache, saveSharedConfig } from "./sharedConfigCache";
import { SystemControlConfig } from "./SystemControlConfig";
import { CameraConfig } from "./CameraConfig";
import { UserDataConfig } from "./UserDataConfig";
import { UpdateBanner } from "./UpdateBanner";
import { ReloadButton } from "./ReloadButton";

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

export function ConfigWorkspace({ children, updateSection }: { children: ReactNode; updateSection?: ReactNode }) {
  const [config, setConfig] = useState<unknown>(null);
  const [secrets, setSecrets] = useState<SecretSetupStatus | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
    void load();
  }, [load]);

  // Restore the scroll position when returning to /config within the 5-min window.
  // Wait a beat so accordions can re-expand (which changes page height) before scrolling.
  useEffect(() => {
    const state = getConfigUiState();
    if (!state || state.scrollTop <= 0) {
      return;
    }
    const id = window.setTimeout(() => window.scrollTo(0, state.scrollTop), 180);
    return () => window.clearTimeout(id);
  }, []);

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

  return (
    <ConfigPreviewBackgroundProvider>
      <main className="dashboard-shell config-shell min-h-screen px-4 py-5 text-neutral-100 sm:px-6" style={{ backgroundColor: "var(--cyber-bg)" }}>
        <ConfigPreviewBackground />
        <ReloadButton />
        <div className="config-layout mx-auto grid max-w-5xl gap-4">
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

        {children}

        <CameraConfig />

        <UserDataConfig />

        <ConfigAccordion title="Secrets" icon={<KeyRound className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
          <div className="panel-corner panel-corner-left" />
          <div className="panel-corner panel-corner-right" />
          <div className="mb-4 flex items-center gap-2 text-yellow-100">
            <ShieldAlert className="h-5 w-5" />
            <h2 className="text-lg font-black uppercase">Secrets</h2>
          </div>
          <div className="grid gap-3">
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

        <ConfigAccordion title="Config Import/Export" icon={<ArrowDownUp className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
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

        {updateSection}

        <SystemControlConfig />
        </div>
      </main>
    </ConfigPreviewBackgroundProvider>
  );
}
