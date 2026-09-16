import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoDashboard, selectZone, waitForStableLayout } from "./helpers";

// Reminders sub-panel, round 2 (specs/tasks-panel.md): only the timer above the
// line; Add and Edit replace the lists with an editor under a back arrow; Save
// reachable without scrolling the page; an icon chosen in the editor is the
// reminder bar's tile glyph.

test.describe.configure({ timeout: 120_000 });

const SHOTS = process.env.NOVA_REMINDERS_SHOTS;
const FOLD = ".tasks-stage .tasks-panel .advanced-fold";

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function openReminders(page: Page) {
  await gotoDashboard(page);
  await waitForStableLayout(page);
  await selectZone(page, /Reminders/);
  const fold = page.locator(`${FOLD}:not([data-foldless])`);
  await expect(fold).toBeVisible({ timeout: 30_000 });
  return fold;
}

/** Drag from the divider past the break, along the fold's axis. */
async function openFold(page: Page, fold: Locator) {
  const axis = await fold.getAttribute("data-axis");
  await fold.evaluate((el, y) => {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    if (y) el.scrollTop = el.scrollHeight;
    else el.scrollLeft = el.scrollWidth;
  }, axis === "y");
  await expect.poll(() => fold.evaluate((el) => el.style.touchAction !== "")).toBe(true);
  const divider = await fold.locator(":scope > .advanced-fold-track > .advanced-fold-divider").boundingBox();
  if (!divider) throw new Error("divider not rendered");
  const x = divider.x + divider.width / 2;
  const y = divider.y + divider.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(axis === "y" ? x : x - 200, axis === "y" ? y - 200 : y, { steps: 14 });
  await page.mouse.up();
  await expect(fold).toHaveAttribute("data-open", "true");
}

async function inViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const size = page.viewportSize()!;
  return Boolean(box && box.y >= 0 && box.x >= 0 && box.y + box.height <= size.height && box.x + box.width <= size.width);
}

for (const viewport of [
  { width: 430, height: 932 },
  { width: 820, height: 1180 },
  { width: 1366, height: 768 },
]) {
  test.describe(`reminders editor ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("only the timer sits above the line", async ({ page }) => {
      const fold = await openReminders(page);
      const def = fold.locator(":scope > .advanced-fold-track > .advanced-fold-default");
      await expect(def.getByRole("button", { name: /Add|Edit|Import|Export/ })).toHaveCount(0);
      await expect(def.locator("[data-task-list]")).toHaveCount(0);
      await expect(page.locator(".tasks-panel > header button")).toHaveCount(0);
      await expect(fold.locator(".advanced-fold-advanced")).toHaveCount(0);
      await shot(page, `${viewport.width}-closed`);

      await openFold(page, fold);
      const advanced = fold.locator(".advanced-fold-advanced");
      await expect(advanced.getByRole("button", { name: "Add" })).toBeVisible();
      await expect(advanced.locator('[data-task-list="today"]')).toHaveCount(1);
      await shot(page, `${viewport.width}-open`);
    });

    test("Add replaces the lists, Save stays reachable, Back returns", async ({ page }) => {
      const fold = await openReminders(page);
      await openFold(page, fold);
      const advanced = fold.locator(".advanced-fold-advanced");
      await advanced.getByRole("button", { name: "Add" }).click();

      await expect(advanced.locator('[data-tasks-view="editor"]')).toBeVisible();
      await expect(advanced.locator("[data-task-list]")).toHaveCount(0);
      await expect(advanced.getByRole("button", { name: "Add" })).toHaveCount(0);
      await expect(advanced.getByRole("button", { name: "Back" })).toBeVisible();

      const scrollY = await page.evaluate(() => window.scrollY);
      const create = advanced.getByRole("button", { name: "Create" });
      await expect.poll(() => inViewport(page, create)).toBe(true);
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
      await shot(page, `${viewport.width}-add`);

      await advanced.getByRole("button", { name: "Back" }).click();
      await expect(advanced.locator('[data-tasks-view="lists"]')).toBeVisible();
      await expect(advanced.locator('[data-task-list="today"]')).toHaveCount(1);
      await expect(advanced.locator(".task-inline-editor")).toHaveCount(0);
    });

    test("an icon chosen in the editor becomes the reminder bar's tile glyph", async ({ page }) => {
      const name = "Water the balcony plants";
      const fold = await openReminders(page);
      const tile = page.locator(`.reminder-tile[aria-label^="${name}"]`);
      await expect(tile).toHaveCount(1);
      await expect(tile.locator(".reminder-glyph-text")).toHaveCount(0);

      await openFold(page, fold);
      const advanced = fold.locator(".advanced-fold-advanced");
      await advanced.locator(".task-row-main", { hasText: name }).click();
      await expect(advanced.locator("[data-task-list]")).toHaveCount(0);
      await advanced.getByRole("button", { name: /^Icon:/ }).click();
      const picker = page.getByRole("dialog", { name: `Icon for ${name}` });
      await picker.getByPlaceholder("E", { exact: true }).fill("W");
      await picker.getByRole("button", { name: "Use this" }).click();
      await expect(advanced.locator(".task-editor-icon .reminder-glyph-text")).toHaveText("W");
      await shot(page, `${viewport.width}-edit`);
      const save = advanced.getByRole("button", { name: "Save" });
      await expect.poll(() => inViewport(page, save)).toBe(true);
      await save.click();

      await expect(advanced.locator('[data-tasks-view="lists"]')).toBeVisible();
      await expect(tile.locator(".reminder-glyph-text")).toHaveText("W");
    });
  });
}
