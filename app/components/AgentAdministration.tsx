"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentAdministrationPayload,
  AgentMemory,
  SpeakerProfilesPayload,
} from "../../lib/iridium-voice-settings";

const terminalGoalStates = new Set(["satisfied", "cancelled", "expired", "failed"]);

async function administrationAction(body: Record<string, unknown>) {
  const response = await fetch("/api/voice/administration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Administration request failed (${response.status})`);
}

async function memoryAction(body: Record<string, unknown>) {
  const response = await fetch("/api/voice/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Memory request failed (${response.status})`);
}

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function AgentAdministration() {
  const [administration, setAdministration] = useState<AgentAdministrationPayload | null>(null);
  const [profiles, setProfiles] = useState<SpeakerProfilesPayload | null>(null);
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [granteeId, setGranteeId] = useState("");
  const [capability, setCapability] = useState("home.control");
  const [targets, setTargets] = useState("");
  const [recipients, setRecipients] = useState("");
  const [locations, setLocations] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [currency, setCurrency] = useState("NZD");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notifyOnUse, setNotifyOnUse] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [adminResponse, profileResponse, memoryResponse] = await Promise.all([
        fetch("/api/voice/administration", { cache: "no-store" }),
        fetch("/api/voice/speaker-profiles", { cache: "no-store" }),
        fetch("/api/voice/memories", { cache: "no-store" }),
      ]);
      if (!adminResponse.ok || !profileResponse.ok) throw new Error("Voice administration unavailable");
      const admin = await adminResponse.json() as AgentAdministrationPayload;
      const people = await profileResponse.json() as SpeakerProfilesPayload;
      if (memoryResponse.ok) setMemories(((await memoryResponse.json()) as { memories: AgentMemory[] }).memories);
      setAdministration(admin);
      setProfiles(people);
      setGranteeId((current) => current || people.profiles[0]?.id || "");
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Voice administration unavailable");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const roles = useMemo(
    () => new Map(administration?.identities.map((identity) => [identity.person_id, identity.role])),
    [administration],
  );
  const activeGoals = administration?.goals.filter((goal) => !terminalGoalStates.has(goal.status)) ?? [];

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Administration request failed");
    } finally {
      setBusy(false);
    }
  }

  async function createGrant() {
    if (!granteeId) return;
    const grant: Record<string, unknown> = {
      grantee_id: granteeId,
      capability,
      target_scope: csv(targets),
      recipients: csv(recipients),
      locations: csv(locations),
      notify_on_use: notifyOnUse,
    };
    if (expiresAt) grant.expires_at = new Date(expiresAt).toISOString();
    if (maxUses) grant.max_uses = Number(maxUses);
    if (maxAmount) {
      grant.max_amount = Number(maxAmount);
      grant.currency = currency.toUpperCase();
    }
    if (startTime && endTime) grant.schedule = { start_time: startTime, end_time: endTime };
    await administrationAction({ action: "create-grant", grant });
    setTargets("");
    setRecipients("");
    setLocations("");
    setExpiresAt("");
    setMaxUses("");
    setMaxAmount("");
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-neutral-950/60 p-5 text-neutral-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Voice agent authority</h2>
          <p className="text-sm text-neutral-400">Roles, standing grants, durable work, and audit replay.</p>
        </div>
        <button className="rounded-xl border border-white/15 px-3 py-2 text-sm" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
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
      </div>

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
    </section>
  );
}
