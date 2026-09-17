"use client";

import type { MutableRefObject } from "react";
import { Activity, Box, RefreshCw, Trash2, Upload } from "lucide-react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { moduleKey } from "./phonoscope-config-model";
import type { ModuleSummary } from "./types";

/**
 * The installed module packages: upload, refresh, diagnostics, and the list
 * with a remove button on each non-built-in module. Split out of
 * `PhonoscopeConfig.tsx` (specs/agent-token-footprint.md §4).
 */
export function ModulePackagesSection({
  busy,
  fileRef,
  load,
  loadDiagnostics,
  modules,
  removeModule,
  uploadPackage,
}: {
  busy: boolean;
  fileRef: MutableRefObject<HTMLInputElement | null>;
  load: () => Promise<void>;
  loadDiagnostics: () => Promise<void>;
  modules: ModuleSummary[];
  removeModule: (module: ModuleSummary) => Promise<void>;
  uploadPackage: (file: File) => Promise<void>;
}) {
  return (
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
  );
}
