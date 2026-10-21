import { backendFor, orb, readout, realTaskEvents, seedTasks, shot, twoPages } from "./orb-dial.fixtures";
import { expect, test } from "@playwright/test";
import { readTasks } from "../lib/tasks";

// Status orb stack shared dismissal (specs/status-orb-stack.md, Round 2): a
// timer, a due reminder and a completed wash dismissed on one screen clear on
// the other. The reminder side runs the real server code in this process (see
// orb-dial.fixtures.ts). Opening and stepping the dial is in orb-dial.spec.ts.

test.describe("status orb dial", () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test.describe.configure({ mode: "serial" });

  test("tapping a finished timer dismisses it in two open browser contexts", async ({ browser }) => {
    seedTasks([]);
    const backend = backendFor(Date.now(), true);
    const { contexts, pages } = await twoPages(browser, backend);
    try {
      for (const page of pages) await expect(readout(page)).toHaveAttribute("data-nova-orb-info-module", "timer");
      await shot(pages[1], "05-timer-done-b");
      await orb(pages[0]).click();
      await expect(orb(pages[0])).toHaveAttribute("data-orb-dial", "closed");
      for (const page of pages) await expect(readout(page)).not.toHaveAttribute("data-nova-orb-info-module", "timer", { timeout: 8_000 });
      await shot(pages[1], "06-after-dismiss-b");
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test("a due reminder dismissed on one screen clears on the other through the real server", async ({ browser }) => {
    seedTasks([{ id: "bins", name: "Bins", start: new Date(Date.now() - 60_000).toISOString(), createdAt: new Date().toISOString(), source: "local" }]);
    const backend = backendFor(Date.now(), null);
    backend.entries.push({ id: "due", moduleId: "reminders-overdue", enabled: true, showOnlyWhenAlerting: true });
    const unsubscribe = realTaskEvents(backend);
    const { contexts, pages } = await twoPages(browser, backend);
    try {
      for (const page of pages) await expect(readout(page)).toHaveAttribute("data-nova-orb-info-module", "reminders-overdue");
      await orb(pages[1]).click();
      for (const page of pages) await expect(readout(page)).not.toHaveAttribute("data-nova-orb-info-module", "reminders-overdue", { timeout: 8_000 });
    } finally {
      unsubscribe();
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test("a completed wash dismissed on one screen clears on the other through the real server", async ({ browser }) => {
    // The wash sounds nothing of its own: its notification is an ordinary
    // household timer, set when the wash is claimed (specs/power-meters.md,
    // "The wash's timer"). What is left on this surface is the alert itself.
    seedTasks([{ id: "wash-done", name: "Washing machine", start: new Date(Date.now() - 20_000).toISOString(), createdAt: new Date().toISOString(), source: "local",
      moduleData: { "washing-machine": { sessionId: "s1", phase: "active" }, "discord-bot": { onDue: false, onComplete: false } } }]);
    const backend = backendFor(Date.now(), null);
    backend.entries = [{ id: "wash", moduleId: "washing", enabled: true }, { id: "clock", moduleId: "clock", enabled: true }];
    const unsubscribe = realTaskEvents(backend);
    const { contexts, pages } = await twoPages(browser, backend);
    try {
      for (const page of pages) await expect(readout(page)).toHaveAttribute("data-nova-orb-info-module", "washing");
      await orb(pages[1]).click();
      for (const page of pages) await expect(readout(page)).not.toHaveAttribute("data-nova-orb-info-module", "washing", { timeout: 8_000 });
      expect((await readTasks()).find((task) => task.id === "wash-done")?.alertDismissedAt).toBeTruthy();
    } finally {
      unsubscribe();
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
