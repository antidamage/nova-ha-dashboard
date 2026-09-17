/**
 * The CLI entry: mode selection, browser lifecycle and reporting.
 *
 * Moved verbatim from `scripts/powershop-daily-scrape.mjs`, which stays the
 * entry point (`node /app/scripts/powershop-daily-scrape.mjs`).
 */

import path from "node:path";
import { responseShouldBeCaptured } from "./candidates.mjs";
import { argValue, dateKeysBetween, hasArg, isDateKey, isOvernight, summarizeRangeResults, yesterdayKey } from "./cli.mjs";
import { loadPlaywright } from "./client.mjs";
import { DEFAULT_DATA_DIR, DEFAULT_TEMPLATE_PATH, DEFAULT_TIME_ZONE, PAGE_TIMEOUT_MS } from "./constants.mjs";
import { ensureLoggedIn } from "./login.mjs";
import { scrapeTargetDate } from "./scrape.mjs";
import { enrichExistingRecords, findChromiumExecutable, loadStorageState, readJson, writeJson } from "./store.mjs";

export async function main() {
  const templatePath = argValue("--template") ?? process.env.POWERSHOP_TEMPLATE_PATH ?? DEFAULT_TEMPLATE_PATH;
  const dataDir = argValue("--data-dir") ?? process.env.POWERSHOP_DATA_DIR ?? DEFAULT_DATA_DIR;
  const template = await readJson(templatePath);
  if (hasArg("--enrich-existing")) {
    const summary = await enrichExistingRecords(dataDir, template);
    console.log(JSON.stringify(summary));
    if (summary.status !== "enrichment_ok") {
      process.exitCode = 1;
    }
    return;
  }
  const requestedStartDate = argValue("--start-date") ?? process.env.POWERSHOP_START_DATE;
  const requestedEndDate = argValue("--end-date") ?? process.env.POWERSHOP_END_DATE;
  if (Boolean(requestedStartDate) !== Boolean(requestedEndDate)) {
    throw new Error("Powershop range refresh requires both --start-date and --end-date.");
  }
  const rangeMode = Boolean(requestedStartDate && requestedEndDate);
  const targetDates = rangeMode
    ? dateKeysBetween(requestedStartDate, requestedEndDate)
    : [argValue("--date") ?? yesterdayKey(template.timezone ?? DEFAULT_TIME_ZONE)];
  const targetDate = targetDates.at(-1);
  const dryRun = hasArg("--dry-run");
  const loginOnly = hasArg("--login-only");
  const force = hasArg("--force") || process.env.POWERSHOP_ALLOW_DAYTIME === "1";
  const storagePath = path.resolve(
    argValue("--storage-state") ?? process.env.POWERSHOP_STORAGE_STATE ?? path.join(dataDir, "storage-state.json"),
  );
  const freshLogin = hasArg("--fresh-login");

  if (!isDateKey(targetDate)) {
    throw new Error(`Invalid --date value: ${targetDate}`);
  }

  if (!force && !loginOnly && !isOvernight(template)) {
    const record = {
      capturedAt: new Date().toISOString(),
      source: "powershop",
      status: "skipped_not_overnight",
      targetDate,
      warning: "Live meter reads are only allowed during the overnight window.",
    };
    await writeJson(path.join(dataDir, "latest.json"), record);
    console.log(JSON.stringify({ status: record.status, targetDate }));
    return;
  }

  if (dryRun) {
    console.log(JSON.stringify({
      dataDir,
      dateCount: targetDates.length,
      endDate: targetDate,
      startDate: targetDates[0],
      status: "dry_run_ok",
      templatePath,
    }));
    return;
  }

  const email = process.env.POWERSHOP_EMAIL;
  const password = process.env.POWERSHOP_PASSWORD;
  if (!email || !password) {
    throw new Error("POWERSHOP_EMAIL and POWERSHOP_PASSWORD must be set in the runtime environment.");
  }

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    executablePath: await findChromiumExecutable(),
    headless: !hasArg("--headed"),
  });
  const capturedResponses = [];
  let context;

  try {
    const storageState = freshLogin ? null : await loadStorageState(storagePath);
    context = await browser.newContext(storageState ? { storageState } : {});
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    page.on("response", async (response) => {
      const url = response.url();
      if (!responseShouldBeCaptured(url, template)) {
        return;
      }
      const contentType = response.headers()["content-type"] ?? "";
      if (!contentType.includes("json") && !contentType.includes("text") && !url.toLowerCase().includes("graphql")) {
        return;
      }
      try {
        const text = await response.text();
        const limited = text.slice(0, template.network?.maxBodyChars ?? 200000);
        let body = limited;
        try {
          body = JSON.parse(limited);
        } catch {
          // Keep text bodies as text; DOM extraction handles the fallback.
        }
        capturedResponses.push({
          body,
          contentType,
          status: response.status(),
          url,
        });
      } catch {
        // Ignore unreadable/binary responses.
      }
    });

    const authMode = await ensureLoggedIn(page, context, template, storagePath, email, password);
    if (loginOnly) {
      const record = {
        authMode,
        capturedAt: new Date().toISOString(),
        source: "powershop",
        status: "login_ok",
        targetDate,
      };
      await writeJson(path.join(dataDir, "login-check.json"), record);
      console.log(JSON.stringify({ authMode, status: "login_ok", targetDate }));
      return;
    }
    const records = [];
    const failedDates = [];
    for (const [index, date] of targetDates.entries()) {
      try {
        const record = await scrapeTargetDate(page, date, capturedResponses, template, dataDir, {
          directOnly: rangeMode,
          writeLatest: !rangeMode,
        });
        records.push(record);
        console.log(JSON.stringify({
          costNzd: record.values.costNzd,
          index: index + 1,
          kwh: record.values.kwh,
          status: record.status,
          targetDate: date,
          total: targetDates.length,
        }));
      } catch (error) {
        const warning = error instanceof Error ? error.message : String(error);
        const failure = {
          capturedAt: new Date().toISOString(),
          source: "powershop",
          status: "error",
          targetDate: date,
          warning,
        };
        failedDates.push(date);
        await writeJson(path.join(dataDir, "failures", `${date}-${Date.now()}.json`), failure);
        console.error(`Powershop range refresh failed for ${date}: ${warning}`);
      }
      if (rangeMode && index < targetDates.length - 1) {
        await page.waitForTimeout(250);
      }
    }

    if (rangeMode) {
      const finalRecord = records.find((record) => record.targetDate === targetDate);
      if (finalRecord) {
        await writeJson(path.join(dataDir, template.output.latestFile), finalRecord);
      }
      const summary = summarizeRangeResults(records, failedDates, targetDates[0], targetDate, targetDates.length);
      console.log(JSON.stringify(summary));
      if (summary.status !== "range_ok") {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    const status = error?.code === "requires_mfa" || error?.code === "requires_interaction" ? error.code : "error";
    const warning = error instanceof Error ? error.message : String(error);
    const record = {
      capturedAt: new Date().toISOString(),
      source: "powershop",
      status,
      targetDate,
      warning,
    };
    await writeJson(path.join(dataDir, "latest.json"), record);
    await writeJson(path.join(dataDir, "failures", `${targetDate}-${Date.now()}.json`), record);
    console.error(`Powershop scrape ${status}: ${warning}`);
    console.log(JSON.stringify({ status, targetDate }));
    if (status === "error") {
      process.exitCode = 1;
    }
  } finally {
    await context?.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}
