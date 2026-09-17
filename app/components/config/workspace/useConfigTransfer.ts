"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { SecretSetupStatus } from "../../../../lib/config-schema";
import { loadSharedConfig, readSharedConfigCache, saveSharedConfig } from "../../sharedConfigCache";
import { setupRows } from "./system-data-model";

// The shared-config load plus the import/export state behind the System & Data
// category. `load` is deliberately not called here: the workspace defers it
// until that category is first opened.
export function useConfigTransfer() {
  const [config, setConfig] = useState<unknown>(null);
  const [secrets, setSecrets] = useState<SecretSetupStatus | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rows = useMemo(() => setupRows(secrets), [secrets]);

  const load = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const cached = readSharedConfigCache();
    if (cached?.config !== undefined) {
      setConfig(cached.config);
      setSecrets(cached.secrets);
    }
    try {
      const payload = await loadSharedConfig();
      setConfig(payload.config ?? null);
      setSecrets(payload.secrets);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load config");
    } finally {
      setBusy(false);
    }
  }, []);

  const applyImportedConfig = async (nextConfig: unknown) => {
    setBusy(true);
    setMessage(null);
    try {
      const payload = await saveSharedConfig(nextConfig);
      if (!payload.ok) {
        setMessage("Config import failed.");
        return;
      }
      setMessage("Config imported.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Config import failed");
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File | null) => {
    if (!file) {
      return;
    }
    try {
      await applyImportedConfig(JSON.parse(await file.text()));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Config import failed");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return { busy, config, fileInputRef, importFile, load, message, rows };
}
