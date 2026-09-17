"use client";

import { Download, RotateCcw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckboxRow } from "../../ConfigControls";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { ModuleSlot } from "../../modules/ModuleSlot";
import type { ModuleSummary } from "../../../../lib/modules/runtime/types";
import { ModuleConfigForm } from "./ModuleConfigForm";
import { downloadJson, STATE_LABEL } from "./module-config-model";
import type { ConfigResponse } from "./types";

export function ModuleRow({ module: summary, onChanged }: { module: ModuleSummary; onChanged: () => void }) {
  const [detail, setDetail] = useState<ConfigResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch(`/api/modules/${summary.id}/config`, { cache: "no-store" });
      if (response.ok) {
        setDetail((await response.json()) as ConfigResponse);
      }
    } catch {
      // The row still renders its lifecycle controls without the form.
    }
  }, [summary.id]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const save = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setMessage(null);
      try {
        const response = await fetch(`/api/modules/${summary.id}/config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as { config?: Record<string, unknown>; error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Save failed");
        }
        setDetail((current) => (current ? { ...current, config: payload.config ?? current.config } : current));
        onChanged();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Save failed");
      } finally {
        setBusy(false);
      }
    },
    [onChanged, summary.id],
  );

  const setValue = useCallback(
    (path: string[], value: unknown) => {
      if (!detail) {
        return;
      }
      const next = { ...detail.config };
      if (path.length === 1) {
        next[path[0]] = value;
      } else {
        const group = { ...((next[path[0]] as Record<string, unknown>) ?? {}) };
        group[path[1]] = value;
        next[path[0]] = group;
      }
      setDetail({ ...detail, config: next });
      void save({ config: next });
    },
    [detail, save],
  );

  /**
   * Replace the whole row list for an array field.
   *
   * Arrays are edited as a unit rather than through `setValue`'s path walk:
   * the path form assumes two levels and would have to grow an index case that
   * every other caller pays for. Add and remove also need to write the list
   * itself, not a leaf inside it.
   */
  const setRows = useCallback(
    (key: string, rows: Record<string, unknown>[]) => {
      if (!detail) {
        return;
      }
      const next = { ...detail.config, [key]: rows };
      setDetail({ ...detail, config: next });
      void save({ config: next });
    },
    [detail, save],
  );

  const lifecycle = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setMessage(null);
      try {
        const response = await fetch(`/api/modules/${summary.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new Error(((await response.json()) as { error?: string }).error ?? "Failed");
        }
        onChanged();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed");
      } finally {
        setBusy(false);
      }
    },
    [onChanged, summary.id],
  );

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      await fetch(`/api/modules/${summary.id}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }, [onChanged, summary.id]);

  const importConfig = useCallback(
    async (file: File) => {
      try {
        const parsed = JSON.parse(await file.text()) as { moduleId?: string; config?: unknown };
        if (parsed.moduleId && parsed.moduleId !== summary.id) {
          throw new Error(`That file is for "${parsed.moduleId}"`);
        }
        await save({ config: parsed.config ?? {} });
        await loadConfig();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Import failed");
      }
    },
    [loadConfig, save, summary.id],
  );

  const missingSecrets = summary.secrets.filter((secret) => !secret.configured);

  return (
    <div className="module-row grid gap-3 border border-neutral-700 bg-neutral-950/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-black uppercase text-neutral-50">{summary.name}</p>
          <p className="text-xs font-black uppercase text-neutral-400">
            {summary.id} · v{summary.version} · {STATE_LABEL[summary.state]}
          </p>
          {summary.description ? (
            <p className="mt-1 text-sm text-neutral-300">{summary.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CheckboxRow
            checked={summary.enabled}
            disabled={busy}
            label="Enabled"
            onChange={(enabled: boolean) => void lifecycle({ enabled })}
          />
          <MomentaryFeedbackButton
            type="button"
            className="module-row-action"
            disabled={busy}
            aria-label={`Reload ${summary.name}`}
            onClick={() => void lifecycle({ action: "reload" })}
          >
            <RotateCcw className="h-4 w-4" />
          </MomentaryFeedbackButton>
          <a className="module-row-action" href={`/api/modules/${summary.id}/download`} aria-label={`Download ${summary.name}`}>
            <Download className="h-4 w-4" />
          </a>
          <MomentaryFeedbackButton
            type="button"
            className="module-row-action module-row-action-danger"
            disabled={busy}
            aria-label={`Delete ${summary.name}`}
            onClick={() => void remove()}
          >
            <Trash2 className="h-4 w-4" />
          </MomentaryFeedbackButton>
        </div>
      </div>

      {summary.error ? (
        <p className="text-sm font-black uppercase text-red-400">{summary.error}</p>
      ) : null}
      {missingSecrets.length ? (
        <p className="text-sm font-black uppercase text-yellow-200">
          Needs a secret: {missingSecrets.map((secret) => secret.name).join(", ")}
        </p>
      ) : null}
      {summary.status?.summary ? (
        <p className="text-sm font-black uppercase text-cyan-200">{summary.status.summary}</p>
      ) : null}

      {/* The module's own status area. */}
      <ModuleSlot
        id="config.module.panel"
        context={{ moduleId: summary.id, config: detail?.config ?? {}, status: summary.status }}
      />

      {detail && Object.keys(detail.schema.properties).length ? (
        <ModuleConfigForm busy={busy} detail={detail} save={save} setRows={setRows} setValue={setValue} summary={summary} />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <MomentaryFeedbackButton
          type="button"
          className="module-row-action module-row-action-wide"
          disabled={busy}
          onClick={async () => {
            const response = await fetch(`/api/modules/${summary.id}/config?export=1`);
            if (response.ok) {
              downloadJson(`${summary.id}-config.json`, await response.json());
            }
          }}
        >
          <Download className="h-4 w-4" /> Export config
        </MomentaryFeedbackButton>
        <MomentaryFeedbackButton
          type="button"
          className="module-row-action module-row-action-wide"
          disabled={busy}
          onClick={() => importRef.current?.click()}
        >
          <Upload className="h-4 w-4" /> Import config
        </MomentaryFeedbackButton>
        <input
          ref={importRef}
          className="hidden"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              void importConfig(file);
            }
          }}
        />
      </div>

      {message ? <p className="text-sm font-black uppercase text-red-400">{message}</p> : null}
    </div>
  );
}
