"use client";

import { Laptop, MonitorSmartphone, Moon, Plus, Power, Satellite, Trash2, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfigAccordion } from "./ConfigControls";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import {
  applyManagedDesktopWallpapers,
  loadManagedComputers,
  saveManagedComputers,
  type ManagedComputerFormValue,
  type ManagedComputerOrientationValue,
  type ManagedComputerPlatformValue,
} from "./managed-computers-client";

const PLATFORMS: Array<{ label: string; value: ManagedComputerPlatformValue }> = [
  { label: "Windows", value: "windows" },
  { label: "macOS", value: "macos" },
  { label: "KDE/Linux", value: "kde-linux" },
];

const ORIENTATIONS: Array<{ label: string; value: ManagedComputerOrientationValue }> = [
  { label: "Landscape", value: "landscape" },
  { label: "Portrait", value: "portrait" },
];

function newComputer(): ManagedComputerFormValue {
  const now = new Date().toISOString();
  return {
    address: "",
    capabilities: { sleep: false, wake: false, wallpaper: true, voiceSatellite: false },
    commandTimeoutMs: 15000,
    enabled: true,
    hostKey: "",
    id: `computer_${Date.now().toString(36)}`,
    macAddress: "",
    name: "New Computer",
    orientation: "landscape",
    platform: "windows",
    roomId: "",
    sshKeyConfigured: false,
    sshKeyPath: "",
    sshPublicKey: null,
    updatedAt: now,
    username: "",
  };
}

