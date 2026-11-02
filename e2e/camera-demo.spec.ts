import { expect, test } from "@playwright/test";
import { gotoDashboard, selectZone } from "./helpers";

// The demo's camera panel runs the real player against the provider's rolling
// sample feed (docs/camera-dvr.md).
test("the sample feed plays live, and the jog runs it backwards until Live", async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await gotoDashboard(page);
  await selectZone(page, /Outside/);
  const panel = page.locator(".camera-panel").first();
  await panel.scrollIntoViewIfNeeded();
  const video = panel.locator("video").first();
  const position = () => video.evaluate((node: HTMLVideoElement) => node.currentTime);

  await expect.poll(position, { timeout: 30_000 }).toBeGreaterThan(0);
  const pill = panel.locator(".camera-live-pill");
  await expect(pill).toHaveText("LIVE");
  await expect(panel.locator(".camera-source-badge")).toHaveText("Sample Feed");
  const playing = await position();
  await expect.poll(position).toBeGreaterThan(playing);

  const dial = panel.getByLabel("Playback jog");
  const box = await dial.boundingBox();
  if (!box) throw new Error("no jog dial");
  const at = (degrees: number) => {
    const radius = box.width * 0.34;
    const radians = (degrees * Math.PI) / 180;
    return [box.x + box.width / 2 + radius * Math.sin(radians), box.y + box.height / 2 - radius * Math.cos(radians)] as const;
  };
  await page.mouse.move(...at(0));
  await page.mouse.down();
  for (let degrees = -6; degrees >= -200; degrees -= 6) await page.mouse.move(...at(degrees));
  await page.mouse.up();

  await expect(pill).toHaveText(/^-\d+m \d+s$/, { timeout: 15_000 });
  await panel.locator(".camera-live-button").click();
  await expect(pill).toHaveText("LIVE");
});
