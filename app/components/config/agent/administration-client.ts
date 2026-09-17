// POST helpers for the voice administration, memory and automation routes,
// plus the two small helpers the authority panel shares with them.

export const terminalGoalStates = new Set(["satisfied", "cancelled", "expired", "failed"]);

export async function administrationAction(body: Record<string, unknown>) {
  const response = await fetch("/api/voice/administration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Administration request failed (${response.status})`);
}

export async function memoryAction(body: Record<string, unknown>) {
  const response = await fetch("/api/voice/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Memory request failed (${response.status})`);
}

export async function automationAction(body: Record<string, unknown>) {
  const response = await fetch("/api/voice/automations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Automation request failed (${response.status})`);
}

export function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