function Field({
  label,
  onChange,
  onCommit,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
      <span>{label}</span>
      <input
        className="cyber-text-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: Array<{ label: string; value: T }>;
  value: T;
}) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
      <span>{label}</span>
      <select className="cyber-text-input" value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleButton({
  checked,
  children,
  disabled,
  onChange,
}: {
  checked: boolean;
  children: ReactNode;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <MomentaryFeedbackButton
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`cyber-checkbox-row border p-3 text-left ${checked ? "cyber-checkbox-row-active" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={`cyber-checkbox ${checked ? "cyber-checkbox-checked" : ""}`} aria-hidden="true" />
      <span className="theme-display-label zone-title-bar">{children}</span>
    </MomentaryFeedbackButton>
  );
}

export function ManagedComputersConfig() {
  const [computers, setComputers] = useState<ManagedComputerFormValue[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const computersRef = useRef<ManagedComputerFormValue[]>([]);
  const requestedSaveRef = useRef(0);
  const completedSaveRef = useRef(0);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const loaded = await loadManagedComputers();
      computersRef.current = loaded;
      setComputers(loaded);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load managed computers");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replaceComputers = (next: ManagedComputerFormValue[]) => {
    computersRef.current = next;
    setComputers(next);
  };

  const update = (index: number, updater: (computer: ManagedComputerFormValue) => ManagedComputerFormValue) => {
    replaceComputers(computersRef.current.map((computer, currentIndex) => currentIndex === index ? updater(computer) : computer));
  };

  const flushSaves = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      while (completedSaveRef.current < requestedSaveRef.current) {
        const version = requestedSaveRef.current;
        const snapshot = computersRef.current;
        setMessage("Saving managed computers…");
        try {
          const saved = await saveManagedComputers(snapshot);
          completedSaveRef.current = version;
          if (version === requestedSaveRef.current) {
            replaceComputers(saved);
            setMessage("Managed computers saved automatically");
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Failed to save managed computers");
          break;
        }
      }
    } finally {
      savingRef.current = false;
    }
  };

  const persist = () => {
    requestedSaveRef.current += 1;
    void flushSaves();
  };

  const updateAndPersist = (index: number, updater: (computer: ManagedComputerFormValue) => ManagedComputerFormValue) => {
    update(index, updater);
    persist();
  };

  const applyNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const results = await applyManagedDesktopWallpapers();
      const failed = results.filter((result) => !result.ok);
      setMessage(failed.length ? failed.map((result) => `${result.name}: ${result.error}`).join(" / ") : "Desktop wallpapers applied");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to apply desktop wallpapers");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfigAccordion
      id="managed-computers"
      title="Managed Computers"
      icon={<MonitorSmartphone className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
      actions={(
        <>
          <MomentaryFeedbackButton type="button" className="icon-link" aria-label="Apply desktop wallpapers" disabled={busy} onClick={applyNow}>
            <UploadCloud className="h-5 w-5" />
          </MomentaryFeedbackButton>
        </>
      )}
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      <div className="grid gap-3">
        {computers.map((computer, index) => {
          return (
            <div key={index} className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
              <div className="grid gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Laptop className="h-5 w-5 shrink-0 text-cyan-200" />
                    <p className="truncate text-sm font-black uppercase text-cyan-200">{computer.name}</p>
                  </div>
                  <MomentaryFeedbackButton
                    type="button"
                    className="icon-link text-red-200"
                    aria-label={`Remove ${computer.name}`}
                    onClick={() => {
                      replaceComputers(computersRef.current.filter((_, currentIndex) => currentIndex !== index));
                      persist();
                    }}
                  >
                    <Trash2 className="h-5 w-5" />
                  </MomentaryFeedbackButton>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="ID" value={computer.id} onChange={(id) => update(index, (item) => ({ ...item, id }))} onCommit={persist} />
                  <Field label="Name" value={computer.name} onChange={(name) => update(index, (item) => ({ ...item, name }))} onCommit={persist} />
                  <Field label="Address" value={computer.address} onChange={(address) => update(index, (item) => ({ ...item, address }))} onCommit={persist} />
                  <Field label="Username" value={computer.username} onChange={(username) => update(index, (item) => ({ ...item, username }))} onCommit={persist} />
                  <Field
                    label="MAC address (for wake)"
                    value={computer.macAddress}
                    onChange={(macAddress) => update(index, (item) => ({ ...item, macAddress }))}
                    onCommit={persist}
                  />
                  <SelectField
                    label="Platform"
                    options={PLATFORMS}
                    value={computer.platform}
                    onChange={(platform) => updateAndPersist(index, (item) => ({ ...item, platform }))}
                  />
                  <SelectField
                    label="Orientation"
                    options={ORIENTATIONS}
                    value={computer.orientation}
                    onChange={(orientation) => updateAndPersist(index, (item) => ({ ...item, orientation }))}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <ToggleButton checked={computer.enabled} onChange={(enabled) => updateAndPersist(index, (item) => ({ ...item, enabled }))}>
                    Enabled
                  </ToggleButton>
                  <ToggleButton
                    checked={computer.capabilities.wallpaper}
                    onChange={(wallpaper) =>
                      updateAndPersist(index, (item) => ({
                        ...item,
                        capabilities: { ...item.capabilities, wallpaper },
                      }))}
                  >
                    Wallpaper
                  </ToggleButton>
                  <ToggleButton
                    checked={computer.capabilities.sleep}
                    onChange={(sleep) => updateAndPersist(index, (item) => ({ ...item, capabilities: { ...item.capabilities, sleep } }))}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Moon className="h-4 w-4" />
                      Sleep
                    </span>
                  </ToggleButton>
                  <ToggleButton
                    checked={computer.capabilities.wake}
                    onChange={(wake) => updateAndPersist(index, (item) => ({ ...item, capabilities: { ...item.capabilities, wake } }))}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Power className="h-4 w-4" />
                      Wake
                    </span>
                  </ToggleButton>
                  <ToggleButton
                    checked={computer.capabilities.voiceSatellite}
                    onChange={(voiceSatellite) =>
                      updateAndPersist(index, (item) => ({
                        ...item,
                        capabilities: { ...item.capabilities, voiceSatellite },
                      }))}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Satellite className="h-4 w-4" />
                      Voice Satellite
                    </span>
                  </ToggleButton>
                </div>

                <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                  <span>Host key pin</span>
                  <textarea
                    className="cyber-text-input min-h-20"
                    value={computer.hostKey}
                    onChange={(event) => update(index, (item) => ({ ...item, hostKey: event.target.value }))}
                    onBlur={persist}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.currentTarget.blur();
                    }}
                  />
                </label>

                {computer.sshPublicKey ? (
                  <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                    <span>Public key</span>
                    <textarea className="cyber-text-input min-h-20 font-mono text-xs" readOnly value={computer.sshPublicKey} />
                  </label>
                ) : null}
              </div>
            </div>
          );
        })}

        <MomentaryFeedbackButton
          type="button"
          className="config-page-button justify-center"
          onClick={() => {
            replaceComputers([...computersRef.current, newComputer()]);
            persist();
          }}
        >
          <Plus className="h-5 w-5" />
          Add Computer
        </MomentaryFeedbackButton>

        {message ? <p className="text-sm font-semibold text-neutral-300">{message}</p> : null}
      </div>
    </ConfigAccordion>
  );
}
