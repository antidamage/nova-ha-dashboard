"use client";

import { memoryAction } from "./administration-client";
import type { AgentAdministrationState } from "./useAgentAdministration";

// Selective conversational memory: review, pin, correct, expire, forget.
export function ConversationalMemory(
  {
    busy, memories, run,
  }: Pick<AgentAdministrationState,
    "busy" | "memories" | "run"
  >,
) {
  return (
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold uppercase tracking-wide text-neutral-400">Selective conversational memory</h3><div className="flex gap-2"><button disabled={busy} className="rounded-lg border border-white/15 px-3 py-1 text-sm" onClick={() => void run(() => memoryAction({ action: "consolidate" }))}>Consolidate</button><button disabled={busy} className="rounded-lg border border-white/15 px-3 py-1 text-sm" onClick={() => void run(() => memoryAction({ action: "backup" }))}>Backup and verify</button></div></div>
        <p className="mt-1 text-xs text-neutral-500">Only durable, non-routine facts are retained. Pin, correct, or forget them here.</p>
        {memories.filter((memory) => memory.needs_confirmation).map((memory) => (
          <div key={`review-${memory.id}`} className="mt-2 rounded-xl border border-amber-300/30 bg-amber-300/5 p-3 text-sm">
            <strong>Review required</strong><p>{memory.text}</p>
            <div className="mt-2 flex gap-3"><button disabled={busy} className="text-amber-200" onClick={() => void run(() => memoryAction({ action: "update", memoryId: memory.id, update: { needs_confirmation: false } }))}>Confirm memory</button><button disabled={busy} className="text-red-300" onClick={() => void run(() => memoryAction({ action: "forget", memoryId: memory.id }))}>Discard</button></div>
          </div>
        ))}
        <div className="mt-2 max-h-72 space-y-2 overflow-auto">{memories.map((memory) => (
          <div key={memory.id} className="rounded-xl bg-white/5 p-3 text-sm"><div className="flex justify-between gap-2"><strong>{memory.memory_type.replace("_", " ")}</strong><span className="text-xs text-neutral-500">{memory.pinned ? "Pinned" : ""}</span></div><p>{memory.text}</p><p className="mt-1 text-xs text-neutral-500">{memory.owner_id ?? "household"} · {new Date(memory.created_at).toLocaleDateString()}</p><div className="mt-2 flex flex-wrap gap-3"><button disabled={busy} className="text-cyan-300" onClick={() => void run(() => memoryAction({ action: "update", memoryId: memory.id, update: { pinned: !memory.pinned } }))}>{memory.pinned ? "Unpin" : "Pin"}</button><button disabled={busy} className="text-cyan-300" onClick={() => { const text = window.prompt("Correct this memory", memory.text); if (text?.trim()) void run(() => memoryAction({ action: "update", memoryId: memory.id, update: { text: text.trim() } })); }}>Correct</button><button disabled={busy} className="text-cyan-300" onClick={() => { const value = window.prompt("Expiry (ISO date-time, blank to leave unchanged)", memory.expires_at ?? ""); if (value?.trim()) void run(() => memoryAction({ action: "update", memoryId: memory.id, update: { expires_at: new Date(value).toISOString() } })); }}>Expiry</button><button disabled={busy} className="text-red-300" onClick={() => void run(() => memoryAction({ action: "forget", memoryId: memory.id }))}>Forget</button></div></div>
        ))}{!memories.length ? <p className="text-sm text-neutral-500">No saved conversational memories yet.</p> : null}</div>
      </div>
  );
}
