"use client";

import type { AgentAdministrationState } from "./useAgentAdministration";

// Background research jobs with their evidence and citations.
export function ResearchJobs(
  {
    research,
  }: Pick<AgentAdministrationState,
    "research"
  >,
) {
  return (
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
  );
}
