"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePhonoscopeEditingLock } from "../../phonoscope/editing-lock";
import type { Config, ModuleSummary, Payload } from "./types";

/**
 * The Phonoscope config panel's state: the config and module list, and the
 * load / save / preview / commit boundary plus the module package actions.
 * Split out of `PhonoscopeConfig.tsx` (specs/agent-token-footprint.md §4).
 */
export function usePhonoscopeConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  // Held while a name field has focus. Nothing that arrives from the server may
  // replace `config` while it is: the reply describes the name as it was when
  // the request left, and applying it takes the letters typed since back out of
  // the input. See phonoscope/editing-lock.tsx.
  const { value: editingLock, isEditing } = usePhonoscopeEditingLock();

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/phonoscope/config", { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error ?? "Failed to load Phonoscope");
      // The module list is not edited here, so it is always safe to take.
      setModules(payload.modules);
      if (isEditing()) return;
      setConfig(payload.config);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load Phonoscope");
    } finally {
      setBusy(false);
    }
  }, [isEditing]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (next: Config, { quiet = false }: { quiet?: boolean } = {}) => {
    setConfig(next);
    if (!quiet) {
      setBusy(true);
      setMessage(null);
    }
    try {
      const response = await fetch("/api/phonoscope/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const payload = await response.json() as { config?: Config; error?: string };
      if (!response.ok || !payload.config) throw new Error(payload.error ?? "Failed to save Phonoscope");
      // The echo is the server's normalised copy of what was sent, so it is
      // authoritative — except over a field someone is still typing into, where
      // it is a stale snapshot of that field and applying it would undo the
      // keystrokes that happened during the round trip. The blur that ends the
      // edit commits, and that reply lands with the lock free.
      if (!isEditing()) setConfig(payload.config);
      // No "saved" banner: settings commit on every slider release, and the
      // status line sits above the controls, so showing then clearing it shifts
      // the page out from under the gesture. Only failures are announced.
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save Phonoscope");
      await load();
    } finally {
      if (!quiet) setBusy(false);
    }
  }, [load, isEditing]);

  /**
   * A preview sample. Local state only — this must not touch the network.
   *
   * Dot controls emit one of these per pointer move, and they used to be
   * coalesced to a 75ms cadence and POSTed for the whole duration of a drag.
   * Every reply re-rendered the panel from the server's echo and rebroadcast to
   * the renderer, so a single drag was dozens of saves and the thumb visibly
   * lagged the finger holding it. `ConfigControls` has always stated the
   * contract — preview is local UI state, commit is the one persistence
   * boundary — and this is that contract actually kept.
   *
   * The consequence, accepted deliberately: the renderer follows on release
   * rather than live under the thumb. A live preview, if it is wanted back,
   * belongs on a lightweight renderer-only channel, not a whole-config POST.
   */
  const preview = useCallback((next: Config) => {
    setConfig(next);
  }, []);

  const commit = useCallback((next: Config) => {
    saveChain.current = saveChain.current
      .catch(() => undefined)
      .then(async () => { await save(next, { quiet: true }); });
  }, [save]);

  const activeModule = useMemo(
    () => modules.find((module) =>
      module.id === config?.activeModuleId && module.version === config?.activeModuleVersion),
    [config, modules],
  );

  const uploadPackage = useCallback(async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/phonoscope/modules", { method: "POST", body: file });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Upload failed");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [load]);

  const removeModule = useCallback(async (module: ModuleSummary) => {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/phonoscope/modules/${encodeURIComponent(module.id)}/${encodeURIComponent(module.version)}`,
        { method: "DELETE" },
      );
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Delete failed");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }, [load]);

  const loadDiagnostics = useCallback(async () => {
    try {
      const response = await fetch("/api/phonoscope/diagnostics", { cache: "no-store" });
      setDiagnostics(JSON.stringify(await response.json(), null, 2));
    } catch (error) {
      setDiagnostics(error instanceof Error ? error.message : "Diagnostics failed");
    }
  }, []);

  return {
    config, setConfig, modules, busy, message, diagnostics, fileRef,
    editingLock, load, save, preview, commit, activeModule,
    uploadPackage, removeModule, loadDiagnostics,
  };
}
