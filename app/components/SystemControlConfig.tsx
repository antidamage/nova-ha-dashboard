"use client";

import { Loader2, Power, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { ConfigAccordion } from "./ConfigControls";
import { ModalOverlay } from "./ModalOverlay";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import { SystemBlocker } from "./SystemBlocker";
import { beginExplicitBlocker, endExplicitBlocker } from "./systemBlockerState";
import { useAgentName } from "./AgentNameContext";

const DEMO_MODE = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";

type SystemTarget = "services" | "host";

type ConfirmCopy = {
  title: string;
  body: string;
  confirmLabel: string;
};

type TargetConfig = {
  label: string;
  endpoint: string;
  icon: ComponentType<{ className?: string }>;
  first: ConfirmCopy;
  second: ConfirmCopy;
  pendingMessage: string;
  blockerTitle: string;
  blockerBody: string;
  // Reboot keeps responding for a moment before it actually goes down, so the
  // blocker must first see it offline before treating "reachable" as "back".
  // A dashboard restart drops instantly, so the first reachable poll is "back".
  awaitOffline: boolean;
};

const TARGETS: Record<SystemTarget, TargetConfig> = {
  services: {
    label: "Restart Nova Services",
    endpoint: "/api/system/restart-stack",
    icon: RotateCcw,
    first: {
      title: "Restart Nova's services?",
      body: "Home Assistant and the rest of Nova's services (MQTT, Matter, voice, bridges) will restart, then the dashboard itself. Every screen will go blank and automations will pause until they come back — about a minute or two. The computer stays on.",
      confirmLabel: "Yes, restart Nova's services",
    },
    second: {
      title: "Final confirmation",
      body: "This is your last chance to stop. Home Assistant and every Nova service will restart together; the dashboard will be unavailable on every display for a minute or two.",
      confirmLabel: "Restart Nova's services now",
    },
    pendingMessage: "Services restart requested — Home Assistant and the dashboard will go offline and come back shortly.",
    blockerTitle: "Restarting Nova's services",
    blockerBody: "Nova is restarting Home Assistant and its services, then the dashboard. This screen will reconnect and reload automatically once it's back — this can take a minute or two.",
    // The dashboard container is bounced last (after the services + up to a
    // minute of cron lag), so wait to actually see it go offline before
    // treating a reachable poll as "back", like the reboot path.
    awaitOffline: true,
  },
  host: {
    label: "Reboot Nova",
    endpoint: "/api/system/reboot",
    icon: Power,
    first: {
      title: "Reboot the Nova computer?",
      body: "The entire Nova machine will reboot. The dashboard, Home Assistant, cameras and every other service it hosts will be unavailable until it finishes booting.",
      confirmLabel: "Yes, reboot Nova",
    },
    second: {
      title: "Final confirmation",
      body: "This is your last chance to stop. Rebooting takes the whole system — dashboard, automations and cameras — completely offline for several minutes.",
      confirmLabel: "Reboot Nova now",
    },
    pendingMessage: "Reboot requested — Nova will go offline and restart shortly.",
    blockerTitle: "Rebooting Nova",
    blockerBody: "Nova is rebooting. The dashboard, automations and cameras are offline. This screen will reconnect and reload automatically once Nova is back — this can take a few minutes.",
    awaitOffline: true,
  },
};

function targetConfigForAgent(config: TargetConfig, agentName: string): TargetConfig {
  const named = (value: string) => value.replaceAll("Nova", agentName);
  const namedConfirm = (copy: ConfirmCopy): ConfirmCopy => ({
    title: named(copy.title),
    body: named(copy.body),
    confirmLabel: named(copy.confirmLabel),
  });
  return {
    ...config,
    label: named(config.label),
    first: namedConfirm(config.first),
    second: namedConfirm(config.second),
    pendingMessage: named(config.pendingMessage),
    blockerTitle: named(config.blockerTitle),
    blockerBody: named(config.blockerBody),
  };
}

// Health endpoint the blocker polls to know when Nova is reachable again.
const HEALTH_URL = "/api/version";
const BLOCKER_GRACE_MS = 5_000;
const BLOCKER_POLL_MS = 2_000;
const BLOCKER_POLL_TIMEOUT_MS = 3_000;
// Hard ceiling so a never-returning host can't trap the screen forever.
const BLOCKER_MAX_WAIT_MS = 6 * 60_000;

type Pending = { target: SystemTarget; stage: 1 | 2 };

export function SystemControlConfig() {
  const { agentName } = useAgentName();
  const targets = useMemo<Record<SystemTarget, TargetConfig>>(() => ({
    services: targetConfigForAgent(TARGETS.services, agentName),
    host: targetConfigForAgent(TARGETS.host, agentName),
  }), [agentName]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<SystemTarget | null>(null);

  // Once a restart/reboot is queued, throw up the un-dismissable blocker and
  // poll the dashboard until it's reachable again, then navigate to it. For a
  // reboot we wait to actually see it go offline first (it keeps answering for a
  // moment); a dashboard restart drops immediately so the first reachable poll
  // counts as back.
  useEffect(() => {
    if (!blocking) {
      return;
    }
    const awaitOffline = targets[blocking].awaitOffline;
    beginExplicitBlocker(); // suppress the global blocker on this device
    let cancelled = false;
    let sawOffline = false;
    let pollTimer: number | undefined;

    const goToDashboard = () => {
      if (!cancelled) {
        cancelled = true;
        window.location.assign("/");
      }
    };

    const poll = async () => {
      if (cancelled) {
        return;
      }
      try {
        const controller = new AbortController();
        const abort = window.setTimeout(() => controller.abort(), BLOCKER_POLL_TIMEOUT_MS);
        const response = await fetch(HEALTH_URL, { cache: "no-store", signal: controller.signal });
        window.clearTimeout(abort);
        if (!response.ok) {
          sawOffline = true;
        } else if (!awaitOffline || sawOffline) {
          goToDashboard();
          return;
        }
      } catch {
        sawOffline = true; // network error == Nova is down
      }
      if (!cancelled) {
        pollTimer = window.setTimeout(poll, BLOCKER_POLL_MS);
      }
    };

    const graceTimer = window.setTimeout(poll, BLOCKER_GRACE_MS);
    const fallbackTimer = window.setTimeout(goToDashboard, BLOCKER_MAX_WAIT_MS);

    return () => {
      cancelled = true;
      endExplicitBlocker();
      window.clearTimeout(graceTimer);
      window.clearTimeout(fallbackTimer);
      if (pollTimer !== undefined) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [blocking, targets]);

  const close = useCallback(() => {
    if (busy) {
      return;
    }
    setPending(null);
  }, [busy]);

  const fire = useCallback(async (target: SystemTarget) => {
    const config = targets[target];
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: "config" }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.ok) {
        setPending(null);
        setBlocking(target); // hand off to the blocker + reconnect poller
      } else {
        setPending(null);
        setMessage(payload?.error ?? "The request could not be sent.");
      }
    } catch (error) {
      setPending(null);
      setMessage(error instanceof Error ? error.message : "The request could not be sent.");
    } finally {
      setBusy(false);
    }
  }, [targets]);

  const onConfirm = useCallback(() => {
    if (!pending) {
      return;
    }
    if (pending.stage === 1) {
      setPending({ target: pending.target, stage: 2 });
      return;
    }
    void fire(pending.target);
  }, [pending, fire]);

  const activeConfig = pending ? targets[pending.target] : null;
  const copy = pending && activeConfig ? (pending.stage === 1 ? activeConfig.first : activeConfig.second) : null;

  return (
    <ConfigAccordion
      id="system"
      title="System Power"
      icon={<Power className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <div className="grid gap-4">
        <div className="system-power-grid">
          {(Object.keys(targets) as SystemTarget[]).map((target) => {
            const config = targets[target];
            const Icon = config.icon;
            return (
              <MomentaryFeedbackButton
                key={target}
                type="button"
                className="system-power-button"
                disabled={DEMO_MODE || busy || blocking !== null}
                onClick={() => setPending({ target, stage: 1 })}
              >
                <span className="system-stripe system-stripe-top" aria-hidden="true" />
                <span className="system-stripe system-stripe-bottom" aria-hidden="true" />
                <Icon className="system-power-button-icon h-6 w-6" />
                <span className="system-power-button-label">{config.label}</span>
              </MomentaryFeedbackButton>
            );
          })}
        </div>

        {DEMO_MODE ? (
          <p className="text-xs font-semibold text-neutral-500">Power controls are disabled in the demo.</p>
        ) : null}
        {message ? <p className="text-sm font-semibold text-cyan-200">{message}</p> : null}
      </div>

      <ModalOverlay
        open={Boolean(pending && activeConfig && copy)}
        onClose={close}
        dialogRole="alertdialog"
        ariaLabelledBy="system-confirm-title"
        ariaDescribedBy="system-confirm-body"
        className="system-confirm-card"
      >
        {pending && activeConfig && copy ? (
          <>
            <span className="system-stripe system-stripe-top" aria-hidden="true" />
            <span className="system-stripe system-stripe-bottom" aria-hidden="true" />
            <p className="system-confirm-step">
              {pending.stage === 1 ? "Confirmation 1 of 2" : "Confirmation 2 of 2 — last chance"}
            </p>
            <h3 id="system-confirm-title" className="system-confirm-title">
              {copy.title}
            </h3>
            <p id="system-confirm-body" className="system-confirm-body">
              {copy.body}
            </p>
            <div className="system-confirm-actions">
              <button type="button" className="system-confirm-cancel" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button type="button" className="system-confirm-go" disabled={busy} onClick={onConfirm}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {copy.confirmLabel}
              </button>
            </div>
            <p className="system-confirm-dismiss-hint">Tap anywhere outside this box to cancel.</p>
          </>
        ) : null}
      </ModalOverlay>

      {blocking ? (
        <SystemBlocker title={targets[blocking].blockerTitle} body={targets[blocking].blockerBody} />
      ) : null}
    </ConfigAccordion>
  );
}
