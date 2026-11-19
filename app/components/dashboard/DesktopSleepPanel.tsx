"use client";

import { Monitor, Moon, Power, PowerOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type { ManagedComputerPublic } from "../../../lib/managed-computers";
import { ConfirmDialog, type ConfirmCopy, type ConfirmStage } from "../ConfirmDialog";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";

// The Network zone's Computers panel (specs/system-power-controls.md).
type DesktopAction = "sleep" | "wake" | "shutdown";
type Target = { id: string; name: string };
type ActionButton = Target & { action: DesktopAction };
type PendingAction = { target: Target; action: DesktopAction };

// Shut down's two timed confirmations: each stage is locked for 3 s, then
// accepted for 5 s, then expires (the owner's own numbers).
export const SHUTDOWN_ARM_DELAY_MS = 3_000;
export const SHUTDOWN_EXPIRE_MS = 5_000;
const STATUS_VISIBLE_MS = 6_000;

function canSleep(computer: ManagedComputerPublic) {
  return computer.enabled && computer.capabilities.sleep;
}

function canWake(computer: ManagedComputerPublic) {
  return computer.enabled && computer.capabilities.wake && Boolean(computer.macAddress);
}

function canShutdown(computer: ManagedComputerPublic) {
  return computer.enabled && computer.capabilities.shutdown === true;
}

const ACTION_META: Record<DesktopAction, {
  Icon: ComponentType<{ className?: string }>;
  verb: string;
  danger?: boolean;
  timing?: Pick<ConfirmCopy, "armDelayMs" | "expireMs">;
  stages: (name: string) => ConfirmStage[];
}> = {
  sleep: {
    Icon: Moon,
    verb: "Sleep",
    stages: (name) => [{
      step: "Confirm sleep",
      title: `Put ${name} to sleep?`,
      body: `${name} will be put to sleep. Any unsaved work on it may be lost. You can wake it again from the dashboard or the computer itself.`,
      confirmLabel: `Sleep ${name}`,
    }],
  },
  wake: {
    Icon: Power,
    verb: "Wake",
    stages: (name) => [{
      step: "Confirm wake",
      title: `Wake ${name}?`,
      body: `${name} will be sent a wake-on-LAN signal to power on from sleep. It can take a few moments to come back online.`,
      confirmLabel: `Wake ${name}`,
    }],
  },
  shutdown: {
    Icon: PowerOff,
    verb: "Shut down",
    danger: true,
    timing: { armDelayMs: SHUTDOWN_ARM_DELAY_MS, expireMs: SHUTDOWN_EXPIRE_MS },
    stages: (name) => [
      {
        title: `Fully shut down ${name}?`,
        body: "Open apps close without saving. It stays off until started again; Wake may not work, so its power button may be needed. Everything it hosts stops with it.",
        confirmLabel: `Shut down ${name}`,
      },
      {
        title: `Last chance: shut down ${name}?`,
        body: `${name} powers off now.`,
        confirmLabel: `Shut down ${name}`,
      },
    ],
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
  const [shutdownBusy, setShutdownBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (statusTimer.current) {
        clearTimeout(statusTimer.current);
      }
    };
  }, []);

  const showStatus = useCallback((text: string) => {
    if (statusTimer.current) {
      clearTimeout(statusTimer.current);
    }
    setStatus(text);
    statusTimer.current = setTimeout(() => setStatus(null), STATUS_VISIBLE_MS);
  }, []);

  // Shut down is handled here rather than threaded through the dashboard's
  // command hooks: it is terminal, and nothing outside this panel reacts to it.
  const shutdown = useCallback(async (target: Target) => {
    setShutdownBusy(true);
    try {
      const response = await fetch("/api/desktop/shutdown", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: target.id }),
      });
      const payload = await response.json().catch(() => ({}));
      showStatus(response.ok ? `Shutdown sent to ${target.name}` : payload.error ?? `Could not shut down ${target.name}`);
    } catch {
      showStatus(`Could not reach Nova to shut down ${target.name}`);
    } finally {
      setShutdownBusy(false);
    }
  }, [showStatus]);

  // One button per available action per computer, grouped by machine: Sleep
  // (moon), Wake (power), Shut down (power-off).
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
      if (canShutdown(computer)) {
        list.push({ ...target, action: "shutdown" });
      }
    }
    return list;
  }, [computers, onSleep, onWake]);

  const busyFor = useCallback(
    (action: DesktopAction) => (action === "sleep" ? sleepBusy : action === "wake" ? wakeBusy : shutdownBusy),
    [sleepBusy, wakeBusy, shutdownBusy],
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
    } else if (pending.action === "wake") {
      onWake?.(pending.target);
    } else {
      void shutdown(pending.target);
    }
    setPending(null);
  }, [pending, onSleep, onWake, shutdown]);

  if (!buttons.length) {
    return null;
  }

  const meta = pending ? ACTION_META[pending.action] : null;
  const copy: ConfirmCopy | null = pending && meta
    ? { stages: meta.stages(pending.target.name), ...meta.timing }
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
                className={meta.danger ? "system-power-button system-power-button-danger" : "system-power-button"}
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

        <p className="desktop-power-status" role="status" aria-live="polite">
          {status ?? ""}
        </p>
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
