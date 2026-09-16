import { ClipboardList, RefreshCw, Upload, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { parseTaskCsv, type ParseTaskCsvResult } from "../../../lib/parse-task-csv";
import type { Task } from "../../../lib/types";
import { IMPORT_TEMPLATE } from "./constants";
import { classNames } from "./panel-model";
import { jsonFetch } from "./task-api";
import { timeRange } from "./task-model";
import type { IcloudStatus } from "./types";

export function ImportModal({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ParseTaskCsvResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<IcloudStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadIcloudStatus = useCallback(async () => {
    try {
      const payload = await jsonFetch<IcloudStatus>("/api/tasks/icloud-status", { cache: "no-store" });
      setStatus(payload);
      setStatusError(null);
    } catch (error) {
      setStatus(null);
      setStatusError(error instanceof Error ? error.message : "Failed to read iCloud status");
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadIcloudStatus();
  }, [loadIcloudStatus, open]);

  if (!open) {
    return null;
  }

  const parsePreview = () => {
    const result = parseTaskCsv(csv, new Date());
    setPreview(result);
    setMessage(`${result.tasks.length} valid row${result.tasks.length === 1 ? "" : "s"}`);
  };

  const confirmImport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const payload = await jsonFetch<{ created: Task[]; errors: ParseTaskCsvResult["errors"] }>("/api/tasks/bulk", {
        method: "POST",
        body: JSON.stringify({ csv, referenceDate: new Date().toISOString() }),
      });
      setPreview({ tasks: payload.created, errors: payload.errors });
      setMessage(`Imported ${payload.created.length} reminder${payload.created.length === 1 ? "" : "s"}`);
      if (!payload.errors.length) {
        setCsv("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const payload = await jsonFetch<{ status?: IcloudStatus; result?: { added: number; updated: number; removed: number } }>(
        "/api/tasks/sync-icloud",
        { method: "POST", body: "{}" },
      );
      if (payload.status) {
        setStatus(payload.status);
      } else {
        await loadIcloudStatus();
      }
      if (payload.result) {
        setMessage(
          `iCloud sync: ${payload.result.added} added, ${payload.result.updated} updated, ${payload.result.removed} removed`,
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "iCloud sync failed");
      await loadIcloudStatus();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-4">
      <div className="tasks-modal grid max-h-[92vh] w-full max-w-3xl gap-4 overflow-auto border border-neutral-700 bg-neutral-950 p-4 text-neutral-100">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black uppercase">Import reminders</h2>
            <p className="font-mono text-xs font-black uppercase text-neutral-500">start,end,name,repeat</p>
          </div>
          <button
            className="inline-flex h-11 w-11 items-center justify-center border border-neutral-700"
            type="button"
            onClick={onClose}
            aria-label="Close import"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <section className="grid gap-3 border border-neutral-700 bg-neutral-950/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black uppercase text-cyan-100">iCloud</h3>
              <p className="font-mono text-xs font-black uppercase text-neutral-500">
                {status?.enabled ? "Calendar and reminders mirror" : "Local-only mode"}
              </p>
            </div>
            <button
              className="inline-flex min-h-10 items-center gap-2 border border-cyan-300/60 px-3 py-2 text-xs font-black"
              type="button"
              onClick={() => void syncNow()}
              disabled={syncing || !status?.enabled}
            >
              <RefreshCw className={classNames("h-4 w-4", syncing && "animate-spin")} />
              Sync now
            </button>
          </div>
          {statusError ? <p className="text-sm font-black uppercase text-red-400">{statusError}</p> : null}
          {status ? (
            <div className="grid gap-1 font-mono text-xs font-black uppercase text-neutral-400">
              <span>Last sync: {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "Never"}</span>
              <span>Calendars: {status.calendars.length ? status.calendars.join(", ") : "None"}</span>
              <span>Reminder lists: {status.reminders.length ? status.reminders.join(", ") : "None"}</span>
              {status.lastError ? <span className="text-red-400">Error: {status.lastError}</span> : null}
            </div>
          ) : null}
        </section>

        <section className="grid gap-2 border border-neutral-700 bg-neutral-950/70 p-3">
          <h3 className="text-sm font-black uppercase text-cyan-100">Template</h3>
          <pre className="select-text whitespace-pre-wrap font-mono text-xs font-black uppercase text-neutral-300">
            {IMPORT_TEMPLATE}
          </pre>
        </section>

        <textarea
          className="min-h-48 w-full resize-y border border-neutral-700 bg-neutral-950/70 p-3 font-mono text-sm text-neutral-100 outline-none focus:border-cyan-300"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          placeholder={IMPORT_TEMPLATE}
          spellCheck={false}
        />

        <div className="flex flex-wrap justify-between gap-2">
          <button
            className="inline-flex min-h-11 items-center gap-2 border border-neutral-700 px-4 py-2 text-sm font-black"
            type="button"
            onClick={parsePreview}
          >
            <ClipboardList className="h-4 w-4" />
            Parse
          </button>
          <button
            className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100"
            type="button"
            onClick={() => void confirmImport()}
            disabled={busy || !preview?.tasks.length}
          >
            <Upload className="h-4 w-4" />
            {busy ? "Importing" : "Confirm import"}
          </button>
        </div>

        {message ? <p className="font-mono text-sm font-black uppercase text-cyan-100">{message}</p> : null}

        {preview ? (
          <div className="grid gap-2">
            {preview.errors.map((error) => (
              <div
                key={`${error.line}-${error.message}`}
                className="border border-red-400/60 bg-red-500/10 p-2 font-mono text-sm font-black uppercase text-red-100"
              >
                Line {error.line}: {error.message}
              </div>
            ))}
            {preview.tasks.map((task) => (
              <div
                key={task.id}
                className="grid gap-1 border border-neutral-700 bg-neutral-950/70 p-2 font-mono text-sm font-black uppercase"
              >
                <span className="text-neutral-100">{task.name}</span>
                <span className="text-neutral-500">{timeRange(task)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
