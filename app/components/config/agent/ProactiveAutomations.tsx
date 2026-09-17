"use client";

import { automationAction } from "./administration-client";
import type { AgentAdministrationState } from "./useAgentAdministration";

// Proactive home automations: the draft form, the lifecycle list and feedback.
export function ProactiveAutomations(
  {
    administration, automationChannel, automationEventKind, automationId, automationMessage,
    automationOwnerId, automationSummary, automations, busy, createAutomation, interventions, run,
    setAutomationChannel, setAutomationEventKind, setAutomationId, setAutomationMessage,
    setAutomationOwnerId, setAutomationSummary,
  }: Pick<AgentAdministrationState,
    "administration" | "automationChannel" | "automationEventKind" | "automationId" |
    "automationMessage" | "automationOwnerId" | "automationSummary" | "automations" | "busy" |
    "createAutomation" | "interventions" | "run" | "setAutomationChannel" |
    "setAutomationEventKind" | "setAutomationId" | "setAutomationMessage" | "setAutomationOwnerId" |
    "setAutomationSummary"
  >,
) {
  return (
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
  );
}
