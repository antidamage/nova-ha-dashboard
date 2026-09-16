"use client";

export function SelectControl<T extends string>({
  detail,
  label,
  onChange,
  options,
  value,
}: {
  detail: string;
  label: string;
  onChange: (value: T) => void;
  options: readonly { label: string; value: T }[];
  value: T;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-black uppercase text-neutral-400">
      <span>{label}</span>
      <select
        className="cyber-text-input"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="font-sans text-xs font-normal normal-case leading-snug text-neutral-500">
        {detail}
      </span>
    </label>
  );
}
