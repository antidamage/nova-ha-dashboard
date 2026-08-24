"use client";

import { useCallback, useEffect, useState } from "react";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";

type SecretStatus = {
  configured: boolean;
  preview: string | null;
};

/**
 * The one secret set from the config page rather than the host environment.
 *
 * Nova cannot push to iOS, so a theme change posts to this webhook and the
 * notification it raises runs a Shortcut that fetches the new wallpaper. The
 * stored URL is never sent back to the browser in full - the field shows a
 * shortened preview of what is set, and typing a new value replaces it.
 */
export function ThemeChangeNotificationSecret() {
  const [status, setStatus] = useState<SecretStatus | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/config/secrets", { cache: "no-store" });
      const payload = await response.json() as { themeChangeNotificationUrl?: SecretStatus; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to read secrets");
      }
      setStatus(payload.themeChangeNotificationUrl ?? { configured: false, preview: null });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to read secrets");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (nextValue: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/config/secrets", {
        body: JSON.stringify({ themeChangeNotificationUrl: nextValue }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json() as { themeChangeNotificationUrl?: SecretStatus; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save");
      }
      setStatus(payload.themeChangeNotificationUrl ?? { configured: false, preview: null });
      setValue("");
      setMessage(nextValue ? "Saved" : "Cleared");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="grid gap-2 border-b border-neutral-800 pb-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div>
          <p className="font-black uppercase text-neutral-100">Theme change notification URL</p>
          <p className="font-mono text-xs text-neutral-500">
            {status?.preview ?? "not set"}
          </p>
        </div>
        <span className={status?.configured ? "text-cyan-200" : "text-neutral-500"}>
          {status?.configured ? "set" : "optional"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Theme change notification URL"
          className="cyber-text-input min-w-0 flex-1"
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          placeholder="https://…"
          type="url"
          value={value}
        />
        <MomentaryFeedbackButton
          className="config-page-button"
          disabled={busy || !value.trim()}
          onClick={() => void save(value.trim())}
          type="button"
        >
          Save
        </MomentaryFeedbackButton>
        <MomentaryFeedbackButton
          className="config-page-button"
          disabled={busy || !status?.configured}
          onClick={() => void save("")}
          type="button"
        >
          Clear
        </MomentaryFeedbackButton>
      </div>
      {message ? <p className="text-xs font-semibold text-neutral-300">{message}</p> : null}
    </div>
  );
}
