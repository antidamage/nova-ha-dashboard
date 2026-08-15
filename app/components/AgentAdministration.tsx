"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentAdministrationPayload,
  AgentAutomation,
  AgentMemory,
  ProactiveIntervention,
  SpeakerProfilesPayload,
} from "../../lib/voice-host-settings";

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

async function automationAction(body: Record<string, unknown>) {
  const response = await fetch("/api/voice/automations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Automation request failed (${response.status})`);
}

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function AgentAdministration() {
  const [administration, setAdministration] = useState<AgentAdministrationPayload | null>(null);
  const [profiles, setProfiles] = useState<SpeakerProfilesPayload | null>(null);
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [automations, setAutomations] = useState<AgentAutomation[]>([]);
  const [interventions, setInterventions] = useState<ProactiveIntervention[]>([]);
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
  const [automationOwnerId, setAutomationOwnerId] = useState("");
  const [automationId, setAutomationId] = useState("");
  const [automationSummary, setAutomationSummary] = useState("");
  const [automationEventKind, setAutomationEventKind] = useState("device_health");
  const [automationChannel, setAutomationChannel] = useState("dashboard");
  const [automationMessage, setAutomationMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [adminResponse, profileResponse, memoryResponse, automationResponse] = await Promise.all([
        fetch("/api/voice/administration", { cache: "no-store" }),
        fetch("/api/voice/speaker-profiles", { cache: "no-store" }),
        fetch("/api/voice/memories", { cache: "no-store" }),
        fetch("/api/voice/automations", { cache: "no-store" }),
      ]);
      if (!adminResponse.ok || !profileResponse.ok) throw new Error("Voice administration unavailable");
      const admin = await adminResponse.json() as AgentAdministrationPayload;
      const people = await profileResponse.json() as SpeakerProfilesPayload;
      if (memoryResponse.ok) setMemories(((await memoryResponse.json()) as { memories: AgentMemory[] }).memories);
      if (automationResponse.ok) {
        const automationPayload = await automationResponse.json() as {
          automations: AgentAutomation[];
          interventions: ProactiveIntervention[];
        };
        setAutomations(automationPayload.automations);
        setInterventions(automationPayload.interventions);
      }
      setAdministration(admin);
      setProfiles(people);
      setGranteeId((current) => current || people.profiles[0]?.id || "");
      setAutomationOwnerId((current) => current || admin.identities.find((identity) => identity.role === "owner")?.person_id || "");
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
  const research = administration?.research ?? [];
  const briefings = administration?.briefings ?? [];
  const briefingSchedules = administration?.briefingSchedules ?? [];
  const subscriptions = administration?.subscriptions ?? [];

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

  async function createAutomation() {
    if (!automationOwnerId || !automationId.trim() || !automationSummary.trim()) return;
    await automationAction({
      action: "draft",
      ownerId: automationOwnerId,
      draft: {
        id: automationId.trim(),
        summary: automationSummary.trim(),
        trigger: { kind: automationEventKind },
        proposed_actions: [{ channel: automationChannel, message: automationMessage.trim() || automationSummary.trim() }],
      },
    });
    setAutomationId("");
    setAutomationSummary("");
    setAutomationMessage("");
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
        <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-400">Background research</h3>
        <p className="mt-1 text-xs text-neutral-500">Longer lookups run away from the speech path. Open a result for its evidence, sources, backend, and uncertainty.</p>
        <div className="mt-3 space-y-2">{research.slice().reverse().map((job) => (
          <details key={job.id} className="rounded-xl bg-white/5 p-3 text-sm">
            <summary className="cursor-pointer list-none">
              <span className="flex flex-wrap items-center justify-between gap-2"><strong>{job.query}</strong><span className="text-xs uppercase text-neutral-400">{job.status} · {job.uncertainty} uncertainty</span></span>
              {job.spoken_summary ? <span className="mt-1 block text-neutral-300">{job.spoken_summary}</span> : null}
              {job.error ? <span className="mt-1 block text-red-300">{job.error}</span> : null}
            </summary>
            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="text-xs text-neutral-500">Owner: {job.owner_id} · backend: {job.backend ?? "pending"} · job: {job.id}</p>
              {job.citations.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{job.citations.map((citation) => (
                <li key={citation}>{citation.startsWith("http") ? <a className="break-all text-cyan-300 underline" href={citation} target="_blank" rel="noreferrer">{citation}</a> : <span className="break-all">{citation}</span>}</li>
              ))}</ul> : <p className="mt-2 text-neutral-500">No citations available yet.</p>}
              {Object.keys(job.detail).length ? <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs text-neutral-300">{JSON.stringify(job.detail, null, 2)}</pre> : null}
            </div>
          </details>
        ))}{!research.length ? <p className="text-sm text-neutral-500">No background research jobs yet.</p> : null}</div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-400">Briefings</h3>
          <p className="mt-1 text-xs text-neutral-500">Schedules use their named timezone and generate restart-safe agenda, conflict, and preparation detail.</p>
          <div className="mt-2 space-y-2">{briefingSchedules.map((schedule) => (
            <div key={schedule.id} className="rounded-xl bg-white/5 p-3 text-sm"><strong>{schedule.period} at {schedule.local_time}</strong><p className="text-xs text-neutral-500">{schedule.timezone} · {schedule.enabled ? "enabled" : "disabled"} · last: {schedule.last_local_date ?? "never"}</p></div>
          ))}{briefings.slice().reverse().map((briefing) => (
            <details key={briefing.id} className="rounded-xl bg-white/5 p-3 text-sm"><summary className="cursor-pointer"><strong>{briefing.local_date} {briefing.period}</strong> — {briefing.summary}</summary><div className="mt-2 text-xs text-neutral-300"><p>{briefing.agenda.length} agenda item(s), {briefing.conflicts.length} conflict(s)</p>{briefing.preparation_prompts.map((prompt) => <p key={prompt}>{prompt}</p>)}</div></details>
          ))}{!briefingSchedules.length && !briefings.length ? <p className="text-sm text-neutral-500">No briefing schedules yet.</p> : null}</div>
        </div>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-400">Event subscriptions</h3>
          <p className="mt-1 text-xs text-neutral-500">“Tell me when” requests match the durable household event feed and record each trigger.</p>
          <div className="mt-2 space-y-2">{subscriptions.map((subscription) => (
            <div key={subscription.id} className="rounded-xl bg-white/5 p-3 text-sm"><div className="flex justify-between gap-2"><strong>{subscription.summary}</strong><span className="text-xs uppercase text-neutral-400">{subscription.active ? "active" : "inactive"}</span></div><p className="text-xs text-neutral-500">{subscription.event_kind} · {subscription.one_shot ? "one shot" : "recurring"} · triggered {subscription.trigger_count} time(s)</p><pre className="mt-1 whitespace-pre-wrap text-xs text-neutral-400">{JSON.stringify(subscription.match)}</pre></div>
          ))}{!subscriptions.length ? <p className="text-sm text-neutral-500">No event subscriptions yet.</p> : null}</div>
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

      <div className="mt-6">
        <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-400">Proactive home automations</h3>
        <p className="mt-1 text-xs text-neutral-500">Automations first simulate and require an assigned owner to approve and activate. Active rules produce reviewable voice, dashboard, or notification proposals; they do not silently control devices.</p>
        <div className="mt-3 grid gap-2 rounded-2xl bg-white/5 p-3 sm:grid-cols-2 xl:grid-cols-3">
          <select className="rounded-lg bg-neutral-900 p-2" value={automationOwnerId} onChange={(event) => setAutomationOwnerId(event.target.value)}>
            <option value="">Choose assigned owner</option>
            {administration?.identities.filter((identity) => identity.role === "owner").map((identity) => <option key={identity.person_id} value={identity.person_id}>{identity.person_id}</option>)}
          </select>
          <input className="rounded-lg bg-neutral-900 p-2" placeholder="Rule id, e.g. energy-watch" value={automationId} onChange={(event) => setAutomationId(event.target.value)} />
          <input className="rounded-lg bg-neutral-900 p-2" placeholder="What this rule does" value={automationSummary} onChange={(event) => setAutomationSummary(event.target.value)} />
          <select className="rounded-lg bg-neutral-900 p-2" value={automationEventKind} onChange={(event) => setAutomationEventKind(event.target.value)}>
            <option value="device_health">Device health event</option><option value="energy">Energy event</option><option value="occupancy">Occupancy event</option><option value="ha_state">Household state event</option>
          </select>
          <select className="rounded-lg bg-neutral-900 p-2" value={automationChannel} onChange={(event) => setAutomationChannel(event.target.value)}>
            <option value="dashboard">Dashboard proposal</option><option value="voice">Voice proposal</option><option value="notification">Notification proposal</option>
          </select>
          <input className="rounded-lg bg-neutral-900 p-2" placeholder="Optional concise message" value={automationMessage} onChange={(event) => setAutomationMessage(event.target.value)} />
          <button disabled={busy || !automationOwnerId || !automationId.trim() || !automationSummary.trim()} className="rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-black disabled:opacity-40" onClick={() => void run(createAutomation)}>Draft automation</button>
        </div>
        <div className="mt-3 space-y-2">{automations.map((automation) => (
          <div key={automation.id} className="rounded-xl bg-white/5 p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><strong>{automation.summary}</strong><span className="text-xs uppercase text-neutral-400">{automation.state}</span></div>
            <p className="mt-1 text-xs text-neutral-500">{automation.owner_id} · event: {String(automation.trigger.kind ?? "unknown")} · {automation.proposed_actions.length} proposal{automation.proposed_actions.length === 1 ? "" : "s"}</p>
            {automation.simulation ? <p className="mt-1 text-xs text-cyan-200">Simulation: {automation.simulation.safe === true ? "safe" : "needs review"}; {String(automation.simulation.proposedActionCount ?? 0)} proposed action(s).</p> : null}
            <div className="mt-2 flex flex-wrap gap-3">
              {automation.state === "draft" || automation.state === "simulated" ? <button disabled={busy} className="text-cyan-300" onClick={() => void run(() => automationAction({ action: "simulate", automationId: automation.id }))}>Simulate</button> : null}
              {automation.state === "simulated" ? <button disabled={busy} className="text-cyan-300" onClick={() => void run(() => automationAction({ action: "approve", automationId: automation.id, ownerId: automation.owner_id }))}>Approve</button> : null}
              {automation.state === "approved" ? <button disabled={busy} className="text-cyan-300" onClick={() => void run(() => automationAction({ action: "activate", automationId: automation.id, ownerId: automation.owner_id }))}>Activate</button> : null}
              {["active", "paused", "failed"].includes(automation.state) ? <button disabled={busy} className="text-red-300" onClick={() => void run(() => automationAction({ action: "rollback", automationId: automation.id, ownerId: automation.owner_id }))}>Roll back</button> : null}
            </div>
          </div>
        ))}{!automations.length ? <p className="text-sm text-neutral-500">No automation drafts yet.</p> : null}</div>
        <div className="mt-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-neutral-400">Proactive feedback</h4>
          <div className="mt-2 space-y-2">{interventions.map((intervention) => (
            <div key={intervention.id} className="rounded-xl bg-white/5 p-3 text-sm"><strong>{intervention.reason_detail}</strong><p className="text-xs text-neutral-500">{intervention.channel} · {intervention.status}{intervention.feedback ? ` · ${intervention.feedback}` : ""}</p>{!intervention.feedback ? <div className="mt-2 flex flex-wrap gap-3">{(["accepted", "dismissed", "redundant", "annoying"] as const).map((outcome) => <button key={outcome} disabled={busy || !automationOwnerId} className={outcome === "annoying" ? "text-red-300" : "text-cyan-300"} onClick={() => void run(() => automationAction({ action: "feedback", interventionId: intervention.id, ownerId: automationOwnerId, outcome }))}>{outcome}</button>)}</div> : null}</div>
          ))}{!interventions.length ? <p className="text-sm text-neutral-500">No proactive interventions recorded yet.</p> : null}</div>
        </div>
      </div>
    </section>
  );
}
