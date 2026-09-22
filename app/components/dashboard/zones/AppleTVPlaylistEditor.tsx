"use client";

/**
 * The Apple TV's preset playlists, edited in the zone's Advanced section
 * (Adeline, 2026-09-22).
 *
 * The amplifier dial's preset buttons play one Apple Music playlist each, and
 * this is where each is defined: its name, the icon its button wears, and how
 * it should be played. It is typed in rather than picked: the Apple TV exposes
 * no playlist list to the dashboard yet — and therefore no favourites either —
 * so a drop-down would be a list of nothing. When an endpoint that can read the
 * library and the favourites lands, this becomes a `ConfigSelect` over it and
 * the free-text rows go.
 *
 * Saved as a whole list on commit (blur or Enter, and on add or remove), so a
 * half-typed name is never stored. The icon and the playback type are choices
 * rather than typing, so they save the moment they are made.
 */
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MAX_PLAYLISTS, cleanPlaylistName, type AppleTVPlaylist } from "../../../../lib/apple-tv/playlists";
import { IconButton } from "../IconButton";
import { useAppleTVAmp } from "../appleTVAmpClient";
import { PresetIconMark } from "../appleTVPresetIcon";
import { AppleTVPresetIconPicker } from "../appleTVPresetIconPicker";
import { AppleTVPlaybackControls } from "./AppleTVPlaybackControls";

