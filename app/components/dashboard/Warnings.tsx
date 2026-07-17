"use client";

export function Warnings({ warnings }: { warnings?: string[] }) {
  if (!warnings?.length) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {warnings.map((warning) => (
        <span
          key={warning}
          className="border border-yellow-300/50 bg-yellow-300/10 px-3 py-2 text-xs font-black uppercase text-yellow-100"
        >
          {warning}
        </span>
      ))}
    </div>
  );
}
