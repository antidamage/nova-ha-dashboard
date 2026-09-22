"use client";

import { Blocks, Cpu, Download, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { loadControlModules, type ControlModulesPayload } from "../devices/control-modules-client";

/**
 * Device modules on the Modules tab (specs/control-modules.md).
 *
 * The same module list the Devices tab configures, seen from the other side:
 * what this build ships, what has been installed, and a package for each — so a
 * device type built here can be handed to another dashboard, and one from
 * another dashboard can be installed into this one.
 *
 * A package is the module definition alone. Presets stay here: they name this
 * house's entity ids and rooms, and a module that travelled with them would be
 * a module that could not be installed anywhere else.
 */

type Action = { id: string; kind: "download" | "remove" } | null;

export function DeviceModules() {
  const [payload, setPayload] = useState<ControlModulesPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<Action>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPayload(await loadControlModules());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read the device modules");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const send = useCallback(async (request: RequestInfo, init?: RequestInit) => {
    try {
      const response = await fetch(request, init);
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? `Request failed: ${response.status}`);
      }
      await refresh();
      setMessage(null);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not work");
      return false;
    }
  }, [refresh]);

  const install = useCallback(async (file: File) => {
    setMessage(null);
    try {
      const text = await file.text();
      const ok = await send("/api/control-modules/packages", {
        body: JSON.stringify({ package: JSON.parse(text) }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (ok) {
        setMessage("Installed. It is now a device type on the Devices tab.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? `That file is not a module package: ${error.message}` : "That file is not a module package");
    }
  }, [send]);

  const modules = payload?.modules ?? [];
  const installedIds = new Set(payload?.installedIds ?? []);

  return (
    <div className="grid gap-3">
      <p className="device-intro">
        A device module is a device type: what a device is, what it can be set to, and which behaviour it runs on.
        Download one to use it on another dashboard, or install one from here. Presets stay on the dashboard they were
        made on.
      </p>

      {modules.map((module) => (
        <div className="device-module-row" key={module.id}>
          <span className="device-module-icon">
            {module.layer === "driver"
              ? <Cpu className="h-5 w-5" aria-hidden="true" />
              : <Blocks className="h-5 w-5" aria-hidden="true" />}
          </span>
          <span className="device-module-main">
            <span className="device-module-name">{module.name}</span>
            <span className="device-module-summary">{module.summary}</span>
            <span className="device-module-meta">
              {module.layer === "driver" ? "Driver" : `Control · ${module.category}`}
              {module.behaviours.length ? ` · ${module.behaviours.length} behaviours` : ""}
              {installedIds.has(module.id) ? " · installed here" : " · ships with Nova"}
            </span>
          </span>
          <span className="device-module-actions">
            <a className="module-row-action" href={`/api/control-modules/packages/${module.id}`} download>
              <Download className="h-4 w-4" /> Download
            </a>
            {installedIds.has(module.id) ? (
              <MomentaryFeedbackButton
                type="button"
                className="module-row-action module-row-action-danger"
                disabled={busy?.id === module.id}
                onClick={() => {
                  setBusy({ id: module.id, kind: "remove" });
                  void send(`/api/control-modules/packages/${module.id}`, { method: "DELETE" }).finally(() => setBusy(null));
                }}
              >
                <Trash2 className="h-4 w-4" /> Remove
              </MomentaryFeedbackButton>
            ) : null}
          </span>
        </div>
      ))}

      {payload?.installErrors.length ? (
        <ul className="device-module-errors">
          {payload.installErrors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <MomentaryFeedbackButton
          type="button"
          className="module-row-action module-row-action-wide"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-4 w-4" /> Install a device module
        </MomentaryFeedbackButton>
        <input
          ref={fileRef}
          className="hidden"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void install(file);
          }}
        />
      </div>

      {message ? <p className="text-sm font-semibold text-neutral-300">{message}</p> : null}
    </div>
  );
}
