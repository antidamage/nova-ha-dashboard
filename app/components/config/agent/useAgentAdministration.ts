"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentAdministrationPayload,
  AgentAutomation,
  AgentMemory,
  ProactiveIntervention,
  SpeakerProfilesPayload,
} from "../../../../lib/voice-host-settings";
import { administrationAction, automationAction, csv, terminalGoalStates } from "./administration-client";

/** All state and actions behind AgentAdministration; its sections take slices of this. */
export function useAgentAdministration() {
  const [administration, setAdministration] = useState<AgentAdministrationPayload | null>(null);
  const [profiles, setProfiles] = useState<SpeakerProfilesPayload | null>(null);
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [automations, setAutomations] = useState<AgentAutomation[]>([]);
  const [interventions, setInterventions] = useState<ProactiveIntervention[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [granteeId, setGranteeId] = useState("");
  const [capability, setCapability] = useState("home.control");
  const [targets, setTargets] = useState("");
  const [recipients, setRecipients] = useState("");
  const [locations, setLocations] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [currency, setCurrency] = useState("NZD");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notifyOnUse, setNotifyOnUse] = useState(true);
  const [automationOwnerId, setAutomationOwnerId] = useState("");
  const [automationId, setAutomationId] = useState("");
  const [automationSummary, setAutomationSummary] = useState("");
  const [automationEventKind, setAutomationEventKind] = useState("device_health");
  const [automationChannel, setAutomationChannel] = useState("dashboard");
  const [automationMessage, setAutomationMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [adminResponse, profileResponse, memoryResponse, automationResponse] = await Promise.all([
        fetch("/api/voice/administration", { cache: "no-store" }),
        fetch("/api/voice/speaker-profiles", { cache: "no-store" }),
        fetch("/api/voice/memories", { cache: "no-store" }),
        fetch("/api/voice/automations", { cache: "no-store" }),
      ]);
      if (!adminResponse.ok || !profileResponse.ok) throw new Error("Voice administration unavailable");
      const admin = await adminResponse.json() as AgentAdministrationPayload;
      const people = await profileResponse.json() as SpeakerProfilesPayload;
      if (memoryResponse.ok) setMemories(((await memoryResponse.json()) as { memories: AgentMemory[] }).memories);
      if (automationResponse.ok) {
        const automationPayload = await automationResponse.json() as {
          automations: AgentAutomation[];
          interventions: ProactiveIntervention[];
        };
        setAutomations(automationPayload.automations);
        setInterventions(automationPayload.interventions);
      }
      setAdministration(admin);
      setProfiles(people);
      setGranteeId((current) => current || people.profiles[0]?.id || "");
      setAutomationOwnerId((current) => current || admin.identities.find((identity) => identity.role === "owner")?.person_id || "");
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Voice administration unavailable");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const roles = useMemo(
    () => new Map(administration?.identities.map((identity) => [identity.person_id, identity.role])),
    [administration],
  );
  const activeGoals = administration?.goals.filter((goal) => !terminalGoalStates.has(goal.status)) ?? [];
  const research = administration?.research ?? [];
  const briefings = administration?.briefings ?? [];
  const briefingSchedules = administration?.briefingSchedules ?? [];
  const subscriptions = administration?.subscriptions ?? [];

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Administration request failed");
    } finally {
      setBusy(false);
    }
  }

  async function createGrant() {
    if (!granteeId) return;
    const grant: Record<string, unknown> = {
      grantee_id: granteeId,
      capability,
      target_scope: csv(targets),
      recipients: csv(recipients),
      locations: csv(locations),
      notify_on_use: notifyOnUse,
    };
    if (expiresAt) grant.expires_at = new Date(expiresAt).toISOString();
    if (maxUses) grant.max_uses = Number(maxUses);
    if (maxAmount) {
      grant.max_amount = Number(maxAmount);
      grant.currency = currency.toUpperCase();
    }
    if (startTime && endTime) grant.schedule = { start_time: startTime, end_time: endTime };
    await administrationAction({ action: "create-grant", grant });
    setTargets("");
    setRecipients("");
    setLocations("");
    setExpiresAt("");
    setMaxUses("");
    setMaxAmount("");
  }

  async function createAutomation() {
    if (!automationOwnerId || !automationId.trim() || !automationSummary.trim()) return;
    await automationAction({
      action: "draft",
      ownerId: automationOwnerId,
      draft: {
        id: automationId.trim(),
        summary: automationSummary.trim(),
        trigger: { kind: automationEventKind },
        proposed_actions: [{ channel: automationChannel, message: automationMessage.trim() || automationSummary.trim() }],
      },
    });
    setAutomationId("");
    setAutomationSummary("");
    setAutomationMessage("");
  }

  return {
    administration,
    profiles,
    memories,
    automations,
    interventions,
    error,
    busy,
    granteeId,
    setGranteeId,
    capability,
    setCapability,
    targets,
    setTargets,
    recipients,
    setRecipients,
    locations,
    setLocations,
    expiresAt,
    setExpiresAt,
    maxUses,
    setMaxUses,
    maxAmount,
    setMaxAmount,
    currency,
    setCurrency,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    notifyOnUse,
    setNotifyOnUse,
    automationOwnerId,
    setAutomationOwnerId,
    automationId,
    setAutomationId,
    automationSummary,
    setAutomationSummary,
    automationEventKind,
    setAutomationEventKind,
    automationChannel,
    setAutomationChannel,
    automationMessage,
    setAutomationMessage,
    refresh,
    roles,
    activeGoals,
    research,
    briefings,
    briefingSchedules,
    subscriptions,
    run,
    createGrant,
    createAutomation,
  };
}

export type AgentAdministrationState = ReturnType<typeof useAgentAdministration>;
