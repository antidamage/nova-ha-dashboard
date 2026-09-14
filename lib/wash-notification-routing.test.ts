import { beforeEach, expect, it, vi } from "vitest";
import type { WashingMachineState } from "./washing-machine";

const mocks = vi.hoisted(() => ({ emit: vi.fn(), sync: vi.fn(), forecast: vi.fn() }));
vi.mock("./modules/runtime/hooks", () => ({ emitModuleEvent: mocks.emit }));
vi.mock("./tasks", () => ({ readTasks: async () => [], syncWashReminder: mocks.sync }));
vi.mock("./ha/client", () => ({ callServiceWithResponse: mocks.forecast }));
vi.mock("./dashboard-config", () => ({ readDashboardConfigSync: () => ({
  power: { washingMachine: { completionAlert: { enabled: true, personId: "owner", soundFile: "done.mp3" } } },
  dashboard: { people: [{ id: "owner", label: "Owner" }] },
  homeAssistant: { weatherEntityId: "weather.test", sunEntityId: "sun.sun" },
}) }));
import { reconcileWashCompletion } from "./wash-completion";

function completed(person: string | null = "owner"): WashingMachineState {
  const at = new Date().toISOString();
  return { version: 1, open: null, cycles: [{
    id: "test-session", startedAt: at, endedAt: at, person, kwh: 0.3, costNzd: 0.1,
    completion: { at, person, soundFile: "done.mp3", discord: true,
      recommendation: "Hang it outside: Yes — a dry four-hour window is forecast." },
  }] };
}

beforeEach(() => vi.clearAllMocks());
it("routes the enriched completion through the installed generic reminder hook", async () => {
  const state = completed();
  await reconcileWashCompletion(state, new Map());
  expect(mocks.emit).toHaveBeenCalledWith({
    id: "reminder.due", at: state.cycles[0].completion!.at, source: "server",
    task: { id: "wash-test-session", name: "Your washing is done. Hang it outside: Yes — a dry four-hour window is forecast.",
      moduleData: { "discord-bot": { onDue: true, onComplete: false } } },
  });
  expect(mocks.forecast).not.toHaveBeenCalled();
  await reconcileWashCompletion(state, new Map());
  // Discord's existing deduplication sees the same id and occurrence time after retries/restarts.
  expect(mocks.emit.mock.calls[1][0]).toEqual(mocks.emit.mock.calls[0][0]);
});
it("does not notify for someone else's wash or historical attribution", async () => {
  await reconcileWashCompletion(completed("other"), new Map());
  const history = completed(); delete history.cycles[0].completion;
  await reconcileWashCompletion(history, new Map());
  expect(mocks.emit).not.toHaveBeenCalled();
});
it("honours the per-completion Discord flag", async () => {
  const state = completed(); state.cycles[0].completion!.discord = false;
  await reconcileWashCompletion(state, new Map());
  expect(mocks.emit).not.toHaveBeenCalled();
});
