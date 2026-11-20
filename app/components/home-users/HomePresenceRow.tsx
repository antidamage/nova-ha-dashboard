"use client";

import { User } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { decidePresenceActions, describePresenceActions } from "../../../lib/presence/rules-model";
import type { DashboardState, HomeUserState } from "../../../lib/types";
import { ConfirmDialog } from "../ConfirmDialog";

/**
 * Who is home (specs/home-users.md section 7): one icon per home user, in their
 * colour while home and dimmed while away, the name always under it. A tap
 * corrects the state through the same route a phone would call, after a
 * confirm that says what the house will do.
 */

function sinceLabel(changedAt: string | null) {
  if (!changedAt) return "";
  const date = new Date(changedAt);
  return Number.isNaN(date.getTime())
    ? ""
    : ` since ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function HomePresenceRow({ data }: { data: DashboardState | null }) {
  const users = data?.homeUsers ?? [];
  const [target, setTarget] = useState<HomeUserState | null>(null);
  const [busy, setBusy] = useState(false);
  if (!users.length) return null;

  const consequence = (user: HomeUserState) => {
    const event = user.home ? "departure" : "arrival";
    const actions = decidePresenceActions({
      event,
      member: user,
      people: users,
      zoneSettings: data?.homeZones ?? [],
      homeBefore: new Set(users.filter((candidate) => candidate.home).map((candidate) => candidate.id)),
      sunUp: data?.sun?.state === "above_horizon",
    });
    return describePresenceActions(user.label, event, actions);
  };

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const route = target.home ? "im-leaving" : "im-home";
      await fetch(`/api/${route}/${encodeURIComponent(target.id)}`, { cache: "no-store" });
    } finally {
      setBusy(false);
      setTarget(null);
    }
  };

  return (
    <div className="home-presence-row" role="group" aria-label="Who is home">
      {users.map((user) => {
        const label = `${user.label}: ${user.home ? "home" : "away"}${sinceLabel(user.changedAt)}`;
        return (
          <button
            key={user.id}
            type="button"
            className="home-presence-person"
            data-home={user.home ? "" : undefined}
            style={user.home ? ({ "--home-user-color": user.color } as CSSProperties) : undefined}
            aria-label={label}
            title={label}
            onClick={() => setTarget(user)}
          >
            <User className="h-6 w-6" aria-hidden="true" />
            <span className="home-presence-name">{user.label}</span>
          </button>
        );
      })}
      <ConfirmDialog
        open={Boolean(target)}
        busy={busy}
        copy={
          target
            ? {
                stages: [
                  {
                    title: target.home ? `Mark ${target.label} away` : `Mark ${target.label} home`,
                    body: consequence(target),
                    confirmLabel: target.home ? "Mark away" : "Mark home",
                  },
                ],
              }
            : null
        }
        onCancel={() => setTarget(null)}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}
