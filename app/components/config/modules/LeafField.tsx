"use client";

import { useEffect, useState } from "react";
import { CheckboxRow, SliderControlPanel } from "../../ConfigControls";
import { ConfigSelect } from "../../ConfigSelect";
import type { ModuleConfigField } from "../../../../lib/modules/runtime/manifest";

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

export function LeafField({
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
