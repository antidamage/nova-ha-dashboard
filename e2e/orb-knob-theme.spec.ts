import { expect, test, type Page } from "@playwright/test";
import { gotoConfig } from "./helpers";

// The status orb's knob light/dark choice — a setting the ORB module declares
// (the built-in Tech module calls it `knobTheme`), drawn just below the theme's
// own Knob Theme control.
//
// It used to sit in the orb's "Module options" group. It is hoisted out of
// there now, so the pair reads as one decision: the control above it skins
// every dial, this one skins the orb's knob. That makes two things worth
// asserting — that it is the same kind of control as its neighbour, and that
// the orb group no longer shows a second copy of it.
//
// The orb itself is a canvas, so its effect is asserted from the pixels it
// actually drew rather than from the resolved model.

/** Open Theme & Experience → Theme Settings, where the pair sits. */
async function openThemeSettings(page: Page) {
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
}

/**
 * Edit the DARK variant. Which variant is open decides how legible the two
 * treatments are: the dark theme's orb gradient is near-black, so the pale knob
 * stands out sharply, while the light theme's gradient is white. (The two
 * treatments no longer depend on the theme's gradient at all — that was the
 * bug this file's pixel test covers — so this only affects the surrounding
 * panel, not the orb's own paint.)
 */
async function selectDarkVariant(page: Page) {
  await page.getByRole("tab", { name: /^Dark/ }).click();
}

/** Mount the orb accordion, which is what renders the preview canvas. */
async function openStatusOrbSection(page: Page) {
  const panel = page.getByRole("tabpanel");
  const orb = panel.getByRole("button", { name: "Status Orb", exact: true });
  await expect(async () => {
    if (!(await orb.getAttribute("aria-expanded"))?.includes("true")) await orb.click();
    await expect(page.getByRole("button", { name: /^Tech/ })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** The orb's knob tone slider. */
function knobToneSlider(page: Page) {
  return page.getByRole("slider", { name: /^Orb Knob Tone/ });
}

/** The theme's own knob skin slider, the control it is meant to sit under. */
function knobSkinSlider(page: Page) {
  return page.getByRole("slider", { name: /^Knob theme/ });
}

/**
 * Mean luminance (0-255) of the orb the config preview is drawing, sampled from
 * the canvas. The centre box lands inside the dome (the module draws its knob
 * face out to 0.761 of the orb's rim), and fully transparent pixels are skipped
 * so the page behind the orb does not dilute the reading.
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

test.describe("status orb knob tone", () => {
  test("sits under the theme's own knob control, as the same kind of slider", async ({ page }) => {
    await gotoConfig(page);
    await openThemeSettings(page);
    await selectDarkVariant(page);

    const skin = knobSkinSlider(page);
    const tone = knobToneSlider(page);
    await expect(skin).toBeVisible();
    await expect(tone).toBeVisible();
    await expect(tone).toHaveAttribute("aria-valuetext", /^(Light|Auto|Dark)$/);

    // Directly beneath it, not merely somewhere later on the page.
    const skinBox = (await skin.boundingBox())!;
    const toneBox = (await tone.boundingBox())!;
    expect(toneBox.y).toBeGreaterThan(skinBox.y);

    // Every stop is named on the track, so the stops read as choices rather
    // than as a magnitude.
    const panel = page.locator(".intensity-panel").filter({ has: tone });
    for (const stop of ["Light", "Auto", "Dark"]) {
      await expect(panel.getByText(stop, { exact: true }).first()).toBeVisible();
    }
  });

  test("is not also shown in the orb's module options", async ({ page }) => {
    await gotoConfig(page);
    await openThemeSettings(page);
    await selectDarkVariant(page);
    await expect(knobToneSlider(page)).toBeVisible();

    // Opening the orb section mounts its options group; the hoisted setting
    // must still appear exactly once on the page.
    await openStatusOrbSection(page);
    await expect(knobToneSlider(page)).toHaveCount(1);
    await expect(page.getByText("Orb Knob Tone", { exact: true })).toHaveCount(1);
  });

  test("reports each stop as it moves", async ({ page }) => {
    await gotoConfig(page);
    await openThemeSettings(page);
    await selectDarkVariant(page);

    const tone = knobToneSlider(page);
    await tone.scrollIntoViewIfNeeded();
    await tone.focus();
    await tone.press("Home");
    await expect(tone).toHaveAttribute("aria-valuetext", "Light");
    await tone.press("End");
    await expect(tone).toHaveAttribute("aria-valuetext", "Dark");
    await tone.press("ArrowLeft");
    await expect(tone).toHaveAttribute("aria-valuetext", "Auto");
  });

  test("paints a dark orb for Dark on the LIGHT theme, where it used to paint light", async ({ page }) => {
    await gotoConfig(page);
    await openThemeSettings(page);
    // The light variant is the one this exists for: the dark treatment used to
    // read its colours from the theme's gradient slots, which are white there,
    // so Dark drew a white orb and the two stops were indistinguishable.
    await page.getByRole("tab", { name: /^Light/ }).click();
    await openStatusOrbSection(page);

    const tone = knobToneSlider(page);
    await tone.scrollIntoViewIfNeeded();
    await tone.focus();

    await tone.press("Home");
    await expect(tone).toHaveAttribute("aria-valuetext", "Light");
    await page.waitForTimeout(500);
    const light = await sampleOrbLuminance(page);

    await tone.press("End");
    await expect(tone).toHaveAttribute("aria-valuetext", "Dark");
    await page.waitForTimeout(500);
    const dark = await sampleOrbLuminance(page);

    expect(light, "the preview orb must have painted something to sample").not.toBeNull();
    expect(dark, "the preview orb must have painted something to sample").not.toBeNull();
    // Light must be pale and Dark must actually be dark, on the same theme.
    expect(light!).toBeGreaterThan(dark! + 40);
    expect(dark!).toBeLessThan(120);
  });
});
