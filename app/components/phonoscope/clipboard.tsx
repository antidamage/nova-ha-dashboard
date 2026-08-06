"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  PhonoscopeColorGroup,
  PhonoscopeColorGroupEntry,
  PhonoscopeColorTheme,
  PhonoscopeDriverLane,
  PhonoscopeEffectBinding,
  PhonoscopeSettingsGroup,
} from "../../../lib/types";

/**
 * A one-slot clipboard for the Visualiser controls hierarchy.
 *
 * Duplicate covers "another one of these, here". Copy/paste is the part that
 * duplicate cannot do: lifting a lane out of one settings group and dropping it
 * into another, or a playlist entry into a different colour theme group.
 *
 * Everything is deep-cloned on the way in *and* on the way out, so pasting the
 * same clipboard item twice yields two independent copies rather than two
 * references to one object.
 */
export type PhonoscopeClipboardKind =
  | "settingsGroup"
  | "lane"
  | "binding"
  | "colorGroup"
  | "colorEntry"
  | "colorTheme";

export type PhonoscopeClipboardPayloads = {
  settingsGroup: PhonoscopeSettingsGroup;
  lane: PhonoscopeDriverLane;
  binding: PhonoscopeEffectBinding;
  colorGroup: PhonoscopeColorGroup;
  colorEntry: PhonoscopeColorGroupEntry;
  colorTheme: PhonoscopeColorTheme;
};

type ClipboardItem = {
  [K in PhonoscopeClipboardKind]: { kind: K; label: string; payload: PhonoscopeClipboardPayloads[K] };
}[PhonoscopeClipboardKind];

type ClipboardValue = {
  item: ClipboardItem | null;
  copy: <K extends PhonoscopeClipboardKind>(kind: K, label: string, payload: PhonoscopeClipboardPayloads[K]) => void;
  /** The clipboard payload if it is of this kind, freshly cloned and re-ided. */
  take: <K extends PhonoscopeClipboardKind>(kind: K) => PhonoscopeClipboardPayloads[K] | null;
};

const PhonoscopeClipboardContext = createContext<ClipboardValue | null>(null);

export function newPhonoscopeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Give every node in a pasted subtree a fresh id.
 *
 * Ids key envelope state and accordion open/closed state, so a paste that kept
 * the originals would make the copy and the original move as one.
 */
export function reidBinding(binding: PhonoscopeEffectBinding): PhonoscopeEffectBinding {
  return { ...structuredClone(binding), id: newPhonoscopeId("bind") };
}

export function reidLane(lane: PhonoscopeDriverLane): PhonoscopeDriverLane {
  const clone = structuredClone(lane);
  return { ...clone, id: newPhonoscopeId("lane"), bindings: clone.bindings.map(reidBinding) };
}

export function reidSettingsGroup(group: PhonoscopeSettingsGroup): PhonoscopeSettingsGroup {
  const clone = structuredClone(group);
  return {
    ...clone,
    id: newPhonoscopeId("settings"),
    lanes: clone.lanes.map(reidLane),
    // Only one group may ever hold the default flag.
    isDefault: false,
  };
}

export function reidColorEntry(entry: PhonoscopeColorGroupEntry): PhonoscopeColorGroupEntry {
  return { ...structuredClone(entry), id: newPhonoscopeId("entry") };
}

export function reidColorGroup(group: PhonoscopeColorGroup): PhonoscopeColorGroup {
  const clone = structuredClone(group);
  return {
    ...clone,
    id: newPhonoscopeId("cgroup"),
    entries: clone.entries.map(reidColorEntry),
    // Genres are exclusive and the default flag is singular, so a copy starts
    // claiming neither rather than silently stealing from its original.
    genres: [],
    isDefault: false,
  };
}

export function reidColorTheme(theme: PhonoscopeColorTheme): PhonoscopeColorTheme {
  return { ...structuredClone(theme), id: newPhonoscopeId("theme") };
}

const REID: { [K in PhonoscopeClipboardKind]: (value: PhonoscopeClipboardPayloads[K]) => PhonoscopeClipboardPayloads[K] } = {
  settingsGroup: reidSettingsGroup,
  lane: reidLane,
  binding: reidBinding,
  colorGroup: reidColorGroup,
  colorEntry: reidColorEntry,
  colorTheme: reidColorTheme,
};

export function PhonoscopeClipboardProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<ClipboardItem | null>(null);

  const copy = useCallback<ClipboardValue["copy"]>((kind, label, payload) => {
    setItem({ kind, label, payload: structuredClone(payload) } as ClipboardItem);
  }, []);

  const take = useCallback<ClipboardValue["take"]>((kind) => {
    if (!item || item.kind !== kind) return null;
    const reid = REID[kind] as (value: PhonoscopeClipboardPayloads[typeof kind]) => PhonoscopeClipboardPayloads[typeof kind];
    return reid(item.payload as PhonoscopeClipboardPayloads[typeof kind]);
  }, [item]);

  const value = useMemo<ClipboardValue>(() => ({ item, copy, take }), [item, copy, take]);
  return (
    <PhonoscopeClipboardContext.Provider value={value}>
      {children}
    </PhonoscopeClipboardContext.Provider>
  );
}

/** Outside a provider the clipboard is simply always empty, never a crash. */
const EMPTY: ClipboardValue = { item: null, copy: () => {}, take: () => null };

export function usePhonoscopeClipboard(): ClipboardValue {
  return useContext(PhonoscopeClipboardContext) ?? EMPTY;
}
