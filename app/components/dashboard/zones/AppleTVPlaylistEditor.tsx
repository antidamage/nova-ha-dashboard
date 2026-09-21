"use client";

/**
 * The Apple TV's preset playlists, edited in the zone's Advanced section
 * (Adeline, 2026-09-22).
 *
 * The amplifier dial's preset buttons play one Apple Music playlist each, and
 * this is where the list is defined. It is typed in rather than picked: the
 * Apple TV exposes no playlist list to the dashboard yet — and therefore no
 * favourites either — so a drop-down would be a list of nothing. When an
 * endpoint that can read the library and the favourites lands, this becomes a
 * `ConfigSelect` over it and the free-text rows go.
 *
 * Saved as a whole list on commit (blur or Enter, and on add or remove), so a
 * half-typed name is never stored.
 */
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MAX_PLAYLISTS } from "../../../../lib/apple-tv/playlists";
import { IconButton } from "../IconButton";
import { useAppleTVAmp } from "../appleTVAmpClient";

export function AppleTVPlaylistEditor() {
  const amp = useAppleTVAmp();
  const [draft, setDraft] = useState<string[]>(amp.playlists);
  const focused = useRef(false);
  const [dirty, setDirty] = useState<number | null>(null);

  // The store's answer replaces the draft — but never under a focused field, or
  // a save's reply would rewrite the name mid-edit.
  useEffect(() => {
    if (!focused.current) setDraft(amp.playlists);
  }, [amp.playlists]);

  const commit = (index: number) => {
    const name = (draft[index] ?? "").trim();
    setDirty(null);
    if (name === (amp.playlists[index] ?? "").trim()) return;
    amp.renamePlaylist(index, name);
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

  return (
    <section className="advanced-fold-row apple-tv-playlists" aria-label="Apple TV preset playlists">
      <header className="apple-tv-playlists-header">
        <h2 className="apple-tv-playlists-title">Apple TV playlists</h2>
        <p className="apple-tv-playlists-hint">
          One preset button per playlist, in this order. Typed in: the Apple TV exposes no playlist
          or favourites list to the dashboard yet.
        </p>
      </header>
      <div className="apple-tv-playlists-rows">
        {draft.map((name, index) => (
          <div className="apple-tv-playlist-row" key={index}>
            <input
              aria-label={`Playlist ${index + 1}`}
              className="apple-tv-playlist-input"
              placeholder="Playlist name"
              value={name}
              onBlur={() => { focused.current = false; commit(index); }}
              onChange={(event) => {
                setDirty(index);
                setDraft((current) => current.map((entry, at) => (at === index ? event.target.value : entry)));
              }}
              onFocus={() => { focused.current = true; }}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.currentTarget.blur(); }
              }}
            />
            <div className="apple-tv-playlist-actions">
              <IconButton label={`Move ${name || `playlist ${index + 1}`} up`} variant="white" onClick={() => move(index, -1)}>
                <ArrowUp aria-hidden="true" className="h-5 w-5" />
              </IconButton>
              <IconButton label={`Move ${name || `playlist ${index + 1}`} down`} variant="white" onClick={() => move(index, 1)}>
                <ArrowDown aria-hidden="true" className="h-5 w-5" />
              </IconButton>
              <IconButton label={`Remove ${name || `playlist ${index + 1}`}`} variant="pink" onClick={() => amp.removePlaylist(index)}>
                <Trash2 aria-hidden="true" className="h-5 w-5" />
              </IconButton>
            </div>
          </div>
        ))}
        {draft.length ? null : <p className="apple-tv-playlists-hint">No playlists: the dial shows no preset buttons.</p>}
      </div>
      <div className="apple-tv-playlists-footer">
        <IconButton
          label="Add playlist"
          disabled={draft.length >= MAX_PLAYLISTS || amp.saving}
          onClick={() => amp.addPlaylist("New playlist")}
        >
          <Plus aria-hidden="true" className="h-5 w-5" /><span>Add playlist</span>
        </IconButton>
        <span className="apple-tv-playlists-count">
          {draft.length} of {MAX_PLAYLISTS}
          {dirty !== null ? " · unsaved" : ""}
          {amp.saving ? " · saving" : ""}
        </span>
      </div>
      {amp.error ? <p className="apple-tv-playlists-error" role="alert">{amp.error}</p> : null}
    </section>
  );
}
