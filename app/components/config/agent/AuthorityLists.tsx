"use client";

import { administrationAction } from "./administration-client";
import type { AgentAdministrationState } from "./useAgentAdministration";

// Grants, active goals and the recent audit trail.
export function AuthorityLists(
  {
    activeGoals, administration, busy, run,
  }: Pick<AgentAdministrationState,
    "activeGoals" | "administration" | "busy" | "run"
  >,
) {
  return (
      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-400">Grants</h3>
          <div className="mt-2 space-y-2">{administration?.grants.map((grant) => (
            <div key={grant.id} className="rounded-xl bg-white/5 p-3 text-sm">
              <div className="flex justify-between gap-2"><strong>{grant.capability}</strong><span>{grant.active ? "Active" : "Revoked"}</span></div>
              <p className="text-xs text-neutral-500">{grant.grantee_id}{grant.target_scope.length ? ` · ${grant.target_scope.join(", ")}` : ""}</p>
              {grant.active ? <button disabled={busy} className="mt-2 text-red-300" onClick={() => void run(() => administrationAction({ action: "revoke-grant", grantId: grant.id }))}>Revoke now</button> : null}
            </div>
          ))}</div>
        </div>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-400">Active goals</h3>
          <div className="mt-2 space-y-2">{activeGoals.map((goal) => (
            <div key={goal.id} className="rounded-xl bg-white/5 p-3 text-sm"><strong>{goal.summary}</strong><p className="text-xs text-neutral-500">{goal.status} · {goal.id}</p><button disabled={busy} className="mt-2 text-red-300" onClick={() => void run(() => administrationAction({ action: "cancel-goal", goalId: goal.id }))}>Cancel goal</button></div>
          ))}{!activeGoals.length ? <p className="text-sm text-neutral-500">No active durable goals.</p> : null}</div>
        </div>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-400">Recent audit</h3>
          <div className="mt-2 max-h-80 space-y-2 overflow-auto">{administration?.audit.slice().reverse().map((event) => (
            <div key={event.id} className="rounded-xl bg-white/5 p-3 text-xs"><strong>{event.action}</strong> {event.object_type}<p className="break-all text-neutral-500">{event.object_id} · {event.actor_id}</p></div>
          ))}</div>
        </div>
      </div>
  );
}
