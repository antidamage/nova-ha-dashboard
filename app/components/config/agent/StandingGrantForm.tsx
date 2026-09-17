"use client";

import type { AgentAdministrationState } from "./useAgentAdministration";

// The new-standing-grant form.
export function StandingGrantForm(
  {
    busy, capability, createGrant, currency, endTime, expiresAt, granteeId, locations, maxAmount,
    maxUses, notifyOnUse, profiles, recipients, run, setCapability, setCurrency, setEndTime,
    setExpiresAt, setGranteeId, setLocations, setMaxAmount, setMaxUses, setNotifyOnUse,
    setRecipients, setStartTime, setTargets, startTime, targets,
  }: Pick<AgentAdministrationState,
    "busy" | "capability" | "createGrant" | "currency" | "endTime" | "expiresAt" | "granteeId" |
    "locations" | "maxAmount" | "maxUses" | "notifyOnUse" | "profiles" | "recipients" | "run" |
    "setCapability" | "setCurrency" | "setEndTime" | "setExpiresAt" | "setGranteeId" |
    "setLocations" | "setMaxAmount" | "setMaxUses" | "setNotifyOnUse" | "setRecipients" |
    "setStartTime" | "setTargets" | "startTime" | "targets"
  >,
) {
  return (
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-400">New standing grant</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className="rounded-lg bg-neutral-900 p-2" value={granteeId} onChange={(e) => setGranteeId(e.target.value)}>
              <option value="">Choose person</option>
              {profiles?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}
            </select>
            <select className="rounded-lg bg-neutral-900 p-2" value={capability} onChange={(e) => setCapability(e.target.value)}>
              <option value="home.control">Home control</option>
              <option value="home.read">Home state</option>
              <option value="tasks.manage">Manage tasks</option>
              <option value="tasks.read">Read tasks</option>
              <option value="knowledge.read">Web knowledge</option>
            </select>
            <input className="rounded-lg bg-neutral-900 p-2" placeholder="Targets, comma separated" value={targets} onChange={(e) => setTargets(e.target.value)} />
            <input className="rounded-lg bg-neutral-900 p-2" placeholder="Locations" value={locations} onChange={(e) => setLocations(e.target.value)} />
            <input className="rounded-lg bg-neutral-900 p-2" placeholder="Recipients" value={recipients} onChange={(e) => setRecipients(e.target.value)} />
            <input className="rounded-lg bg-neutral-900 p-2" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            <input className="rounded-lg bg-neutral-900 p-2" type="number" min="1" placeholder="Maximum uses" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
            <div className="flex gap-2"><input className="min-w-0 flex-1 rounded-lg bg-neutral-900 p-2" type="number" min="0" step="0.01" placeholder="Amount budget" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} /><input className="w-20 rounded-lg bg-neutral-900 p-2" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} /></div>
            <input aria-label="Grant start time" className="rounded-lg bg-neutral-900 p-2" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <input aria-label="Grant end time" className="rounded-lg bg-neutral-900 p-2" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-300"><input type="checkbox" checked={notifyOnUse} onChange={(e) => setNotifyOnUse(e.target.checked)} /> Notify on use</label>
          <button disabled={busy || !granteeId} className="rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-black disabled:opacity-40" onClick={() => void run(createGrant)}>Create grant</button>
        </div>
  );
}
