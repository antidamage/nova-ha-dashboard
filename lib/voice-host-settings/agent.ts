import { fetchVoiceHostJson, requestVoiceHostJson } from "./client";
import type { AgentAdministrationPayload, AgentAutomation, AgentMemory, ProactiveIntervention } from "./types";

export async function fetchVoiceHostAgentAdministration(): Promise<AgentAdministrationPayload | null> {
  const payload = await fetchVoiceHostJson("/v1/agent/administration", "agent administration");
  if (!payload || !Array.isArray((payload as AgentAdministrationPayload).goals)) return null;
  return payload as AgentAdministrationPayload;
}

export async function fetchVoiceHostAgentMemories(): Promise<AgentMemory[] | null> {
  const payload = await fetchVoiceHostJson("/v1/agent/memories", "agent memories");
  return payload && Array.isArray((payload as { memories?: unknown }).memories)
    ? (payload as { memories: AgentMemory[] }).memories
    : null;
}

export function updateVoiceHostAgentMemory(memoryId: string, body: Record<string, unknown>) {
  return requestVoiceHostJson(`/v1/agent/memories/${encodeURIComponent(memoryId)}`, "agent memory update", {
    method: "PATCH", body,
  });
}

export function forgetVoiceHostAgentMemory(memoryId: string) {
  return requestVoiceHostJson(`/v1/agent/memories/${encodeURIComponent(memoryId)}`, "forget agent memory", {
    method: "DELETE",
  });
}

export function backupVoiceHostAgentMemories() {
  return requestVoiceHostJson("/v1/agent/memories/backup", "agent memory backup", { method: "POST" });
}

export function consolidateVoiceHostAgentMemories() {
  return requestVoiceHostJson("/v1/agent/memories/consolidate", "agent memory consolidation", { method: "POST" });
}

export function setVoiceHostAgentIdentityRole(personId: string, role: string) {
  return requestVoiceHostJson(
    `/v1/agent/identities/${encodeURIComponent(personId)}`,
    "agent identity role update",
    { method: "PUT", body: { role } },
  );
}

export function createVoiceHostDelegationGrant(grant: Record<string, unknown>) {
  return requestVoiceHostJson("/v1/agent/grants", "delegation grant creation", {
    method: "POST",
    body: grant,
  });
}

export function revokeVoiceHostDelegationGrant(grantId: string) {
  return requestVoiceHostJson(
    `/v1/agent/grants/${encodeURIComponent(grantId)}`,
    "delegation grant revocation",
    { method: "DELETE" },
  );
}

export function cancelVoiceHostAgentGoal(goalId: string, reason: string) {
  return requestVoiceHostJson(
    `/v1/agent/goals/${encodeURIComponent(goalId)}/cancel`,
    "durable goal cancellation",
    { method: "POST", body: { reason } },
  );
}

export async function fetchVoiceHostAgentAutomations(): Promise<AgentAutomation[] | null> {
  const payload = await fetchVoiceHostJson("/v1/agent/automations", "agent automations");
  return payload && Array.isArray((payload as { automations?: unknown }).automations)
    ? (payload as { automations: AgentAutomation[] }).automations
    : null;
}

export async function fetchVoiceHostProactiveInterventions(): Promise<ProactiveIntervention[] | null> {
  const payload = await fetchVoiceHostJson(
    "/v1/agent/proactive-interventions",
    "proactive interventions",
  );
  return payload && Array.isArray((payload as { interventions?: unknown }).interventions)
    ? (payload as { interventions: ProactiveIntervention[] }).interventions
    : null;
}

export function createVoiceHostAgentAutomation(
  ownerId: string,
  draft: Record<string, unknown>,
) {
  return requestVoiceHostJson(
    `/v1/agent/automations?owner_id=${encodeURIComponent(ownerId)}`,
    "agent automation draft",
    { method: "POST", body: draft },
  );
}

export function transitionVoiceHostAgentAutomation(
  automationId: string,
  action: "simulate" | "approve" | "activate" | "rollback",
  ownerId?: string,
) {
  const body = action === "simulate" ? undefined : { owner_id: ownerId };
  return requestVoiceHostJson(
    `/v1/agent/automations/${encodeURIComponent(automationId)}/${action}`,
    `agent automation ${action}`,
    { method: "POST", body },
  );
}

export function feedbackVoiceHostProactiveIntervention(
  interventionId: string,
  ownerId: string,
  outcome: "accepted" | "dismissed" | "redundant" | "annoying",
) {
  return requestVoiceHostJson(
    `/v1/agent/proactive-interventions/${encodeURIComponent(interventionId)}/feedback`,
    "proactive intervention feedback",
    { method: "POST", body: { owner_id: ownerId, outcome } },
  );
}