export function AppleTVPlaylistEditor() {
  const amp = useAppleTVAmp();
  const [draft, setDraft] = useState<AppleTVPlaylist[]>(amp.playlists);
  const focused = useRef(false);
  const [dirty, setDirty] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The row whose icon is being chosen, or null for none. */
  const [iconIndex, setIconIndex] = useState<number | null>(null);

  // The store's answer replaces the draft — but never under a focused field, or
  // a save's reply would rewrite the name mid-edit.
  useEffect(() => {
    if (!focused.current) setDraft(amp.playlists);
  }, [amp.playlists]);

  const nameOf = (playlist: AppleTVPlaylist | undefined) => (playlist?.name ?? "").trim();

  /**
   * Commit one row's name.
   *
   * A name another row already carries is refused rather than saved, and the
   * comparison is made on `cleanPlaylistName` — the same normalisation the list
   * itself de-duplicates with. Comparing the raw strings instead would let a
   * double-spaced or over-long paste through the guard and straight into the
   * drop: the other row would vanish with no message, which is the defect this
   * guard exists to prevent.
   *
   * An emptied row is a removal: the list stores no blanks, so letting it save
   * would drop the row on the way in anyway — this just says so.
   */
  const commit = (index: number) => {
    const name = nameOf(draft[index]);
    setDirty(null);
    setError(null);
    if (name === nameOf(amp.playlists[index])) return;
    const key = cleanPlaylistName(name).toLowerCase();
    if (!key) {
      amp.removePlaylist(index);
      return;
    }
    const duplicate = draft.some((entry, at) => at !== index && cleanPlaylistName(entry.name).toLowerCase() === key);
    if (duplicate) {
      setError(`"${name}" is already in the list`);
      setDraft(amp.playlists);
      return;
    }
    amp.renamePlaylist(index, name);
  };

  /**
   * The name a new row starts with, unique among the rows on screen: two adds in
   * a row would otherwise both be "New playlist", and the list drops the
   * duplicate on the way in — the second click would look like it did nothing.
   */
  const newName = () => {
    const taken = new Set(draft.map((entry) => entry.name.trim().toLowerCase()));
    if (!taken.has("new playlist")) return "New playlist";
    for (let index = 2; index <= MAX_PLAYLISTS + 1; index += 1) {
      const candidate = `New playlist ${index}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `New playlist ${Math.round(performance.now())}`;
  };

  /** One save for the whole list, whichever way it changed. */
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next);
    amp.setPlaylists(next);
  };

  // The row whose icon is open, read from the store rather than the draft: an
  // icon is a choice, so it cannot be half-typed, and a row removed under an
  // open picker takes the picker with it.
  const iconTarget = iconIndex === null ? null : amp.playlists[iconIndex] ?? null;

  return (
    <section className="advanced-fold-row apple-tv-playlists" aria-label="Apple TV preset playlists">
      <header className="apple-tv-playlists-header">
        <h2 className="apple-tv-playlists-title">Apple TV playlists</h2>
        <p className="apple-tv-playlists-hint">
          One preset button per playlist, in this order: each with its own icon, and its own way of playing.
          Typed in: the Apple TV exposes no playlist or favourites list to the dashboard yet.
        </p>
      </header>
      <div className="apple-tv-playlists-rows">
        {draft.map((playlist, index) => {
          const name = playlist.name || `playlist ${index + 1}`;
          return (
            <div className="apple-tv-playlist-row" key={index}>
              <div className="apple-tv-playlist-main">
                <span className="apple-tv-playlist-icon" data-preset-icon={playlist.icon ?? "note"}>
                  <IconButton
                    label={`Icon for ${name}`}
                    variant="white"
                    demoTooltip={{ title: "Icon", text: "Choose the icon this preset button wears." }}
                    onClick={() => setIconIndex(index)}
                  >
                    <PresetIconMark className="h-5 w-5" icon={playlist.icon} />
                  </IconButton>
                </span>
                <input
                  aria-label={`Playlist ${index + 1}`}
                  className="apple-tv-playlist-input"
                  placeholder="Playlist name"
                  value={playlist.name}
                  onBlur={() => { focused.current = false; commit(index); }}
                  onChange={(event) => {
                    setDirty(index);
                    setDraft((current) => current.map((entry, at) => (at === index ? { ...entry, name: event.target.value } : entry)));
                  }}
                  onFocus={() => { focused.current = true; }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.currentTarget.blur(); }
                  }}
                />
                <div className="apple-tv-playlist-actions">
                  <IconButton label={`Move ${name} up`} variant="white" onClick={() => move(index, -1)}>
                    <ArrowUp aria-hidden="true" className="h-5 w-5" />
                  </IconButton>
                  <IconButton label={`Move ${name} down`} variant="white" onClick={() => move(index, 1)}>
                    <ArrowDown aria-hidden="true" className="h-5 w-5" />
                  </IconButton>
                  <IconButton label={`Remove ${name}`} variant="pink" onClick={() => amp.removePlaylist(index)}>
                    <Trash2 aria-hidden="true" className="h-5 w-5" />
                  </IconButton>
                </div>
              </div>
              <AppleTVPlaybackControls
                index={index}
                playlist={playlist}
                onChange={(patch) => amp.updatePreset(index, patch)}
              />
            </div>
          );
        })}
        {draft.length ? null : <p className="apple-tv-playlists-hint">No playlists: the dial shows no preset buttons.</p>}
      </div>
      <div className="apple-tv-playlists-footer">
        <IconButton
          label="Add playlist"
          disabled={draft.length >= MAX_PLAYLISTS || amp.saving}
          onClick={() => amp.addPlaylist(newName())}
        >
          <Plus aria-hidden="true" className="h-5 w-5" /><span>Add playlist</span>
        </IconButton>
        <span className="apple-tv-playlists-count">
          {draft.length} of {MAX_PLAYLISTS}
          {dirty !== null ? " · unsaved" : ""}
          {amp.saving ? " · saving" : ""}
        </span>
      </div>
      {(error ?? amp.error)
        ? <p className="apple-tv-playlists-error" role="alert">{error ?? amp.error}</p>
        : null}
      {iconTarget ? (
        <AppleTVPresetIconPicker
          icon={iconTarget.icon}
          name={iconTarget.name || `playlist ${(iconIndex ?? 0) + 1}`}
          open
          onClose={() => setIconIndex(null)}
          onSelect={(icon) => {
            amp.updatePreset(iconIndex as number, { icon });
            setIconIndex(null);
          }}
        />
      ) : null}
    </section>
  );
}
