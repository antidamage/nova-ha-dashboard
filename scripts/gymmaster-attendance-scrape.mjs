#!/usr/bin/env node
import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PORTAL_URL = "https://allfit.gymmasteronline.com/portal/account/visithistory";
const DEFAULT_DATA_DIR = path.resolve("data", "gymmaster");
const DEFAULT_DASHBOARD_URL = "http://127.0.0.1:3000";
const DEFAULT_TIME_ZONE = "Pacific/Auckland";
const LOGIN_TIMEOUT_MS = 90_000;
const PAGE_TIMEOUT_MS = 60_000;
const RESPONSE_MAX_CHARS = 200_000;
const require = createRequire(import.meta.url);

const MONTHS = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

function argValue(name) {
  const arg = process.argv.find((value) => value === name || value.startsWith(`${name}=`));
  if (!arg) {
    return null;
  }
  if (arg === name) {
    const index = process.argv.indexOf(arg);
    return process.argv[index + 1] ?? "";
  }
  return arg.slice(name.length + 1);
}

function hasArg(name) {
  return process.argv.includes(name) || process.argv.some((value) => value.startsWith(`${name}=`));
}

async function loadPlaywright() {
  try {
    return require("playwright-core");
  } catch {
    // Fall through to the full package if this is run outside the Nova Docker wrapper.
  }
  try {
    return require("playwright");
  } catch (error) {
    throw new Error(`Playwright or playwright-core is required for GymMaster scraping: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) {
    return NaN;
  }
  return year < 100 ? 2000 + year : year;
}

function parseTime(hourRaw, minuteRaw, secondRaw, meridiemRaw) {
  if (hourRaw === undefined || hourRaw === null || hourRaw === "") {
    return { hasTime: false, hour: 12, minute: 0, second: 0 };
  }

  let hour = Number(hourRaw);
  const minute = Number(minuteRaw ?? 0);
  const second = Number(secondRaw ?? 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) {
    return null;
  }

  const meridiem = String(meridiemRaw ?? "").replace(/\./g, "").toLowerCase();
  if (meridiem.startsWith("p") && hour < 12) {
    hour += 12;
  }
  if (meridiem.startsWith("a") && hour === 12) {
    hour = 0;
  }

  return { hasTime: true, hour, minute, second };
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-NZ", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  ) - date.getTime();
}

function zonedDateToUtc(year, month, day, hour, minute, second, timeZone) {
  if (
    !Number.isFinite(year)
    || !Number.isFinite(month)
    || !Number.isFinite(day)
    || !Number.isFinite(hour)
    || !Number.isFinite(minute)
    || !Number.isFinite(second)
    || month < 1
    || month > 12
    || day < 1
    || day > 31
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
    || second < 0
    || second > 59
  ) {
    return null;
  }

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = localAsUtc - timeZoneOffsetMs(new Date(localAsUtc), timeZone);
  result = localAsUtc - timeZoneOffsetMs(new Date(result), timeZone);
  const date = new Date(result);
  return Number.isFinite(date.getTime()) ? date : null;
}

function addCandidate(candidates, date, source, raw, confidence, now) {
  if (!date) {
    return;
  }
  const epochMs = date.getTime();
  if (!Number.isFinite(epochMs)) {
    return;
  }
  if (epochMs < Date.UTC(2010, 0, 1) || epochMs > now.getTime() + 6 * 60 * 60 * 1000) {
    return;
  }

  const normalizedRaw = normalizeWhitespace(raw).slice(0, 140);
  if (candidates.some((candidate) => candidate.epochMs === epochMs && candidate.raw === normalizedRaw)) {
    return;
  }

  candidates.push({
    confidence,
    epochMs,
    iso: date.toISOString(),
    raw: normalizedRaw,
    source,
  });
}

function addDatePartsCandidate(candidates, parts, source, raw, confidence, options) {
  const time = parseTime(parts.hour, parts.minute, parts.second, parts.meridiem);
  if (!time) {
    return;
  }
  const date = zonedDateToUtc(
    normalizeYear(parts.year),
    Number(parts.month),
    Number(parts.day),
    time.hour,
    time.minute,
    time.second,
    options.timeZone,
  );
  addCandidate(candidates, date, source, raw, time.hasTime ? confidence : confidence - 0.15, options.now);
}

export function extractVisitCandidatesFromText(text, {
  now = new Date(),
  source = "text",
  timeZone = DEFAULT_TIME_ZONE,
} = {}) {
  const candidates = [];
  const input = normalizeWhitespace(text);
  const options = { now, timeZone };
  const separator = String.raw`(?:[\s,\u00a0]+(?:at\s+)?)?`;
  const optionalTime = String.raw`(?:(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?`;

  const isoPattern = new RegExp(String.raw`\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b${separator}${optionalTime}`, "gi");
  for (const match of input.matchAll(isoPattern)) {
    addDatePartsCandidate(
      candidates,
      {
        day: match[3],
        hour: match[4],
        meridiem: match[7],
        minute: match[5],
        month: match[2],
        second: match[6],
        year: match[1],
      },
      source,
      match[0],
      0.82,
      options,
    );
  }

  const dmyPattern = new RegExp(String.raw`\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2}|\d{2})\b${separator}${optionalTime}`, "gi");
  for (const match of input.matchAll(dmyPattern)) {
    addDatePartsCandidate(
      candidates,
      {
        day: match[1],
        hour: match[4],
        meridiem: match[7],
        minute: match[5],
        month: match[2],
        second: match[6],
        year: match[3],
      },
      source,
      match[0],
      0.84,
      options,
    );
  }

  const monthPattern = new RegExp(
    String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(${[...MONTHS.keys()].join("|")})\s+(20\d{2}|\d{2})\b${separator}${optionalTime}`,
    "gi",
  );
  for (const match of input.matchAll(monthPattern)) {
    addDatePartsCandidate(
      candidates,
      {
        day: match[1],
        hour: match[4],
        meridiem: match[7],
        minute: match[5],
        month: MONTHS.get(match[2].toLowerCase()),
        second: match[6],
        year: match[3],
      },
      source,
      match[0],
      0.86,
      options,
    );
  }

  const monthFirstPattern = new RegExp(
    String.raw`\b(${[...MONTHS.keys()].join("|")})\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2}|\d{2})\b${separator}${optionalTime}`,
    "gi",
  );
  for (const match of input.matchAll(monthFirstPattern)) {
    addDatePartsCandidate(
      candidates,
      {
        day: match[2],
        hour: match[4],
        meridiem: match[7],
        minute: match[5],
        month: MONTHS.get(match[1].toLowerCase()),
        second: match[6],
        year: match[3],
      },
      source,
      match[0],
      0.78,
      options,
    );
  }

  return candidates;
}

function jsonPathLooksRelevant(pathParts) {
  const pathText = pathParts.join(".").toLowerCase();
  return /\b(visit|check.?in|access|attendance|history|date|time|timestamp)\b/.test(pathText);
}

export function extractVisitCandidatesFromJson(value, {
  now = new Date(),
  source = "json",
  timeZone = DEFAULT_TIME_ZONE,
} = {}, pathParts = []) {
  const candidates = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      candidates.push(...extractVisitCandidatesFromJson(item, { now, source, timeZone }, [...pathParts, String(index)]));
    });
    return candidates;
  }

  if (!value || typeof value !== "object") {
    if ((typeof value === "string" || typeof value === "number") && jsonPathLooksRelevant(pathParts)) {
      candidates.push(...extractVisitCandidatesFromText(String(value), {
        now,
        source: `${source}:${pathParts.join(".")}`.slice(0, 120),
        timeZone,
      }));
    }
    return candidates;
  }

  const record = value;
  const entries = Object.entries(record);
  const dateEntry = entries.find(([key]) => /\b(date|day|visitdate|visit_date|checkindate|checkin_date)\b/i.test(key));
  const timeEntry = entries.find(([key]) => /\b(time|visittime|visit_time|checkintime|checkin_time)\b/i.test(key));
  if (dateEntry && timeEntry) {
    candidates.push(...extractVisitCandidatesFromText(`${dateEntry[1]} ${timeEntry[1]}`, {
      now,
      source: `${source}:${[...pathParts, dateEntry[0], timeEntry[0]].join(".")}`.slice(0, 120),
      timeZone,
    }));
  }

  for (const [key, child] of entries) {
    candidates.push(...extractVisitCandidatesFromJson(child, { now, source, timeZone }, [...pathParts, key]));
  }
  return candidates;
}

