import { expect, test, type Page } from "@playwright/test";
import { gotoConfig, gotoDashboard } from "./helpers";

// The theme editor section is rendered with `visibility: hidden` until the
// device theme finishes loading (themeReady), which removes it from the
// accessibility tree, so wait for the heading to become visible first.
async function waitForThemeEditor(page: Page) {
  const category = page.getByRole("button", { name: /Appearance & Dashboard/ });
  const section = page.getByRole("button", { name: "Theme & Experience" });
  const target = page.getByRole("heading", { name: "Theme Library" });
  await expect(async () => {
    if (!(await section.isVisible())) {
      await category.click();
    }
    await expect(section).toBeVisible({ timeout: 2_000 });
    if (!(await target.isVisible())) {
      await section.click();
    }
    await expect(target).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

// The demo theme lives in session storage (lib/demo-config/constants.ts), so a
// test can write a theme and reload without touching the host's own.
const DEMO_THEME_KEY = "nova.dashboard.demoTheme.v3";

test.describe("theme", () => {
  test("applies the device theme variables to the document", async ({ page }) => {
    await gotoDashboard(page);
    // accentColor seeds the cyber palette onto :root; a non-empty value proves
    // the theme bootstrap ran rather than falling back to the unstyled default.
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--cyber-cyan").trim(),
    );
    expect(accent).not.toEqual("");
  });

  test("renders the theme library controls", async ({ page }) => {
    await gotoConfig(page);
    await waitForThemeEditor(page);
    for (const action of ["Save", "Save As", "Duplicate"]) {
      await expect(page.getByRole("button", { name: action, exact: true })).toBeVisible();
    }
  });

  test("exposes dark and light theme editor tabs", async ({ page }) => {
    await gotoConfig(page);
    await waitForThemeEditor(page);
    await expect(page.getByRole("tab", { name: /Dark/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Light/ })).toBeVisible();
  });

  test("gives the unlock ring a colour of its own, beside the LED picker", async ({ page }) => {
    await openThemeColours(page);

    // In Theme Colours, right beside the LED Lights dial rather than loose in
    // the grid (Adeline, 2026-09-21).
    const ledCell = page.locator(".theme-widget-cell", { hasText: "LED Lights" }).first();
    const ringCell = page.locator(".theme-widget-cell", { hasText: "Unlock Ring" }).first();
    await expect(ledCell).toBeVisible();
    await expect(ringCell).toBeVisible();
    const ledBox = await ledCell.boundingBox();
    const ringBox = await ringCell.boundingBox();
    if (!ledBox || !ringBox) throw new Error("a colour cell has no box");
    expect(Math.abs(ringBox.y - ledBox.y)).toBeLessThanOrEqual(4);
    expect(ringBox.x).toBeGreaterThan(ledBox.x);

    // Store a ring colour beside a differently coloured set of lights and
    // reload: the theme loads both, the band paints in the ring's colour, and
    // the lights keep their own.
    await page.evaluate((key) => {
      const envelope = JSON.parse(window.sessionStorage.getItem(key) ?? "{}");
      const ring = { cursor: { x: 0, y: 0 }, intensity: 100, rgb: [0, 0, 255] };
      const lights = { cursor: { x: 0, y: 0 }, intensity: 100, rgb: [255, 0, 0] };
      for (const variant of ["dark", "light"]) {
        const theme = (envelope.theme.themes[variant] ??= {});
        theme.unlockRingColor = ring;
        theme.ledColor = lights;
      }
      window.sessionStorage.setItem(key, JSON.stringify(envelope));
    }, DEMO_THEME_KEY);
    await page.reload({ waitUntil: "domcontentloaded" });
    await openThemeColours(page);

    const painted = await ringCell.locator(".rotary-encoder").first().evaluate((dial) => {
      const band = dial.querySelector(".rotary-encoder-unlock-lit");
      const light = dial.querySelector('.rotary-encoder-led[data-lit="true"]');
      return {
        band: band ? getComputedStyle(band).backgroundImage : "",
        light: light ? getComputedStyle(light).backgroundImage : "",
        slot: getComputedStyle(document.documentElement).getPropertyValue("--nova-unlock-ring-color").trim(),
      };
    });
    expect(painted.slot).toBe("rgb(0 0 255)");
    expect(painted.band).toContain("rgb(0, 0, 255)");
    expect(painted.light).toContain("rgb(255, 0, 0)");
  });
});

// Theme Settings, then Theme Colours: the two levels the colour dials sit under.
// Both remember being open, and the category above them starts shut.
async function openThemeColours(page: Page) {
  await gotoConfig(page);
  const category = page.getByRole("button", { name: /Appearance & Dashboard/ });
  const levels = ["Theme & Experience", "Theme Settings", "Theme Colours"].map((name) =>
    page.locator(".config-accordion-trigger", { hasText: name }).first(),
  );
  await expect(async () => {
    if (!(await levels[0].isVisible())) await category.click();
    for (const level of levels) {
      await expect(level).toBeVisible({ timeout: 2_000 });
      if ((await level.getAttribute("aria-expanded")) !== "true") await level.click();
    }
    await expect(page.locator(".theme-widget-cell").first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}
