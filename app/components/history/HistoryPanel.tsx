"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { TreeRow } from "./TreeRow";
import type { RevisionSummary, TreeNode } from "./types";

function when(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Preference history: every revert point, and a way back to any part of the
 * configuration as it stood at one.
 *
 * A revision is a minute, not a save, so a burst of edits is one entry the user
 * can recognise rather than thirty they cannot.
 *
 * One Restore button, one meaning: a row is the configuration as it stood once
 * that minute's changes had been made. Offering "before this" and "after this"
 * side by side made every row two subtly different propositions and asked the
 * user to hold the distinction in their head. It bought nothing, either — the
 * state before a change is the state after the change preceding it, so every
 * point in time is still reachable, just by picking the row below.
 */
export function HistoryPanel() {
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRevisions = useCallback(async () => {
    try {
      const response = await fetch("/api/preferences/history", { cache: "no-store" });
      const body = await response.json() as { revisions?: RevisionSummary[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Failed to load history");
      setRevisions(body.revisions ?? []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load history");
    }
  }, []);

  useEffect(() => { void loadRevisions(); }, [loadRevisions]);

  const openRevision = useCallback(async (id: string) => {
    setBusy(true);
    setStatus(null);
    try {
      // Always the state as it stood once this minute's changes had been made.
      // One reading, so a row means one thing: undoing a change is picking the
      // row below it, which is the same list read one step further back.
      const response = await fetch(
        `/api/preferences/history?revision=${encodeURIComponent(id)}&before=0`,
        { cache: "no-store" });
      const body = await response.json() as { tree?: TreeNode[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Failed to read that revision");
      setTree(body.tree ?? []);
      setOpenId(id);
      setSelected(new Set());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to read that revision");
    } finally {
      setBusy(false);
    }
  }, []);

  const toggle = useCallback((pointer: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(pointer);
        // A parent covers its children, so keep the selection minimal and
        // honest about what is actually being restored.
        for (const entry of [...next]) {
          if (entry !== pointer && entry.startsWith(`${pointer}/`)) next.delete(entry);
        }
      } else {
        next.delete(pointer);
      }
      return next;
    });
  }, []);

  const restore = useCallback(async () => {
    if (!openId || !selected.size) return;
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/preferences/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: openId, before: false, paths: [...selected] }),
      });
      const body = await response.json() as { restored?: string[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Restore failed");
      setStatus(`Restored ${body.restored?.length ?? 0} part(s) as at ${when(`${openId}:00Z`)}.`);
      setSelected(new Set());
      await loadRevisions();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }, [loadRevisions, openId, selected]);

  return (
    <div className="grid gap-3">
        <p className="text-xs text-neutral-500">
          Every change to the dashboard is kept as a running diff. Changes are grouped by the
          minute, so a burst of edits is one revert point. Restoring a moment gives you the
          configuration as it stood once that minute&rsquo;s changes had been made — so to undo
          something, restore the moment just below it. You can pick any part of the configuration,
          including parts that did not change then and things that were later deleted.
        </p>

        {status ? <p className="text-xs text-cyan-300">{status}</p> : null}

        {!revisions.length ? (
          <p className="text-sm text-neutral-500">
            No changes recorded yet. The next edit you make will appear here.
          </p>
        ) : null}

        <div className="grid gap-2">
          {revisions.map((revision) => (
            <div key={revision.id} className="border border-neutral-800 bg-neutral-950/40">
              <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="text-sm text-neutral-200">{when(revision.at)}</div>
                  <div className="text-xs text-neutral-500">
                    {revision.summary}
                    {revision.changes > 1 ? ` · ${revision.changes} saves this minute` : null}
                  </div>
                </div>
                <MomentaryFeedbackButton
                  type="button"
                  className="config-page-button"
                  disabled={busy}
                  onClick={() => void openRevision(revision.id)}
                >
                  <RotateCcw className="h-4 w-4" />
                  Restore
                </MomentaryFeedbackButton>
              </div>

              {openId === revision.id ? (
                <div className="grid gap-2 border-t border-neutral-800 p-3">
                  <p className="text-xs font-black uppercase text-neutral-400">
                    Configuration as it stood at {when(revision.at)}
                  </p>
                  <p className="text-xs text-neutral-500">
                    Tick the parts to restore. A ticked branch covers everything inside it.
                    <span className="ml-1 inline-flex items-center gap-1 text-cyan-300">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                      marks what this revision changed.
                    </span>
                  </p>
                  <div className="grid max-h-96 gap-1 overflow-y-auto pr-1">
                    {tree.map((node) => (
                      <TreeRow
                        key={node.pointer}
                        covered={false}
                        depth={0}
                        node={node}
                        onToggle={toggle}
                        selected={selected}
                      />
                    ))}
                  </div>
                  <MomentaryFeedbackButton
                    type="button"
                    className="config-page-button justify-center"
                    disabled={busy || !selected.size}
                    onClick={() => void restore()}
                  >
                    <RotateCcw className="h-5 w-5" />
                    {selected.size
                      ? `Restore ${selected.size} selected part${selected.size === 1 ? "" : "s"}`
                      : "Select something to restore"}
                  </MomentaryFeedbackButton>
                  <p className="text-xs text-neutral-500">
                    The restore is itself recorded, so you can undo it from here too.
                  </p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
    </div>
  );
}