export function pickLatestVisitCandidate(candidates) {
  return candidates
    .filter((candidate) => Number.isFinite(candidate.epochMs))
    .sort((a, b) => b.epochMs - a.epochMs || b.confidence - a.confidence)[0] ?? null;
}

function localDateKey(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-NZ", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function firstVisibleLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
}

async function pageLooksAuthenticated(page) {
  const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  const loginInputs = await page.locator('input[name="email"], input[name="password"]').count().catch(() => 0);
  if (
    page.url().includes("/portal/login")
    || loginInputs > 0
    || text.includes("member log in")
    || text.includes("must be logged in")
    || text.includes("invalid email or password")
  ) {
    return false;
  }
  return true;
}

async function ensureLoggedIn(page, context, portalUrl, storagePath, email, password) {
  await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
  await page.waitForTimeout(1000);
  if (await pageLooksAuthenticated(page)) {
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await context.storageState({ path: storagePath });
    return "session";
  }

  const loginUrl = new URL("/portal/login", portalUrl).toString();
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);

  const emailInput = await firstVisibleLocator(page, ['input[name="email"]', 'input[type="email"]']);
  const passwordInput = await firstVisibleLocator(page, ['input[name="password"]', 'input[type="password"]']);
  if (!emailInput || !passwordInput) {
    const error = new Error("GymMaster login fields were not found.");
    error.code = "requires_interaction";
    throw error;
  }

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await Promise.all([
    page.waitForNavigation({ timeout: LOGIN_TIMEOUT_MS }).catch(() => null),
    page.locator('button[type="submit"], input[type="submit"]').first().click(),
  ]);
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
  await page.waitForTimeout(1500);

  const loginText = await page.locator("body").innerText().catch(() => "");
  if (/invalid email or password/i.test(loginText)) {
    const error = new Error("GymMaster login failed: invalid email or password.");
    error.code = "requires_login";
    throw error;
  }

  await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
  await page.waitForTimeout(1500);
  if (!(await pageLooksAuthenticated(page))) {
    const error = new Error("GymMaster login did not reach the visit history page.");
    error.code = "requires_interaction";
    throw error;
  }

  await fs.mkdir(path.dirname(storagePath), { recursive: true });
  await context.storageState({ path: storagePath });
  return "login";
}

