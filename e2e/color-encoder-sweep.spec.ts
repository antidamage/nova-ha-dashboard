import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { hsvToRgb } from "../app/components/colorEncoderModel";
import { gotoDashboard } from "./helpers";

// The sweep smoke test from specs/color-encoder.md ("Done means"). Drives the
// zone dial through brightness and saturation 0→100→0 in 10% steps and hue
// through 360° in 30° steps, and at every step checks the dial's value, the
// command it sent, and the ring's rendered pixel against the expected HSV. It
// runs twice: normally, and with Chromium's forced dark mode — the Brave flag
// that turned the ring dark on a desaturated bright colour. Commands go to the
// demo-mode data shim; nothing reaches Home Assistant. COLOR_ENCODER_SHOTS=<dir>
// keeps a screenshot of the dial at every step for the visual check.

const SHOTS = process.env.COLOR_ENCODER_SHOTS;
/** Per-channel tolerance for the sampled ring pixel: hue is read back rounded. */
const RING_TOLERANCE = 5;
/** px of drag per 10% of brightness or saturation (1/3 %/px). */
const STEP_PX = 30;
/** px of drag per 30° of hue (0.5°/px). */
const HUE_STEP_PX = 60;

type Command = { action: string; brightnessPct?: number; rgb?: [number, number, number] };

async function recordCommands(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __zoneCommands: unknown[]; fetch: typeof fetch };
    w.__zoneCommands = [];
    const inner = w.fetch.bind(window);
    w.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/zone") && init?.body) w.__zoneCommands.push(JSON.parse(String(init.body)));
      return inner(input, init);
    };
  });
}

async function commandCount(page: Page) {
  return page.evaluate(() => (window as unknown as { __zoneCommands: unknown[] }).__zoneCommands.length);
}

async function lastCommand(page: Page) {
  return page.evaluate(() => {
    const list = (window as unknown as { __zoneCommands: Command[] }).__zoneCommands;
    return list[list.length - 1];
  });
}

