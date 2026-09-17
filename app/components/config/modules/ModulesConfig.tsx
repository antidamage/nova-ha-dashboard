"use client";

import { Blocks, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfigAccordion } from "../../ConfigControls";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import type { ModuleSummary } from "../../../../lib/modules/runtime/types";
import { ModuleRow } from "./ModuleRow";

/**
 * The Modules tab (`specs/module-system.md` §6).
 *
 * The per-module form is generated from the manifest's config schema and uses
 * only the shared controls in `nova-ha-dashboard/CLAUDE.md` — no raw inputs and
 * no JSON textarea. Module config is deliberately not text-editable: export and
 * import are the transfer mechanism, and they strip secret values.
 */

export function ModulesConfig() {
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const packageRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/modules", { cache: "no-store" });
      if (response.ok) {
        setModules(((await response.json()) as { modules?: ModuleSummary[] }).modules ?? []);
      }
    } catch {
      setMessage("Could not read the installed modules");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = useCallback(
    async (file: File) => {
      setInstalling(true);
      setMessage(null);
      try {
        const form = new FormData();
        form.set("package", file);
        const response = await fetch("/api/modules", { method: "POST", body: form });
        if (!response.ok) {
          throw new Error(((await response.json()) as { error?: string }).error ?? "Install failed");
        }
        await refresh();
        setMessage("Installed. Reload the dashboard to pick up its client half.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Install failed");
      } finally {
        setInstalling(false);
      }
    },
    [refresh],
  );

  return (
    <ConfigAccordion
      id="modules"
      title="Modules"
      icon={<Blocks className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <div className="grid gap-4">
        {modules.length ? (
          modules.map((module) => (
            <ModuleRow key={module.id} module={module} onChanged={refresh} />
          ))
        ) : (
          <p className="text-sm font-black uppercase text-neutral-400">No modules installed.</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <MomentaryFeedbackButton
            type="button"
            className="module-row-action module-row-action-wide"
            disabled={installing}
            onClick={() => packageRef.current?.click()}
          >
            <Upload className="h-4 w-4" /> {installing ? "Installing" : "Install a module"}
          </MomentaryFeedbackButton>
          <input
            ref={packageRef}
            className="hidden"
            type="file"
            accept="application/zip,.zip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                void install(file);
              }
            }}
          />
        </div>

        {message ? <p className="text-sm font-black uppercase text-cyan-200">{message}</p> : null}
      </div>
    </ConfigAccordion>
  );
}
