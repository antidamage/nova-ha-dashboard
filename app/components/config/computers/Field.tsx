"use client";

export function Field({
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
