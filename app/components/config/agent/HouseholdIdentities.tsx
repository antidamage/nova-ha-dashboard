"use client";

import { administrationAction } from "./administration-client";
import type { AgentAdministrationState } from "./useAgentAdministration";

// Household identities: one role picker per recognised person.
export function HouseholdIdentities(
  {
    busy, profiles, roles, run,
  }: Pick<AgentAdministrationState,
    "busy" | "profiles" | "roles" | "run"
  >,
) {
  return (
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-400">Household identities</h3>
          {profiles?.profiles.map((profile) => (
            <label key={profile.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 p-3">
              <span><strong>{profile.displayName}</strong><span className="block text-xs text-neutral-500">{profile.id}</span></span>
              <select
                className="rounded-lg bg-neutral-900 px-2 py-2 text-sm"
                value={roles.get(profile.id) ?? "recognized_household"}
                disabled={busy}
                onChange={(event) => void run(() => administrationAction({
                  action: "set-role", personId: profile.id, role: event.target.value,
                }))}
              >
                <option value="owner">Owner</option>
                <option value="recognized_household">Household</option>
                <option value="guest">Guest</option>
              </select>
            </label>
          ))}
          {!profiles?.profiles.length ? <p className="text-sm text-neutral-500">No recognized people yet.</p> : null}
        </div>
  );
}
