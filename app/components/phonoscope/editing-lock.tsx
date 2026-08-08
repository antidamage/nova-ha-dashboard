"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";

/**
 * A hold on the panel's state while a field is being typed into.
 *
 * Every control in the Visualiser panel renders from one `config` object, and
 * every edit round-trips: the panel POSTs the whole configuration and replaces
 * its state with what the server echoes back. For a slider that is invisible —
 * the gesture is over before the reply lands. For a text field it is not: the
 * reply carries the name as it was several keystrokes ago, and applying it
 * rewrites the input under the cursor. That is what made settings groups,
 * colour themes and colour groups impossible to rename — the letters kept
 * being taken back.
 *
 * So a focused field takes this lock, and while it is held nothing may replace
 * the panel's state from the server: not a save's echo, not a reload. Local
 * state is the truth for as long as someone is typing into it, and the blur
 * that ends the edit is also the commit that makes it the server's truth.
 *
 * Ref-counted rather than a boolean because the panel has more than one field
 * and focus can move straight from one to the next. Deliberately a ref rather
 * than state: the lock is read inside async callbacks that closed over their
 * own render, and those must see whether a field is focused *now*.
 */
type EditingLockValue = {
  acquire: () => void;
  release: () => void;
};

const PhonoscopeEditingLockContext = createContext<EditingLockValue | null>(null);

/**
 * Owns the lock. Returns the value to provide, plus the predicate the owner
 * checks before applying anything that came from the server.
 */
export function usePhonoscopeEditingLock() {
  const held = useRef(0);
  const acquire = useCallback(() => { held.current += 1; }, []);
  const release = useCallback(() => { held.current = Math.max(0, held.current - 1); }, []);
  const isEditing = useCallback(() => held.current > 0, []);
  const value = useMemo(() => ({ acquire, release }), [acquire, release]);
  return { value, isEditing };
}

export function PhonoscopeEditingLockProvider(
  { value, children }: { value: EditingLockValue; children: ReactNode },
) {
  return (
    <PhonoscopeEditingLockContext.Provider value={value}>
      {children}
    </PhonoscopeEditingLockContext.Provider>
  );
}

/**
 * Focus/blur handlers to spread onto a text input that must not be rewritten
 * from the server while it is being edited:
 *
 * ```tsx
 * <input className="cyber-text-input" value={group.name} {...useEditLock()} … />
 * ```
 *
 * Holding is tracked per field rather than trusting focus and blur to pair up:
 * a field that unmounts while focused (an accordion closing, a group being
 * deleted mid-rename) never gets its blur, and a lock left held would freeze
 * the panel's state for the rest of the session. The unmount cleanup releases
 * it, and the flag makes a double release a no-op.
 */
export function useEditLock() {
  const lock = useContext(PhonoscopeEditingLockContext);
  const holding = useRef(false);

  const release = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    lock?.release();
  }, [lock]);

  const acquire = useCallback(() => {
    if (holding.current) return;
    holding.current = true;
    lock?.acquire();
  }, [lock]);

  useEffect(() => release, [release]);

  return { onFocus: acquire, onBlur: release };
}