async function turn(page: Page, dial: Locator, px: number) {
  const box = await dial.boundingBox();
  if (!box) throw new Error("dial has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + px, y, { steps: Math.max(3, Math.round(Math.abs(px) / 10)) });
  await page.mouse.up();
}

async function angle(root: Locator) {
  return root.evaluate((node) => (node as HTMLElement).style.getPropertyValue("--ce-angle"));
}

async function selectChannel(dial: Locator, channel: string) {
  for (let index = 0; index < 4 && (await dial.getAttribute("data-channel")) !== channel; index += 1) {
    await dial.click();
  }
  await expect(dial).toHaveAttribute("data-channel", channel);
}

async function readChannel(dial: Locator, channel: string) {
  await selectChannel(dial, channel);
  return Number(await dial.getAttribute("aria-valuenow"));
}

/**
 * The ring's painted colour, sampled from a screenshot at mid-cross-section on
 * the 3 o'clock side. The shading, bevels and glow are hidden for the sample so
 * it reads the ring fill itself — which is exactly what auto dark mode repaints.
 */
async function sampleRing(page: Page, root: Locator): Promise<[number, number, number]> {
  const ring = await root.locator(".color-encoder-ring").boundingBox();
  if (!ring) throw new Error("ring has no box");
  const style = await page.addStyleTag({
    content: `.color-encoder-ring-shade,.color-encoder-inner-bevel,.color-encoder-outer-bevel,.color-encoder-glow,.lighting-tint-overlay{visibility:hidden!important}`,
  });
  const radius = (ring.width / 2) * ((0.833 + 1) / 2);
  const x = Math.round(ring.x + ring.width / 2 + radius) - 1;
  const y = Math.round(ring.y + ring.height / 2) - 1;
  const png = await page.screenshot({ clip: { x, y, width: 3, height: 3 }, animations: "disabled", scale: "css" });
  await style.evaluate((node) => (node as HTMLStyleElement).remove());
  return page.evaluate(async (b64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(image, 0, 0);
    const [r, g, b] = context.getImageData(1, 1, 1, 1).data;
    return [r, g, b] as [number, number, number];
  }, png.toString("base64"));
}

function expectClose(actual: number[], expected: number[], tolerance: number, what: string) {
  const off = actual.some((value, index) => Math.abs(value - expected[index]) > tolerance);
  expect(off, `${what}: got rgb(${actual.join(", ")}), expected rgb(${expected.join(", ")}) ±${tolerance}`).toBe(false);
}

async function shot(root: Locator, run: string, name: string) {
  if (!SHOTS) return;
  const dir = path.join(SHOTS, run);
  fs.mkdirSync(dir, { recursive: true });
  await root.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled" });
}

async function sweep(page: Page, run: string) {
  await gotoDashboard(page);
  // The page opts out of auto dark mode (app/layout.tsx); without that the
  // forced-dark run below repaints pale ring colours dark.
  const scheme = await page.evaluate(() => ({
    meta: document.querySelector('meta[name="color-scheme"]')?.getAttribute("content") ?? null,
    root: getComputedStyle(document.documentElement).colorScheme,
    body: getComputedStyle(document.body).colorScheme,
  }));
  // The ring itself must resolve to dark: auto dark mode decides per element.
  const ringScheme = await page.locator(".zone-panel .color-encoder-ring").evaluate((node) => getComputedStyle(node).colorScheme);
  expect({ ...scheme, ring: ringScheme }, JSON.stringify({ ...scheme, ring: ringScheme })).toMatchObject({ meta: "dark", root: "dark", ring: "dark" });
  await recordCommands(page);
  const dial = page.locator(".zone-panel").getByLabel("Zone lights");
  const root = page.locator(".zone-panel .zone-color-encoder .color-encoder");
  await dial.scrollIntoViewIfNeeded();

  // A bright, saturated start: both clamped channels pinned at 100.
  await selectChannel(dial, "brightness");
  await turn(page, dial, 400);
  await expect(dial).toHaveAttribute("aria-valuenow", "100");
  await selectChannel(dial, "saturation");
  await turn(page, dial, 400);
  await expect(dial).toHaveAttribute("aria-valuenow", "100");
  const hue = await readChannel(dial, "hue");

  // Pushing past an end turns neither the value nor the rotor.
  await selectChannel(dial, "saturation");
  const pinned = await angle(root);
  await turn(page, dial, 120);
  await expect(dial).toHaveAttribute("aria-valuenow", "100");
  expect(await angle(root)).toBe(pinned);

  let v = 100;
  let s = 100;
  const check = async (channel: string, h: number, label: string) => {
    const expectedRing = hsvToRgb(h, s, v);
    expectClose(await sampleRing(page, root), expectedRing, RING_TOLERANCE, `${run} ring at ${label}`);
    const command = await lastCommand(page);
    if (channel === "brightness") {
      expect(command, `${label} command`).toMatchObject({ action: "brightness", brightnessPct: v });
    } else {
      expect(command.action, `${label} command`).toBe("color");
      expect(command.brightnessPct, `${label} command brightness`).toBe(v || 100);
      expectClose(command.rgb ?? [], hsvToRgb(h, s, 100), 3, `${label} command rgb`);
    }
    await shot(root, run, label);
  };

  const step = async (channel: "saturation" | "brightness", target: number, h: number) => {
    const sent = await commandCount(page);
    await turn(page, dial, (target - (channel === "saturation" ? s : v)) / 10 * STEP_PX);
    if (channel === "saturation") s = target;
    else v = target;
    await expect(dial).toHaveAttribute("aria-valuenow", String(target));
    await expect.poll(() => commandCount(page)).toBeGreaterThan(sent);
    await check(channel, h, `${channel}-${String(target).padStart(3, "0")}-${sent}`);
  };

  // Saturation 100 → 0 → 100 at full brightness: the ring must whiten, never darken.
  await selectChannel(dial, "saturation");
  for (let target = 90; target >= 0; target -= 10) await step("saturation", target, hue);
  // Pinned at zero: further turning moves nothing.
  const atZero = await angle(root);
  await turn(page, dial, -120);
  await expect(dial).toHaveAttribute("aria-valuenow", "0");
  expect(await angle(root)).toBe(atZero);
  for (let target = 10; target <= 100; target += 10) await step("saturation", target, hue);

  // Brightness 100 → 0 → 100 at full saturation.
  await selectChannel(dial, "brightness");
  for (let target = 90; target >= 0; target -= 10) await step("brightness", target, hue);
  for (let target = 10; target <= 100; target += 10) await step("brightness", target, hue);

  // Hue once round in 30° steps, and it keeps going past 360.
  await selectChannel(dial, "hue");
  let h = hue;
  const hueStart = await angle(root);
  for (let index = 1; index <= 12; index += 1) {
    const sent = await commandCount(page);
    await turn(page, dial, HUE_STEP_PX);
    h = (h + 30) % 360;
    await expect(dial).toHaveAttribute("aria-valuenow", String(Math.round(h) % 360));
    await expect.poll(() => commandCount(page)).toBeGreaterThan(sent);
    await check("hue", h, `hue-${String(index * 30).padStart(3, "0")}`);
  }
  expect(parseFloat(await angle(root)) - parseFloat(hueStart)).toBeCloseTo(360, 1);
}

test.describe("colour encoder sweep", () => {
  test("values, commands and ring along the rotation", async ({ page }) => {
    test.setTimeout(600_000);
    await sweep(page, "normal");
  });
});

test.describe("colour encoder sweep under forced dark mode", () => {
  test("the ring shows its true colour with auto dark mode on", async ({ playwright, baseURL }) => {
    test.setTimeout(600_000);
    // Chromium's real auto dark mode feature — exactly what Brave's "Auto
    // Dark Mode for Web Contents" flag switches on. It needs the full browser
    // (channel "chromium"): the headless shell ignores it, and the older
    // --blink-settings switch does not make the browser report dark, so pages
    // that declare dark are repainted anyway. No colorScheme emulation, so the
    // page sees what the flag reports. A launch flag, so this test owns its
    // browser.
    const browser = await playwright.chromium.launch({
      channel: "chromium",
      args: ["--enable-features=WebContentsForceDark"],
    });
    try {
      const context = await browser.newContext({ baseURL, colorScheme: null });
      await sweep(await context.newPage(), "forced-dark");
    } finally {
      await browser.close();
    }
  });
});

