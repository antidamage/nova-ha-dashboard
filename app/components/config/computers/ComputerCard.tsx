"use client";

import { Laptop, Moon, Power, Satellite, Trash2 } from "lucide-react";
import type { MutableRefObject } from "react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import type { ManagedComputerFormValue } from "../../managed-computers-client";
import { ORIENTATIONS, PLATFORMS } from "./constants";
import { Field } from "./Field";
import { SelectField } from "./SelectField";
import { ToggleButton } from "./ToggleButton";

export function ComputerCard({
  computer,
  computersRef,
  index,
  persist,
  replaceComputers,
  update,
  updateAndPersist,
}: {
  computer: ManagedComputerFormValue;
  computersRef: MutableRefObject<ManagedComputerFormValue[]>;
  index: number;
  persist: () => void;
  replaceComputers: (next: ManagedComputerFormValue[]) => void;
  update: (index: number, updater: (computer: ManagedComputerFormValue) => ManagedComputerFormValue) => void;
  updateAndPersist: (index: number, updater: (computer: ManagedComputerFormValue) => ManagedComputerFormValue) => void;
}) {
  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
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
          {computer.platform === "windows" ? (
            <ToggleButton
              checked={computer.capabilities.lockScreen}
              onChange={(lockScreen) =>
                updateAndPersist(index, (item) => ({
                  ...item,
                  capabilities: { ...item.capabilities, lockScreen },
                }))}
            >
              Lock screen
            </ToggleButton>
          ) : null}
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
}
