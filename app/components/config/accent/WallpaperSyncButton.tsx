"use client";

import { UploadCloud } from "lucide-react";
import { useState } from "react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { flushPendingSharedThemeWrite } from "../../accentColor";
import { applyManagedDesktopWallpapers } from "../../managed-computers-client";

/**
 * Push the theme's current wallpaper to every subscribed device now. Same
 * force-sync the Managed Computers panel's Apply action runs, surfaced here so
 * a wallpaper can be re-sent from the page where it was chosen — a desktop
 * whose wallpaper drifted (a manual change, a re-image, a failed earlier push)
 * is repaired without hunting for the other panel.
 */
export function WallpaperSyncButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pushNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      // The sync reads the wallpaper from the theme the *server* holds, and
      // theme edits are debounced, so a selection made a moment ago has to
      // land before the push fires or the previous wallpaper goes out.
      await flushPendingSharedThemeWrite();
      const results = await applyManagedDesktopWallpapers();
      const failed = results.filter((result) => !result.ok);
      if (failed.length) {
        setMessage(failed.map((result) => `${result.name}: ${result.error}`).join(" / "));
      } else if (results.length) {
        setMessage(`Wallpaper pushed to ${results.map((result) => result.name).join(", ")}`);
      } else {
        setMessage("No subscribed devices");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to push the wallpaper");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2">
      <MomentaryFeedbackButton
        className="inline-flex min-h-11 items-center justify-center gap-2 border border-cyan-300/60 px-4 py-2 text-sm font-black uppercase"
        type="button"
        disabled={busy}
        onClick={() => void pushNow()}
      >
        <UploadCloud className="h-4 w-4" />
        {busy ? "Pushing" : "Push Wallpaper To Devices"}
      </MomentaryFeedbackButton>
      {message ? <p className="text-xs font-semibold text-cyan-100">{message}</p> : null}
    </div>
  );
}
