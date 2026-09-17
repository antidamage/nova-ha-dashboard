/**
 * The CLI entry: one scrape run, then the record write-out.
 *
 * Moved verbatim from `scripts/gymmaster-attendance-scrape.mjs`, which stays
 * the entry point (`node /app/scripts/gymmaster-attendance-scrape.mjs`).
 */

import path from "node:path";
import { buildAttendanceRecord, installResponseCapture } from "./capture.mjs";
import { DEFAULT_DASHBOARD_URL, DEFAULT_DATA_DIR, DEFAULT_PORTAL_URL, DEFAULT_TIME_ZONE, PAGE_TIMEOUT_MS } from "./constants.mjs";
import { ensureLoggedIn } from "./login.mjs";
import { argValue, exists, hasArg, loadPlaywright, writeJson } from "./store.mjs";
import { updateDashboardWatchface } from "./watchface.mjs";

async function scrapeGymAttendance(options) {
  const { chromium } = await loadPlaywright();
  const capturedResponses = [];
  const storageState = (await exists(options.storagePath)) ? { storageState: options.storagePath } : {};
  const browser = await chromium.launch({
    executablePath: options.chromiumExecutablePath,
    headless: !options.headed,
  });
  let context;

  try {
    context = await browser.newContext(storageState);
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    installResponseCapture(page, capturedResponses);
    const authMode = await ensureLoggedIn(page, context, options.portalUrl, options.storagePath, options.email, options.password);

    await page.goto(options.portalUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
    await page.waitForTimeout(1500);

    const domText = await page.locator("body").innerText().catch(() => "");
    return buildAttendanceRecord({
      authMode,
      capturedAt: new Date().toISOString(),
      capturedResponses,
      domText,
      now: options.now,
      portalUrl: options.portalUrl,
      timeZone: options.timeZone,
    });
  } finally {
    await context?.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

export async function main() {
  const dataDir = argValue("--data-dir") ?? process.env.GYMMASTER_DATA_DIR ?? DEFAULT_DATA_DIR;
  const portalUrl = argValue("--portal-url") ?? process.env.GYMMASTER_PORTAL_URL ?? DEFAULT_PORTAL_URL;
  const dashboardUrl = argValue("--dashboard-url") ?? process.env.GYMMASTER_DASHBOARD_URL ?? process.env.NOVA_DASHBOARD_URL ?? DEFAULT_DASHBOARD_URL;
  const preferencesPath = argValue("--preferences") ?? process.env.NOVA_DASHBOARD_PREFERENCES ?? path.resolve("data", "dashboard-preferences.json");
  const storagePath = argValue("--storage-state") ?? process.env.GYMMASTER_STORAGE_STATE ?? path.join(dataDir, "storage-state.json");
  const timeZone = argValue("--timezone") ?? process.env.GYMMASTER_TIME_ZONE ?? DEFAULT_TIME_ZONE;
  const dryRun = hasArg("--dry-run");

  if (dryRun) {
    console.log(JSON.stringify({ dataDir, dashboardUrl, portalUrl, status: "dry_run_ok", storagePath, timeZone }));
    return;
  }

  const email = process.env.GYMMASTER_EMAIL ?? process.env.GYMMASTER_USERNAME;
  const password = process.env.GYMMASTER_PASSWORD;
  if (!email || !password) {
    throw new Error("GYMMASTER_EMAIL and GYMMASTER_PASSWORD must be set in the runtime environment.");
  }

  const options = {
    chromiumExecutablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    dataDir,
    email,
    headed: hasArg("--headed"),
    now: new Date(),
    password,
    portalUrl,
    storagePath,
    timeZone,
  };

  let record;
  try {
    record = await scrapeGymAttendance(options);
    if (record.lastVisitAt) {
      record.dashboardUpdate = await updateDashboardWatchface(record.lastVisitAt, { dashboardUrl, preferencesPath });
    }
  } catch (error) {
    const status = error?.code === "requires_login" || error?.code === "requires_interaction" ? error.code : "error";
    record = {
      capturedAt: new Date().toISOString(),
      portalUrl,
      schemaVersion: 1,
      source: "gymmaster",
      status,
      timeZone,
      warning: error instanceof Error ? error.message : String(error),
    };
    if (status === "error") {
      process.exitCode = 1;
    }
  }

  await writeJson(path.join(dataDir, "latest.json"), record);
  console.log(JSON.stringify({
    lastVisitAt: record.lastVisitAt ?? null,
    status: record.status,
    updateMethod: record.dashboardUpdate?.method ?? null,
  }));
}
