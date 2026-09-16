// Scratch data paths for the orb dial spec, set BEFORE lib/tasks is imported:
// those module-level path constants are read at import time, and the test must
// never touch the developer's real data/ files. Imported first by the spec.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const ORB_TEST_SCRATCH = "C:/Users/Addie/AppData/Local/Temp/claude/D--Projects-Agent/d06ad3c0-bb72-49ae-9fe9-8f78a8300965/scratchpad";
const data = path.join(ORB_TEST_SCRATCH, "orb-e2e-data", `w${process.pid}`);
mkdirSync(data, { recursive: true });
process.env.NOVA_DASHBOARD_TASKS = path.join(data, "tasks.json");
process.env.NOVA_DASHBOARD_PREFERENCES = path.join(data, "preferences.json");
process.env.NOVA_EVENTS_DIR = path.join(data, "events");
process.env.NOVA_DASHBOARD_HOUSEHOLD_EVENTS = path.join(data, "household-events.jsonl");
process.env.NOVA_ORB_TIMER_FILE = path.join(data, "orb-timer.json");
writeFileSync(process.env.NOVA_DASHBOARD_TASKS, JSON.stringify({ tasks: [] }));
// The wash chime repeats only while a washing entry is configured.
writeFileSync(process.env.NOVA_DASHBOARD_PREFERENCES, JSON.stringify({ orbInfo: { entries: [{ id: "wash", moduleId: "washing", enabled: true }] } }));
