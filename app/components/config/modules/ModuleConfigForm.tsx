"use client";

import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import type { ModuleSummary } from "../../../../lib/modules/runtime/types";
import { LeafField } from "./LeafField";
import { fieldLabel } from "./module-config-model";
import type { ConfigResponse } from "./types";

// The per-module form generated from the manifest's config schema.
export function ModuleConfigForm({ busy, detail, save, setRows, setValue, summary }: {
  busy: boolean;
  detail: ConfigResponse;
  save: (body: Record<string, unknown>) => Promise<void>;
  setRows: (key: string, rows: Record<string, unknown>[]) => void;
  setValue: (path: string[], value: unknown) => void;
  summary: ModuleSummary;
}) {
  return (
        <div className="grid gap-3">
          {Object.entries(detail.schema.properties).map(([key, field]) =>
            field.type === "array" ? (
              // Repeating rows of leaves. The Discord module's `accounts`
              // mapping is the first of these: one row per person whose face
              // may open a session, each naming the Discord account that gets
              // the veto DM.
              <fieldset key={key} className="grid gap-3 border border-neutral-800 p-3">
                <legend className="px-1 text-xs font-black uppercase text-cyan-300">
                  {fieldLabel(key, field)}
                </legend>
                {field.description ? (
                  <p className="text-xs leading-relaxed text-neutral-400">{field.description}</p>
                ) : null}
                {(() => {
                  const rows = Array.isArray(detail.config[key])
                    ? (detail.config[key] as Record<string, unknown>[])
                    : [];
                  const atLimit = rows.length >= (field.maxItems ?? 50);
                  return (
                    <>
                      {rows.map((row, index) => (
                        <div
                          key={index}
                          className="grid gap-3 border border-neutral-800/70 bg-neutral-950/40 p-3"
                        >
                          {Object.entries(field.items.properties)
                            // Secrets are stored by name in the dashboard's
                            // secrets store, and a field inside a repeating row
                            // has no stable name -- row 2's "token" and row 3's
                            // would collide. Skip them rather than render a
                            // control whose writes go somewhere surprising.
                            // `coerceModuleConfig` drops them on the way in too.
                            .filter(([, child]) => child.format !== "secret")
                            .map(([childKey, child]) => (
                              <LeafField
                                key={childKey}
                                disabled={busy}
                                field={child}
                                label={fieldLabel(childKey, child)}
                                value={row?.[childKey]}
                                onChange={(value) => {
                                  const next = rows.map((existing, at) =>
                                    at === index ? { ...existing, [childKey]: value } : existing,
                                  );
                                  setRows(key, next);
                                }}
                                onSecret={() => {}}
                              />
                            ))}
                          <MomentaryFeedbackButton
                            type="button"
                            className="module-row-action"
                            disabled={busy}
                            onClick={() =>
                              setRows(
                                key,
                                rows.filter((_, at) => at !== index),
                              )
                            }
                          >
                            Remove
                          </MomentaryFeedbackButton>
                        </div>
                      ))}
                      {rows.length === 0 ? (
                        <p className="text-xs text-neutral-500">None configured.</p>
                      ) : null}
                      <MomentaryFeedbackButton
                        type="button"
                        className="module-row-action"
                        disabled={busy || atLimit}
                        onClick={() => setRows(key, [...rows, {}])}
                      >
                        Add
                      </MomentaryFeedbackButton>
                    </>
                  );
                })()}
              </fieldset>
            ) : field.type === "object" ? (
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
  );
}
