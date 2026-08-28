"use client";

import { Blocks, Download, RotateCcw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfigAccordion, CheckboxRow, SliderControlPanel } from "./ConfigControls";
import { ConfigSelect } from "./ConfigSelect";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import { ModuleSlot } from "./modules/ModuleSlot";
import type {
  ModuleConfigField,
  ModuleConfigSchema,
} from "../../lib/modules/runtime/manifest";
import type { ModuleSummary } from "../../lib/modules/runtime/types";

/**
 * The Modules tab (`specs/module-system.md` §6).
 *
 * The per-module form is generated from the manifest's config schema and uses
 * only the shared controls in `nova-ha-dashboard/CLAUDE.md` — no raw inputs and
 * no JSON textarea. Module config is deliberately not text-editable: export and
 * import are the transfer mechanism, and they strip secret values.
 */

type ConfigResponse = {
  config: Record<string, unknown>;
  schema: ModuleConfigSchema;
  messages: Record<string, string>;
};

function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

const STATE_LABEL: Record<ModuleSummary["state"], string> = {
  loaded: "Running",
  disabled: "Disabled",
  failed: "Failed",
};

function TextField({
  disabled,
  label,
  multiline,
  onCommit,
  value,
}: {
  disabled?: boolean;
  label: string;
  multiline?: boolean;
  onCommit: (value: string) => void;
  value: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commonProps = {
    className: "module-config-input",
    disabled,
    value: draft,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: () => {
      if (draft !== value) {
        onCommit(draft);
      }
    },
  };
  return (
    <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
      {label}
      {multiline ? <textarea rows={2} {...commonProps} /> : <input type="text" {...commonProps} />}
    </label>
  );
}

function fieldLabel(key: string, field: { title?: string }) {
  if (field.title) {
    return field.title;
  }
  // "queueIntervalMs" -> "Queue interval ms". A module that wants better writes
  // a title; this is only so a missing one is still readable.
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

/**
 * Preview tracks the drag; only the commit writes. Tap-to-type comes free with
 * this control (`NumericEntryPopover`), which is the whole reason module number
 * fields use a slider rather than a raw input.
 */
function NumberField({
  field,
  label,
  onChange,
  value,
}: {
  field: { minimum?: number; maximum?: number; step?: number };
  label: string;
  onChange: (value: unknown) => void;
  value: unknown;
}) {
  const min = field.minimum ?? 0;
  const max = field.maximum ?? 100;
  const committed = typeof value === "number" ? value : min;
  const [preview, setPreview] = useState(committed);

  useEffect(() => {
    setPreview(committed);
  }, [committed]);

  return (
    <SliderControlPanel
      ariaLabel={label}
      ariaValueText={String(preview)}
      color={[64, 224, 255]}
      label={label}
      min={min}
      max={max}
      step={field.step ?? 1}
      value={preview}
      valueText={String(preview)}
      onPreview={setPreview}
      onCommit={(next: number) => onChange(next)}
    />
  );
}

function LeafField({
  disabled,
  field,
  label,
  onChange,
  onSecret,
  secretConfigured,
  value,
}: {
  disabled: boolean;
  field: Extract<ModuleConfigField, { type: "boolean" | "string" | "number" }>;
  label: string;
  onChange: (value: unknown) => void;
  onSecret: (value: string) => void;
  secretConfigured?: boolean;
  value: unknown;
}) {
  if (field.type === "boolean") {
    return (
      <CheckboxRow
        checked={value === true}
        disabled={disabled}
        label={label}
        onChange={(next: boolean) => onChange(next)}
      />
    );
  }

  if (field.type === "number") {
    return <NumberField field={field} label={label} onChange={onChange} value={value} />;
  }

  if (field.format === "secret") {
    // The value is never fetched or shown — only whether one is set. Typing a
    // new one replaces it; the field is left blank otherwise.
    return (
      <div className="grid gap-1">
        <TextField
          label={`${label} — ${secretConfigured ? "set, type to replace" : "not set"}`}
          value=""
          onCommit={(next) => {
            if (next.trim()) {
              onSecret(next.trim());
            }
          }}
          disabled={disabled}
        />
      </div>
    );
  }

  if (field.readOnly) {
    return (
      <div className="grid gap-1 text-xs font-black uppercase text-neutral-400">
        {label}
        <p className="text-sm font-black text-neutral-200">
          {typeof value === "string" && value ? value : "—"}
        </p>
      </div>
    );
  }

  if (field.enum) {
    return (
      <ConfigSelect
        label={label}
        value={typeof value === "string" ? value : (field.default as string) ?? field.enum[0]}
        options={field.enum.map((option) => ({ value: option, label: option }))}
        onChange={(next: string) => onChange(next)}
        disabled={disabled}
      />
    );
  }

  return (
    <TextField
      label={label}
      value={typeof value === "string" ? value : ""}
      onCommit={onChange}
      disabled={disabled}
      multiline={field["x-nova-control"] === "template"}
    />
  );
}

function ModuleRow({ module: summary, onChanged }: { module: ModuleSummary; onChanged: () => void }) {
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
        <div className="grid gap-3">
          {Object.entries(detail.schema.properties).map(([key, field]) =>
            field.type === "object" ? (
              <fieldset key={key} className="grid gap-3 border border-neutral-800 p-3">
                <legend className="px-1 text-xs font-black uppercase text-cyan-300">
                  {fieldLabel(key, field)}
                </legend>
                {Object.entries(field.properties).map(([childKey, child]) => (
                  <LeafField
                    key={childKey}
                    disabled={busy}
                    field={child}
                    label={fieldLabel(childKey, child)}
                    secretConfigured={
                      summary.secrets.find((secret) => secret.name === childKey)?.configured
                    }
                    value={(detail.config[key] as Record<string, unknown> | undefined)?.[childKey]}
                    onChange={(value) => setValue([key, childKey], value)}
                    onSecret={(value) => void save({ secrets: { [childKey]: value } })}
                  />
                ))}
              </fieldset>
            ) : (
              <LeafField
                key={key}
                disabled={busy}
                field={field}
                label={fieldLabel(key, field)}
                secretConfigured={summary.secrets.find((secret) => secret.name === key)?.configured}
                value={detail.config[key]}
                onChange={(value) => setValue([key], value)}
                onSecret={(value) => void save({ secrets: { [key]: value } })}
              />
            ),
          )}
        </div>
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
