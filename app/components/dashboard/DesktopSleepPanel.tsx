"use client";

import { Monitor, Moon, Power } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import type { ManagedComputerPublic } from "../../../lib/managed-computers";
import { ConfirmDialog } from "../ConfirmDialog";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";

type DesktopAction = "sleep" | "wake";
type Target = { id: string; name: string };
type ActionButton = Target & { action: DesktopAction };
type PendingAction = { target: Target; action: DesktopAction };

function canSleep(computer: ManagedComputerPublic) {
  return computer.enabled && computer.capabilities.sleep;
}

function canWake(computer: ManagedComputerPublic) {
  return computer.enabled && computer.capabilities.wake && Boolean(computer.macAddress);
}

const ACTION_META: Record<DesktopAction, {
  Icon: ComponentType<{ className?: string }>;
  verb: string;
  step: string;
  title: (name: string) => string;
  body: (name: string) => string;
  confirm: (name: string) => string;
}> = {
  sleep: {
    Icon: Moon,
    verb: "Sleep",
    step: "Confirm sleep",
    title: (name) => `Put ${name} to sleep?`,
    body: (name) => `${name} will be put to sleep. Any unsaved work on it may be lost. You can wake it again from the dashboard or the computer itself.`,
    confirm: (name) => `Sleep ${name}`,
  },
  wake: {
    Icon: Power,
    verb: "Wake",
    step: "Confirm wake",
    title: (name) => `Wake ${name}?`,
    body: (name) => `${name} will be sent a wake-on-LAN signal to power on from sleep. It can take a few moments to come back online.`,
    confirm: (name) => `Wake ${name}`,
  },
};

export function DesktopSleepPanel({
  sleepBusy = false,
  wakeBusy = false,
  onSleep,
  onWake,
}: {
  sleepBusy?: boolean;
  wakeBusy?: boolean;
  onSleep?: (computer: Target) => void;
  onWake?: (computer: Target) => void;
}) {
  const [computers, setComputers] = useState<ManagedComputerPublic[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/desktop/computers", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { computers: [] })
      .then((payload) => {
        if (!alive) {
          return;
        }
        setComputers((payload.computers ?? []) as ManagedComputerPublic[]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // One button per available action per computer: a Sleep box (moon) and/or a
  // Wake box (power), grouped by machine.
  const buttons = useMemo<ActionButton[]>(() => {
    const list: ActionButton[] = [];
    for (const computer of computers) {
      const target = { id: computer.id, name: computer.name };
      if (onSleep && canSleep(computer)) {
        list.push({ ...target, action: "sleep" });
      }
      if (onWake && canWake(computer)) {
        list.push({ ...target, action: "wake" });
      }
    }
    return list;
  }, [computers, onSleep, onWake]);

  const busyFor = useCallback(
    (action: DesktopAction) => (action === "sleep" ? sleepBusy : wakeBusy),
    [sleepBusy, wakeBusy],
  );

  const close = useCallback(() => {
    if (pending && busyFor(pending.action)) {
      return;
    }
    setPending(null);
  }, [pending, busyFor]);

  const onConfirm = useCallback(() => {
    if (!pending) {
      return;
    }
    if (pending.action === "sleep") {
      onSleep?.(pending.target);
    } else {
      onWake?.(pending.target);
    }
    setPending(null);
  }, [pending, onSleep, onWake]);

  if (!buttons.length) {
    return null;
  }

  const meta = pending ? ACTION_META[pending.action] : null;
  const copy = pending && meta
    ? {
        stages: [
          {
            step: meta.step,
            title: meta.title(pending.target.name),
            body: meta.body(pending.target.name),
            confirmLabel: meta.confirm(pending.target.name),
          },
        ],
      }
    : null;

  return (
    <div className="desktop-power-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Monitor className="h-5 w-5 shrink-0 text-cyan-200" />
            <p className="truncate text-sm font-black uppercase text-cyan-200">Computers</p>
          </div>
        </div>

        <div className="system-power-grid">
          {buttons.map((button) => {
            const meta = ACTION_META[button.action];
            const Icon = meta.Icon;
            return (
              <MomentaryFeedbackButton
                key={`${button.action}:${button.id}`}
                type="button"
                aria-label={`${meta.verb} ${button.name}`}
                className="system-power-button"
                disabled={busyFor(button.action)}
                onClick={() => setPending({ target: { id: button.id, name: button.name }, action: button.action })}
              >
                <span className="system-stripe system-stripe-top" aria-hidden="true" />
                <span className="system-stripe system-stripe-bottom" aria-hidden="true" />
                <Icon className="system-power-button-icon h-6 w-6" />
                <span className="system-power-button-label">{meta.verb} {button.name}</span>
              </MomentaryFeedbackButton>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pending && copy)}
        copy={copy}
        busy={pending ? busyFor(pending.action) : false}
        onCancel={close}
        onConfirm={onConfirm}
      />
    </div>
  );
}