function responseShouldBeCaptured(url) {
  const lower = url.toLowerCase();
  return (
    lower.includes("/portal/account/visithistory")
    || lower.includes("/portal/api/")
    || lower.includes("/portal/member/visits")
    || lower.includes("/portal/account")
  );
}

function installResponseCapture(page, capturedResponses) {
  page.on("response", async (response) => {
    const url = response.url();
    if (!responseShouldBeCaptured(url)) {
      return;
    }

    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.includes("json") && !contentType.includes("text") && !contentType.includes("html")) {
      return;
    }

    try {
      const text = (await response.text()).slice(0, RESPONSE_MAX_CHARS);
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {
        // Keep text and HTML responses as text; DOM extraction handles them too.
      }
      capturedResponses.push({
        body,
        contentType,
        status: response.status(),
        url,
      });
    } catch {
      // Ignore unreadable responses.
    }
  });
}

function buildAttendanceRecord({ authMode, capturedAt, capturedResponses, domText, now, portalUrl, timeZone }) {
  const domCandidates = extractVisitCandidatesFromText(domText, { now, source: "dom:visit-history", timeZone });
  const responseCandidates = capturedResponses.flatMap((response, index) => {
    const source = `response:${index}`;
    if (typeof response.body === "string") {
      return extractVisitCandidatesFromText(response.body, { now, source, timeZone });
    }
    return extractVisitCandidatesFromJson(response.body, { now, source, timeZone });
  });
  const candidates = [...domCandidates, ...responseCandidates];
  const selected = pickLatestVisitCandidate(candidates);
  const warnings = [];
  if (!selected) {
    warnings.push("No visit timestamp was found on the GymMaster visit history page.");
  }

  return {
    authMode,
    capturedAt,
    evidence: {
      candidateCount: candidates.length,
      domTextHash: crypto.createHash("sha256").update(domText).digest("hex"),
      responseCount: capturedResponses.length,
      selected,
    },
    lastVisitAt: selected?.iso ?? null,
    lastVisitLocalDate: selected ? localDateKey(new Date(selected.iso), timeZone) : null,
    portalUrl,
    schemaVersion: 1,
    source: "gymmaster",
    status: selected ? "ok" : "no_visit_found",
    timeZone,
    warnings,
  };
}

async function updatePreferenceFile(preferencesPath, lastVisitAt) {
  const current = await readJson(preferencesPath, {});
  const merged = {
    ...current,
    watchface: {
      ...(current.watchface ?? {}),
      gymLastResetAt: lastVisitAt,
      updatedAt: new Date().toISOString(),
    },
  };
  await writeJson(preferencesPath, merged);
  return { method: "preferences-file", preferencesPath };
}

async function updateDashboardWatchface(lastVisitAt, { dashboardUrl, preferencesPath }) {
  let apiError = null;
  if (dashboardUrl && dashboardUrl.toLowerCase() !== "none") {
    try {
      const response = await fetch(new URL("/api/watchface", dashboardUrl), {
        body: JSON.stringify({ gymLastResetAt: lastVisitAt }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return { method: "dashboard-api", url: new URL("/api/watchface", dashboardUrl).toString() };
    } catch (error) {
      apiError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    ...(await updatePreferenceFile(preferencesPath, lastVisitAt)),
    apiError,
  };
}

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

async function main() {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
