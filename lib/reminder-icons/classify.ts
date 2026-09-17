// Fire-and-forget LLM refinement of a reminder's icon assignment.
//
// Deliberately kept separate from store.ts: this is the one part of the
// package that reaches the network (via voiceHost), and it must never block
// reminder creation or take the icon store down with it.

import { readDashboardConfig } from "../dashboard-config";
import { glyphsEqual } from "../reminder-glyph";
import { classifyReminderIcon } from "../voice-host-settings";
import { mutateEntries } from "./store";
import type { ReminderGlyph } from "../reminder-glyph";

/**
 * Keys with an LLM classification already in flight. Reminder sync re-runs
 * every ten minutes over the same names; without this, a voice host that is
 * merely slow would collect a new request per name per sync.
 */
const pendingClassifications = new Set<string>();

async function classifierSettings() {
  try {
    const config = await readDashboardConfig();
    return config.dashboard.reminders.classifier;
  } catch {
    return { enabled: true, timeoutMs: 4000 };
  }
}

/**
 * Fire-and-forget LLM refinement. Only ever upgrades a "keyword"/"fallback"
 * assignment; a user's own choice is never overwritten, and neither is an
 * answer we already got from the LLM.
 */
export function scheduleClassification(key: string, displayName: string) {
  if (pendingClassifications.has(key)) {
    return;
  }
  pendingClassifications.add(key);

  void (async () => {
    try {
      const settings = await classifierSettings();
      if (!settings.enabled) {
        return;
      }

      const iconId = await classifyReminderIcon(displayName, settings.timeoutMs);
      if (!iconId) {
        return;
      }

      await mutateEntries((entries) => {
        const index = entries.findIndex((entry) => entry.key === key);
        if (index < 0) {
          return { entries, result: undefined, changed: false };
        }

        const current = entries[index];
        if (current.source === "user" || current.source === "llm") {
          return { entries, result: undefined, changed: false };
        }

        const glyph: ReminderGlyph = { kind: "phosphor", id: iconId };
        if (glyphsEqual(current.glyph, glyph)) {
          // Same answer the keyword table already gave. Still record that the
          // LLM has spoken so we stop asking about this name every sync.
          return {
            entries: entries.map((entry) =>
              entry.key === key ? { ...entry, source: "llm" as const } : entry,
            ),
            result: undefined,
          };
        }

        return {
          entries: entries.map((entry) =>
            entry.key === key ? { ...entry, glyph, source: "llm" as const } : entry,
          ),
          result: undefined,
        };
      });
    } catch (error) {
      console.error("[nova-dashboard] Reminder icon classification failed", { key, error });
    } finally {
      pendingClassifications.delete(key);
    }
  })();
}
