import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoDashboard, waitForStableLayout } from "./helpers";

// Every lighting automation is a rule (specs/zone-light-events.md, round 2):
// the preset row is On, the shown rules in order, Off; a rule's button applies
// its value; and this section's labels take the panel's text colour.
const SHOTS = "C:/Users/Addie/AppData/Local/Temp/claude/D--Projects-Agent/d06ad3c0-bb72-49ae-9fe9-8f78a8300965/scratchpad/shots-lighting";
const RULES_KEY = "nova.dashboard.demoZoneRules.v1";
const THEME_KEY = "nova.dashboard.themeOverride.v1";
const PRESETS = ".zone-panel .zone-lighting-presets";

test.describe.configure({ timeout: 120_000 });

/** Seed the demo rule store before the page scripts run. */
async function seedRules(page: Page, rules: unknown[], seededZoneIds: string[]) {
  await page.evaluate(([key, value]) => {
    window.sessionStorage.setItem(key as string, value as string);
  }, [RULES_KEY, JSON.stringify({ store: { rules, seededZoneIds }, switchOnEntityIds: [] })] as const);
}

/** The id of the zone whose card is showing, from the demo state. */
async function zoneId(page: Page) {
  return page.evaluate(async () => {
    const state = await (await fetch("/api/state")).json() as { zones?: Array<{ id: string; name: string }> };
    const title = document.querySelector(".zone-panel-title")?.textContent?.trim();
    return state.zones?.find((zone) => zone.name === title)?.id ?? state.zones?.[0]?.id ?? "";
  });
}

function luminance(color: string) {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? ["255", "255", "255"]).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pull the lighting card's Advanced section open, as advanced-fold.spec does. */
async function openAdvanced(page: Page, fold: Locator) {
  await fold.evaluate((el) => {
    el.scrollIntoView({ inline: "center", block: "nearest", behavior: "instant" });
    el.scrollTop = el.scrollHeight;
  });
  const divider = await fold.locator(":scope > .advanced-fold-track > .advanced-fold-divider").boundingBox();
  if (!divider) throw new Error("divider not rendered");
  const x = divider.x + divider.width / 2;
  const y = divider.y + divider.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 260, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => fold.evaluate((el) => el.dataset.open), { timeout: 10_000 }).toBe("true");
}

test("the preset row is On, the zone's presets in order, then Off", async ({ page }) => {
  await gotoDashboard(page);
  const buttons = page.locator(`${PRESETS} button`);
  await expect(buttons.first()).toBeVisible();
  const labels = await buttons.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ""));
  expect(labels[0]).toBe("On");
  expect(labels[labels.length - 1]).toBe("Off");
  expect(labels.slice(1, -1)).toEqual(["Adaptive", "White"]);
  await page.screenshot({ path: `${SHOTS}/preset-row-default.png` });
});

test("a custom preset rule shows between On and Off with its icon, and applies its value", async ({ page }) => {
  await gotoDashboard(page);
  const zone = await zoneId(page);
  const fresh = page;
  await seedRules(fresh, [
    { id: "adaptive-" + zone, zoneId: zone, name: "Adaptive", enabled: true, kind: "adaptive", preset: { show: true, order: 1 } },
    { id: "white-" + zone, zoneId: zone, name: "White", enabled: true, kind: "preset", value: { hue: 0, saturation: 0, brightnessPct: 100 }, preset: { show: true, order: 2 } },
    {
      id: "preset-dusk", zoneId: zone, name: "Dusk", enabled: true, kind: "preset",
      value: { hue: 120, saturation: 100, brightnessPct: 37 },
      preset: { show: true, order: 3, icon: { kind: "phosphor", id: "moon" } },
    },
  ], [zone]);
  // sessionStorage survives a reload in the same tab, so the seeded rules are
  // in place before the card mounts.
  await fresh.reload();
  await gotoDashboard(fresh);

  const buttons = fresh.locator(`${PRESETS} button`);
  await expect(buttons.first()).toBeVisible();
  await expect.poll(async () => buttons.count(), { timeout: 15_000 }).toBe(5);
  const labels = await buttons.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ""));
  expect(labels).toEqual(["On", "Adaptive", "White", "Dusk", "Off"]);
  // The chosen glyph renders on the button rather than a kind default.
  await expect(fresh.locator(`${PRESETS} button:has-text("Dusk") .zone-rule-glyph svg`)).toHaveCount(1);

  const dial = fresh.locator(".zone-panel").getByLabel("Zone lights");
  await fresh.locator(`${PRESETS} button:has-text("Dusk")`).click();
  await expect.poll(async () => Number(await dial.getAttribute("aria-valuenow")), { timeout: 10_000 }).toBe(37);
  await fresh.screenshot({ path: `${SHOTS}/preset-row-custom.png` });
});

test("the lighting rules section reads dark on a light theme panel", async ({ page }) => {
  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key as string, value as string);
  }, [THEME_KEY, "light"] as const);
  await gotoDashboard(page);
  await waitForStableLayout(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.themeVariant ?? ""), { timeout: 20_000 }).toBe("light");

  const fold = page.locator(".zone-panel[data-lighting-zone] .advanced-fold").first();
  await openAdvanced(page, fold);
  const label = page.locator(".zone-light-events .zone-lighting-label").first();
  await expect(label).toBeVisible();
  const color = await label.evaluate((el) => getComputedStyle(el).color);
  await page.screenshot({ path: `${SHOTS}/rules-light-theme.png` });
  expect(luminance(color), `label colour ${color} on a light panel`).toBeLessThan(128);
});
