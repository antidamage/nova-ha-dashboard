import { expect, type Page } from "@playwright/test";

// Console messages that are noise in the demo dev server and unrelated to the
// behaviour under test (HMR, font preloads, the static-export hint, etc).
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /was preloaded using link preload/i,
  /Cross origin/i,
  /Failed to load resource/i, // demo provider serves no favicon/og assets
];

export type ConsoleWatcher = { errors: string[] };

/**
 * Attach a console-error watcher to a page. Use {@link expectNoConsoleErrors}
 * at the end of a test to assert the dashboard rendered cleanly.
 */
export function watchConsole(page: Page): ConsoleWatcher {
  const watcher: ConsoleWatcher = { errors: [] };
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
    watcher.errors.push(text);
  });
  page.on("pageerror", (error) => watcher.errors.push(`pageerror: ${error.message}`));
  return watcher;
}

export function expectNoConsoleErrors(watcher: ConsoleWatcher) {
  expect(watcher.errors, `unexpected console errors:\n${watcher.errors.join("\n")}`).toEqual([]);
}

/**
 * Stop the task-alert overlay from intercepting pointer events. The overlay is
 * a full-stage button that covers the control surface, and the demo task is
 * always "due" so it re-fires after being dismissed — disabling its pointer
 * events lets clicks reach the controls beneath while leaving it on screen.
 */
export async function neutralizeTaskAlerts(page: Page) {
  await page.addStyleTag({ content: ".task-alert-overlay{pointer-events:none !important;}" });
}

/**
 * Pre-decide the per-device experience mode so the first-run chooser
 * (ExperienceModeModal) never blocks a test. Must run before the first
 * page.goto. Init scripts run on EVERY navigation, so this only fills an
 * absent key — a mode changed by the test itself (e.g. via the config
 * checkbox) must survive subsequent navigations. Tests that exercise the
 * first-run flow itself skip this and navigate manually
 * (see experience-mode.spec.ts).
 */
export async function seedExperienceMode(page: Page, mode: "rich" | "lite" = "rich") {
  await page.addInitScript((value) => {
    const key = "nova.dashboard.experienceMode.v1";
    if (!window.localStorage.getItem(key)) {
      window.localStorage.setItem(key, value);
    }
  }, mode);
}

/**
 * Reminder banners (bottom bar + full-screen alert) are a per-device opt-in and
 * ship OFF, so a test that wants to see them has to say so. Same fill-if-absent
 * shape as seedExperienceMode: a test that flips the checkbox itself must have
 * its choice survive the next navigation.
 */
export async function seedReminderBanners(page: Page, enabled = true) {
  await page.addInitScript((value) => {
    const key = "nova.dashboard.reminderBanner.v1";
    if (!window.localStorage.getItem(key)) {
      window.localStorage.setItem(key, value);
    }
  }, enabled ? "true" : "false");
}

/** Navigate to the dashboard and wait until the live shell has rendered. */
export async function gotoDashboard(
  page: Page,
  options: { neutralizeAlerts?: boolean; reminderBanners?: boolean } = {},
) {
  await seedExperienceMode(page);
  await seedReminderBanners(page, options.reminderBanners ?? false);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel(/avatar$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Zones" })).toBeVisible();
  if (options.neutralizeAlerts !== false) await neutralizeTaskAlerts(page);
}

/** Navigate to the configuration workspace and wait until it has rendered. */
export async function gotoConfig(page: Page) {
  await seedExperienceMode(page);
  await page.goto("/config/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible({ timeout: 30_000 });
}

/**
 * Wait until the page has stopped growing.
 *
 * The dashboard fills in asynchronously — camera, map, power, the reminder icon
 * bar — and Chrome's scroll anchoring shifts `window.scrollY` whenever content
 * lands ABOVE the current scroll position. Any test that scrolls to an absolute
 * offset and then asserts on `scrollY` is racing that growth. Settle first.
 */
export async function waitForStableLayout(page: Page, quietMs = 500, timeoutMs = 10_000) {
  await page.evaluate(
    async ({ quiet, limit }) => {
      const deadline = Date.now() + limit;
      let last = document.body.scrollHeight;
      let stableSince = Date.now();

      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const height = document.body.scrollHeight;
        if (height === last) {
          if (Date.now() - stableSince >= quiet) return;
        } else {
          last = height;
          stableSince = Date.now();
        }
      }
    },
    { quiet: quietMs, limit: timeoutMs },
  );
}

/** Click a zone button in the Zones panel by its accessible name. */
export async function selectZone(page: Page, name: string | RegExp) {
  await page.getByRole("button", { name }).first().click();
}
