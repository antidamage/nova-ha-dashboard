// The control-module seed shared by the panel slot e2e specs (panel-slots.spec.ts
// and panel-slots.modules.spec.ts). It is deliberately not a `*.spec.ts` file:
// Playwright collects those by glob, and a helper must not be collected as a
// spec of its own.
import { type Page } from "@playwright/test";

/**
 * The demo keeps its config in sessionStorage and merges what it finds there over
 * its own defaults, so a seed is the whole stored document with only the controls
 * block replaced. `mount` is given the derived controls and returns the block to
 * store.
 */
export async function seedControls(page: Page, mount: (controls: Record<string, unknown>) => unknown) {
  const controls = await page.evaluate(async () =>
    (await (await fetch("/api/control-modules")).json()).controls);
  const stored = await page.evaluate(() => window.sessionStorage.getItem("nova.dashboard.demoConfig.v2"));
  if (!stored) throw new Error("the demo config was not in sessionStorage to seed from");
  const document_ = JSON.parse(stored);
  document_.dashboard.controls = mount(controls);
  await page.addInitScript((value) => {
    window.sessionStorage.setItem("nova.dashboard.demoConfig.v2", JSON.stringify(value));
  }, document_);
  await page.reload({ waitUntil: "domcontentloaded" });
}
