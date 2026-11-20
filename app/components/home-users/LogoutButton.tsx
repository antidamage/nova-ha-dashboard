"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import type { HomeUserState } from "../../../lib/types";
import { ConfirmDialog } from "../ConfirmDialog";
import { HOUSEHOLD_VIEW, logOutHomeUser, useHomeUser } from "./homeUserSetting";

/**
 * The log-out button beside the config link (specs/home-users.md section 3).
 * Only present while this device has an identity. The ring is the person's
 * colour, so it is always plain whose view this is.
 */
export function LogoutButton({ users }: { users: HomeUserState[] | undefined }) {
  const id = useHomeUser();
  const [confirming, setConfirming] = useState(false);
  if (!id) return null;

  const user = users?.find((candidate) => candidate.id === id) ?? null;
  const name = id === HOUSEHOLD_VIEW ? "Household" : user?.label;
  if (!name) return null;

  const label = `Log out (viewing as ${name})`;
  return (
    <>
      <button
        type="button"
        className="dashboard-config-link dashboard-user-logout-link"
        aria-label={label}
        data-demo-tooltip-title="Log out"
        data-demo-tooltip={label}
        style={user ? { borderColor: user.color, borderWidth: 2 } : undefined}
        onClick={() => setConfirming(true)}
      >
        <LogOut className="h-5 w-5" aria-hidden="true" />
      </button>
      <ConfirmDialog
        open={confirming}
        copy={{
          stages: [
            {
              title: `Log out ${name}?`,
              body: "This device will ask who is using it, and the experience level, again.",
              confirmLabel: "Log out",
            },
          ],
        }}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          logOutHomeUser();
        }}
      />
    </>
  );
}
