"use client";

import { SwitchRow } from "../../SlideSwitch";
import type { Config } from "./types";

/**
 * The beat, analysis and lyrics sources, plus the ambient status overlay.
 * Split out of `PhonoscopeConfig.tsx` (specs/agent-token-footprint.md §4).
 */
export function ProviderSwitches({
  config,
  save,
}: {
  config: Config;
  save: (next: Config, options?: { quiet?: boolean }) => Promise<void>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <SwitchRow checked={config.providers.spotify} label="Spotify beat timestamps" detail="Use Spotify timing when available"
        onChange={(spotify) => void save({ ...config, providers: { ...config.providers, spotify } })} />
      <SwitchRow checked={config.providers.songle} label="Songle beat timestamps" detail="Use Songle timing when available"
        onChange={(songle) => void save({ ...config, providers: { ...config.providers, songle } })} />
      <SwitchRow checked={config.providers.essentia} label="Local Essentia analysis" detail="Analyse tracks locally"
        onChange={(essentia) => void save({ ...config, providers: { ...config.providers, essentia } })} />
      <SwitchRow checked={config.providers.reccoBeats} label="ReccoBeats BPM fallback" detail="Use BPM metadata as a fallback"
        onChange={(reccoBeats) => void save({ ...config, providers: { ...config.providers, reccoBeats } })} />
      <SwitchRow checked={config.providers.lrclib} label="Timed lyrics" detail="Resolve synchronized lyrics"
        onChange={(lrclib) => void save({ ...config, providers: { ...config.providers, lrclib } })} />
      <SwitchRow checked={config.statusOverlay} label="Ambient status" detail="Show music information over the visualiser"
        onChange={(statusOverlay) => void save({ ...config, statusOverlay })} />
    </div>
  );
}
