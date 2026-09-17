/**
 * Scraping one target date: pages, direct measurements, and the write-out.
 *
 * Moved verbatim from `scripts/powershop-daily-scrape.mjs`, which stays the
 * entry point (`node /app/scripts/powershop-daily-scrape.mjs`).
 */

import crypto from "node:crypto";
import path from "node:path";
import { findJsonCandidates, findTextCandidates, normalizeRecord } from "./candidates.mjs";
import { addDaysToDateKey } from "./cli.mjs";
import { fetchAuthenticatedGraphql, waitForAccountContext } from "./client.mjs";
import { MEASUREMENTS_LOOKBACK_HOURS, PAGE_TIMEOUT_MS, POWERSHOP_MEASUREMENTS_QUERY } from "./constants.mjs";
import { extractAccountMetadata, measurementCostCents, measurementDateKey, numberOrNull, renderTemplate } from "./measurements.mjs";
import { writeJson } from "./store.mjs";

async function scrapePage(page, pageConfig, template, targetDate, capturedResponses) {
  const url = renderTemplate(pageConfig.urlTemplate, { date: targetDate });
  const startIndex = capturedResponses.length;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
  await page.waitForTimeout(1500);

  const text = await page.locator("body").innerText().catch(() => "");
  const textHash = crypto.createHash("sha256").update(text).digest("hex");
  const candidates = [
    ...findTextCandidates(text, template, `dom:${pageConfig.name}`),
    ...capturedResponses
      .slice(startIndex)
      .flatMap((response, index) => findJsonCandidates(response.body, template, targetDate, `response:${pageConfig.name}:${index}`)),
  ];

  return {
    candidates,
    expectedField: pageConfig.expectedField,
    name: pageConfig.name,
    optional: Boolean(pageConfig.optional),
    textHash,
    url,
  };
}

async function scrapeDirectMeasurements(page, targetDate, capturedResponses) {
  let accountContext = await waitForAccountContext(page, capturedResponses);
  const url = "https://api.powershop.nz/v1/graphql/?opName=measurements";
  if (!accountContext) {
    await page.goto("https://app.powershop.nz/dashboard", { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS }).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
    accountContext = await waitForAccountContext(page, capturedResponses);
  }
  if (!accountContext) {
    return {
      candidates: [],
      error: "Powershop account context was not found in the authenticated dashboard bootstrap.",
      expectedField: "costNzd,kwh",
      name: "directMeasurements",
      optional: true,
      textHash: null,
      url,
    };
  }

  const response = await fetchAuthenticatedGraphql(page, "measurements", POWERSHOP_MEASUREMENTS_QUERY, {
    ...accountContext,
    endOn: addDaysToDateKey(targetDate, 1),
    last: MEASUREMENTS_LOOKBACK_HOURS,
    readingDirectionType: "CONSUMPTION",
    readingFrequencyType: "HOUR_INTERVAL",
    readingQualityType: "COMBINED",
  });
  capturedResponses.push(response);

  if (response.status < 200 || response.status >= 300 || response.body?.errors) {
    return {
      candidates: [],
      error: `Powershop measurements query failed with status ${response.status}.`,
      expectedField: "costNzd,kwh",
      name: "directMeasurements",
      optional: true,
      textHash: null,
      url,
    };
  }

  const edges = response.body?.data?.account?.property?.measurements?.edges ?? [];
  const dayEdges = edges.filter(({ node }) => measurementDateKey(node) === targetDate);
  const kwh = dayEdges.reduce((sum, { node }) => sum + (numberOrNull(node?.value) ?? 0), 0);
  const costNzd = dayEdges.reduce((sum, { node }) => sum + measurementCostCents(node), 0) / 100;
  const candidates = [];
  if (dayEdges.length > 0) {
    candidates.push(
      {
        confidence: 0.97,
        field: "kwh",
        path: "data.account.property.measurements.edges",
        source: "direct:measurements",
        strategy: "graphql-hourly-measurements",
        value: kwh,
      },
      {
        confidence: 0.97,
        field: "costNzd",
        path: "data.account.property.measurements.edges.node.metaData.statistics.costInclTax.estimatedAmount",
        source: "direct:measurements",
        strategy: "graphql-hourly-measurements",
        value: costNzd,
      },
    );
  }

  return {
    candidates,
    expectedField: "costNzd,kwh",
    name: "directMeasurements",
    optional: true,
    textHash: crypto.createHash("sha256").update(JSON.stringify({ edgeCount: edges.length, targetDate })).digest("hex"),
    url,
  };
}

export async function scrapeTargetDate(page, targetDate, capturedResponses, template, dataDir, { directOnly, writeLatest }) {
  const responseStartIndex = capturedResponses.length;
  const pages = [];
  try {
    pages.push(await scrapeDirectMeasurements(page, targetDate, capturedResponses));
  } catch (error) {
    pages.push({
      candidates: [],
      error: error instanceof Error ? error.message : String(error),
      expectedField: "costNzd,kwh",
      name: "directMeasurements",
      optional: true,
      textHash: null,
      url: "https://api.powershop.nz/v1/graphql/?opName=measurements",
    });
  }

  if (!directOnly) {
    for (const pageConfig of template.pages) {
      try {
        pages.push(await scrapePage(page, pageConfig, template, targetDate, capturedResponses));
      } catch (error) {
        if (!pageConfig.optional) {
          throw error;
        }
        pages.push({
          candidates: [],
          error: error instanceof Error ? error.message : String(error),
          expectedField: pageConfig.expectedField,
          name: pageConfig.name,
          optional: true,
          textHash: null,
          url: renderTemplate(pageConfig.urlTemplate, { date: targetDate }),
        });
      }
    }
  }

  const dateResponses = capturedResponses.slice(responseStartIndex);
  const record = normalizeRecord(targetDate, pages, dateResponses, template);
  const rawPath = path.join(dataDir, template.output.rawDirectory, `${targetDate}-${Date.now()}.json`);
  await writeJson(rawPath, {
    capturedAt: record.capturedAt,
    responses: dateResponses,
    targetDate,
  });
  record.rawEvidencePath = rawPath;

  await writeJson(path.join(dataDir, template.output.dailyDirectory, `${targetDate}.json`), record);
  const accountMetadata = extractAccountMetadata(dateResponses);
  if (accountMetadata) {
    await writeJson(path.join(dataDir, "account.json"), accountMetadata);
  }
  if (writeLatest) {
    await writeJson(path.join(dataDir, template.output.latestFile), record);
  }
  return record;
}
