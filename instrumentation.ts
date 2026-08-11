// NOTE: the dynamic imports below use the `@/` root alias, not relative paths.
// Turbopack inlines this module into each App Route's server bundle and then
// resolves relative specifiers against *the route's* directory, so `./lib/...`
// produced "Module not found" build warnings and left the update scheduler,
// voice bridge, and camera recorders dead at boot. The alias resolves from the
// project root in every bundling context.
export async function register() {
  // Only run in the Node.js server runtime (not edge, not during build).
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  // Demo mode ships as a static export with no server, so these background
  // services never run there. When a server-backed demo is used (e.g. the E2E
  // harness running `next dev` in demo mode) skip them too: there is no Home
  // Assistant, camera device, or release channel to talk to.
  if (process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true") {
    return;
  }
  const { startUpdateScheduler } = await import("@/lib/update-scheduler");
  startUpdateScheduler();

  // One server authority owns both thermostats, command correlation, external
  // overrides, schedules, sensor grace, and hardware dwell.
  try {
    const { startClimateControl } = await import("@/lib/climate-control");
    startClimateControl();
  } catch (error) {
    console.error("[climate-control] failed to start", error);
  }

  // Browser voice-satellite bridge (mTLS relay to Iridium). No-op until a
  // dashboard server certificate is configured, so it stays inert on HTTP.
  try {
    const { startVoiceSatelliteBridge } = await import("@/lib/voice-satellite-bridge");
    await startVoiceSatelliteBridge();
  } catch (error) {
    console.error("[voice-bridge] failed to start", error);
  }

  // Start camera DVR recorders at boot so the rolling two-hour window begins
  // buffering immediately, rather than only when someone opens the panel.
  // The recorders pause while the host updater runs (the encoder and the
  // on-box release build fight over the same cores) and resume afterwards —
  // including at this boot, which during an update lands mid "verifying".
  try {
    const { CAMERAS } = await import("@/lib/camera/config");
    const { ensureRecorder } = await import("@/lib/camera/recorder");
    const { startCameraUpdatePauseWatcher } = await import("@/lib/camera/update-pause");
    const { updaterBusy } = await import("@/lib/update");
    startCameraUpdatePauseWatcher();
    if (await updaterBusy()) {
      console.log("[camera] updater is running; recorders will start once it finishes");
    } else {
      for (const camera of CAMERAS) {
        await ensureRecorder(camera);
      }
    }
  } catch (error) {
    console.error("[camera] failed to start recorders", error);
  }
}
