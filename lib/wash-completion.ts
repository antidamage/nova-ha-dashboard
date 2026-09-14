import { callServiceWithResponse } from "./ha/client";
import { readDashboardConfigSync } from "./dashboard-config";
import type { HaState } from "./types";
import { readTasks, syncWashReminder } from "./tasks";
import { washReminder } from "./wash-reminder";
import { cycleId, type WashingMachineState } from "./washing-machine";
import { dryingRecommendation } from "./wash-drying";
import { emitModuleEvent } from "./modules/runtime/hooks";

export async function reconcileWashCompletion(state: WashingMachineState, states: Map<string, HaState>) {
  const config = readDashboardConfigSync();
  const alert = config.power.washingMachine?.completionAlert;
  const open = state.open;
  // A short, discarded cycle or a disabled configuration must not strand a waiting icon.
  for (const task of await readTasks()) {
    const reminder = washReminder(task);
    if (reminder?.phase === "waiting" && (!alert?.enabled || !open?.startedAt || reminder.sessionId !== cycleId(open.startedAt))) {
      await syncWashReminder(task.id, "", task.start, null);
    }
  }
  if (!alert?.enabled) return;
  const sessions = [...state.cycles, ...(open?.startedAt ? [{ ...open, id: cycleId(open.startedAt), startedAt: open.startedAt }] : [])];
  for (const session of sessions) {
    const finish = session.completion;
    const id = `wash-${session.id}`;
    const eligible = finish ? finish.person === alert.personId : session.person === alert.personId;
    if (!eligible) {
      if (open?.startedAt && session.id === cycleId(open.startedAt)) await syncWashReminder(id, "", session.startedAt, null);
      continue;
    }
    // Historical sessions with no finish marker never generate a reminder.
    if (!finish && (!open?.startedAt || session.id !== cycleId(open.startedAt))) continue;
    const person = config.dashboard.people.find((person) => person.id === alert.personId);
    await syncWashReminder(id, `${person?.label ?? "Claimed"} washing machine`, finish?.at ?? session.startedAt, {
      sessionId: session.id, phase: finish ? "active" : "waiting", soundFile: finish?.soundFile ?? alert.soundFile,
    });
    if (!finish?.discord) continue;
    // Only recent events are re-emitted; the Discord module owns persisted delivery deduplication.
    if (Date.now() - Date.parse(finish.at) > 24 * 3_600_000) continue;
    if (!finish.recommendation) {
      const weather = states.get(config.homeAssistant.weatherEntityId);
      const sun = states.get(config.homeAssistant.sunEntityId);
      finish.recommendation = "Hang it outside: No — I can't confirm a dry window.";
      if (weather && sun && !["unavailable", "unknown"].includes(weather.state)) {
        try {
          const result = await Promise.race([
            callServiceWithResponse<{ service_response?: Record<string, { forecast?: Record<string, unknown>[] }> }>("weather", "get_forecasts", { entity_id: weather.entity_id, type: "hourly" }),
            new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("Weather timeout")), 5000); timer.unref?.(); }),
          ]);
          finish.recommendation = dryingRecommendation(result.service_response?.[weather.entity_id]?.forecast ?? [],
            { state: sun.state, nextSetting: sun.attributes.next_setting }, Date.parse(finish.at), String(weather.attributes.precipitation_unit ?? "mm"), alert.drying);
          if (/rain|pouring|snow|hail|lightning/.test(weather.state)) finish.recommendation = "Hang it outside: No — wet weather right now.";
        } catch { /* The completion still reaches Discord with an explicit unknown forecast. */ }
      }
    }
    emitModuleEvent({ id: "washing-machine.completed", at: finish.at, source: "server", task: { id },
      reason: `Your washing is done. ${finish.recommendation}` });
  }
}
