"use client";

export function ComparisonSide({
  label,
  spoken,
  text,
  elapsedMs,
}: {
  label: string;
  spoken: boolean;
  text: string | null;
  elapsedMs: number | null;
}) {
  return (
    <div className="border-l-2 border-neutral-700 pl-2">
      <p className="text-[11px] text-neutral-500">
        {label}
        {elapsedMs !== null ? ` · ${Math.round(elapsedMs)}ms` : ""}
        {spoken ? " · spoken" : ""}
      </p>
      <p className={`text-xs leading-snug ${spoken ? "text-neutral-200" : "text-neutral-400"}`}>
        {text ?? "(no answer)"}
      </p>
    </div>
  );
}
