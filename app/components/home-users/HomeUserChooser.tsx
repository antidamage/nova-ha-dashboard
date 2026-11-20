"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  HOME_USER_CHANGE_EVENT,
  HOUSEHOLD_VIEW,
  readHomeUser,
  setHomeUserGateSettled,
  writeHomeUser,
} from "./homeUserSetting";

/**
 * "Who's using this device?" (specs/home-users.md section 3). Shown when this
 * device has no valid identity and the house has home users. A colour square
 * per person with the name under it, then a Household tile for everyone.
 *
 * No close button, no outside-click dismiss, Escape does nothing: a choice is
 * required. It renders nothing on the server or the first client render, and
 * writes only localStorage, only on a tap.
 */

type ChooserUser = { id: string; label: string; color: string };

async function loadUsers(): Promise<ChooserUser[]> {
  const response = await fetch("/api/home-users", { cache: "no-store" });
  if (!response.ok) throw new Error(`home-users ${response.status}`);
  const body = (await response.json()) as { users?: ChooserUser[] };
  return body.users ?? [];
}

export function HomeUserChooser() {
  const [users, setUsers] = useState<ChooserUser[] | null>(null);
  const [pending, setPending] = useState(false);
  const firstTileRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    const evaluate = () => {
      const stored = readHomeUser();
      void loadUsers()
        .then((list) => {
          if (!alive) return;
          setUsers(list);
          const valid = stored === HOUSEHOLD_VIEW || list.some((user) => user.id === stored);
          const ask = list.length > 0 && !valid;
          setPending(ask);
          setHomeUserGateSettled(!ask);
        })
        .catch(() => {
          // Unknown home users must not hold the experience chooser hostage.
          if (alive) setHomeUserGateSettled(true);
        });
    };
    evaluate();
    window.addEventListener(HOME_USER_CHANGE_EVENT, evaluate);
    return () => {
      alive = false;
      window.removeEventListener(HOME_USER_CHANGE_EVENT, evaluate);
    };
  }, []);

  useEffect(() => {
    if (pending) firstTileRef.current?.focus();
  }, [pending]);

  if (!pending || !users || typeof document === "undefined") return null;

  const choose = (id: string) => {
    setPending(false);
    writeHomeUser(id);
  };

  // Keep focus inside the dialog; Escape is deliberately not a way out.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const tiles = [...(cardRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    if (!tiles.length) return;
    const first = tiles[0];
    const last = tiles[tiles.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const tiles = [...users, { id: HOUSEHOLD_VIEW, label: "Household", color: "" }];

  return createPortal(
    <div className="system-confirm-overlay home-user-overlay" role="presentation">
      <div
        ref={cardRef}
        className="system-confirm-card home-user-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="home-user-title"
        onKeyDown={onKeyDown}
      >
        <span className="system-stripe system-stripe-top" aria-hidden="true" />
        <span className="system-stripe system-stripe-bottom" aria-hidden="true" />
        <h3 id="home-user-title" className="system-confirm-title">
          Who&apos;s using this device?
        </h3>
        <div className="home-user-tiles">
          {tiles.map((user, index) => (
            <button
              key={user.id}
              ref={index === 0 ? firstTileRef : undefined}
              type="button"
              className="home-user-tile"
              data-household={user.id === HOUSEHOLD_VIEW ? "" : undefined}
              onClick={() => choose(user.id)}
            >
              <span
                className="home-user-swatch"
                aria-hidden="true"
                style={user.color ? { background: user.color } : undefined}
              />
              <span className="home-user-name">{user.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
