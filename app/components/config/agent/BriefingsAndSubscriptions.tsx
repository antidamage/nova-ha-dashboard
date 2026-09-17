"use client";

import type { AgentAdministrationState } from "./useAgentAdministration";

// Briefing schedules, generated briefings and event subscriptions.
export function BriefingsAndSubscriptions(
  {
    briefingSchedules, briefings, subscriptions,
  }: Pick<AgentAdministrationState,
    "briefingSchedules" | "briefings" | "subscriptions"
  >,
) {
  return (
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
  );
}
