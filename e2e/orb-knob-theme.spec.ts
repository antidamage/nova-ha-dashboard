import { expect, test, type Page } from "@playwright/test";
import { gotoConfig } from "./helpers";

// The Status Orb module's own settings (Theme Settings → Status Orb).
//
// The Tech module exposes `knobTheme`: a three-stop choice, Light / Auto /
// Dark, replacing the old boolean "Light knob" checkbox. It must render as a
// labelled slider — the same control the theme's own Knob Theme and Text Tone
// pickers use — with every stop named, not as a number.
//
// The orb's paint is a canvas, so the wiring is asserted where it is observable:
// the stop the control shows, and the `tech` group the control writes into the
// saved status-orb theme.

/** Open Theme Settings → Status Orb, and settle on the orb section. */
async function openStatusOrbConfig(page: Page) {
  const category = page.getByRole("button", { name: /Appearance & Dashboard/ });
  const section = page.getByRole("button", { name: "Theme & Experience" });
  await expect(async () => {
    if (!(await section.isVisible())) await category.click();
    await expect(section).toBeVisible({ timeout: 2_000 });
    await section.click();
  }).toPass({ timeout: 20_000 });

  const settings = page.getByRole("button", { name: "Theme Settings", exact: true });
  await expect(async () => {
    if (!(await settings.getAttribute("aria-expanded"))?.includes("true")) await settings.click();
    await expect(page.getByRole("heading", { name: "Theme Library" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  // "Status Orb" also names a breadcrumb crumb, so look inside the theme
  // editor's own tab panel for the accordion trigger.
  const panel = page.getByRole("tabpanel");
  const orb = panel.getByRole("button", { name: "Status Orb", exact: true });
  await expect(async () => {
    if (!(await orb.getAttribute("aria-expanded"))?.includes("true")) await orb.click();
    // The module picker's accessible name is the selected module's own name
    // ("Tech"), which is what the section opens on by default.
    await expect(panel.getByRole("button", { name: /^Tech/ })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Ensure the Tech module is the one on show. The section opens on the theme's
 * saved module, which is Tech on a default install — only open the listbox
 * when it is something else.
 */
async function selectTechModule(page: Page) {
  const trigger = page.getByRole("button", { name: /^Tech/ });
  if (await trigger.count() > 0) return;
  await page.locator(".theme-library-select .cyber-select-trigger").first().click();
  await page.getByRole("option", { name: /^Tech/ }).click();
}

/**
 * Edit the DARK variant. Which variant is open decides how legible the two
 * treatments are: the dark theme's orb gradient is black (its gradient slots
 * carry a low intensity), so the pale knob stands out sharply against it,
 * while the light theme's gradient is white and both treatments come out pale.
 */
async function selectDarkVariant(page: Page) {
  await page.getByRole("tab", { name: /^Dark/ }).click();
}

/**
 * The module's knob-theme control. Its accessible name carries the setting's
 * description, so match on the label's opening words rather than the whole
 * string.
 */
function knobThemeSlider(page: Page) {
  return page.getByRole("slider", { name: /^Knob Theme/ });
}

/**
 * Mean luminance (0-255) of the orb the config preview is drawing, sampled from
 * the canvas rather than from the model — the only way to show that a setting
 * changed the picture. The centre box lands inside the dome (the module draws
 * its knob face out to 0.761 of the orb's rim), and fully transparent pixels
 * are skipped so the page behind the orb does not dilute the reading.
 */
async function sampleOrbLuminance(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".nova-avatar-cfg-preview-host canvas");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    const box = Math.max(8, Math.round(canvas.width * 0.3));
    const x = Math.round((canvas.width - box) / 2);
    const y = Math.round((canvas.height - box) / 2);
    const { data } = ctx.getImageData(x, y, box, box);
    let total = 0;
    let counted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      total += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      counted += 1;
    }
    return counted === 0 ? null : total / counted;
  });
}

test.describe("status orb module settings", () => {
  test("the Tech module's knob theme is a named three-stop slider", async ({ page }) => {
    await gotoConfig(page);
    await openStatusOrbConfig(page);
    await selectTechModule(page);

    // The old control was a checkbox labelled "Light knob"; it must be gone.
    await expect(page.getByText("Light knob", { exact: true })).toHaveCount(0);

    // The choice renders as a labelled slider — the same control the theme's
    // own Knob Theme picker uses — whose accessible value is the stop itself.
    const slider = knobThemeSlider(page);
    await expect(slider).toBeVisible();
    await expect(slider).toHaveAttribute("aria-valuetext", /^(Light|Auto|Dark)$/);

    // Every stop is named on the track, so the stops read as choices rather
    // than as a magnitude. Scoped to this control's own panel.
    const panel = page.locator(".intensity-panel").filter({ has: slider });
    for (const stop of ["Light", "Auto", "Dark"]) {
      await expect(panel.getByText(stop, { exact: true }).first()).toBeVisible();
    }
  });

  test("moving the slider changes the stop it reports", async ({ page }) => {
    await gotoConfig(page);
    await openStatusOrbConfig(page);
    await selectTechModule(page);

    const slider = knobThemeSlider(page);
    const before = await slider.getAttribute("aria-valuetext");
    expect(["Light", "Auto", "Dark"]).toContain(before);

    // A choice slider has named stops: drive it to both ends and back one step.
    await slider.focus();
    await slider.press("Home");
    await expect(slider).toHaveAttribute("aria-valuetext", "Light");
    await slider.press("End");
    await expect(slider).toHaveAttribute("aria-valuetext", "Dark");
    await slider.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuetext", "Auto");
  });

  test("the knob theme changes the orb the preview paints", async ({ page }) => {
    await gotoConfig(page);
    await openStatusOrbConfig(page);
    // Pin the variant BEFORE choosing the module: the module and its saved
    // settings live on the variant, so the order matters.
    await selectDarkVariant(page);
    await selectTechModule(page);

    const slider = knobThemeSlider(page);
    await slider.focus();

    // The orb is a canvas, so this is the one place where the setting's effect
    // on the PICTURE is observable rather than merely modelled: a pale dome
    // against a near-black one, measured from what was actually drawn.
    await slider.press("Home");
    await expect(slider).toHaveAttribute("aria-valuetext", "Light");
    await page.waitForTimeout(500);
    const light = await sampleOrbLuminance(page);
    await page.waitForTimeout(500);
    const lightAgain = await sampleOrbLuminance(page);

    await slider.press("End");
    await expect(slider).toHaveAttribute("aria-valuetext", "Dark");
    await page.waitForTimeout(500);
    const dark = await sampleOrbLuminance(page);

    expect(light!, "the preview orb must have painted something to sample").not.toBeNull();
    expect(dark!, "the preview orb must have painted something to sample").not.toBeNull();
    // Idle samples of the same stop must agree, or the reading is animation
    // rather than the treatment and the comparison below would mean nothing.
    expect(Math.abs(light! - lightAgain!)).toBeLessThan(2);
    // The direction is what makes this evidence rather than a coincidence: the
    // light stop must draw a materially brighter dome than the dark stop.
    expect(light!).toBeGreaterThan(dark! + 40);

    // Auto is the shipped default, and following the device is its whole job:
    // this is the dark variant, whose knob skin resolves to dark, so Auto must
    // paint the dark dome rather than falling through to the pale one.
    await slider.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuetext", "Auto");
    await page.waitForTimeout(500);
    const auto = await sampleOrbLuminance(page);
    expect(auto, "the preview orb must have painted something to sample").not.toBeNull();
    expect(Math.abs(auto! - dark!)).toBeLessThan(20);
    expect(auto!).toBeLessThan(light! - 40);
  });
});
