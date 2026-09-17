/**
 * Everything that touches the filesystem: JSON records, storage state,
 * the login-code file, the Chromium lookup and the enrichment pass.
 *
 * Moved verbatim from `scripts/powershop-daily-scrape.mjs`, which stays the
 * entry point (`node /app/scripts/powershop-daily-scrape.mjs`).
 */

import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeLoginCode, sleep } from "./cli.mjs";
import { LOGIN_CODE_POLL_MS } from "./constants.mjs";
import { extractAccountMetadata, extractIntervalsForDate } from "./measurements.mjs";

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value, mode = 0o644) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  await fs.chmod(tempPath, mode);
  await fs.rename(tempPath, filePath);
  await fs.chmod(filePath, mode);
}

export async function saveStorageState(context, storagePath) {
  await writeJson(storagePath, await context.storageState(), 0o600);
}

export async function loadStorageState(storagePath) {
  try {
    const state = await readJson(storagePath);
    await fs.chmod(storagePath, 0o600);
    return state;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error(`Ignoring unusable Powershop storage state at ${storagePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
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

async function readLoginCodeFile(filePath) {
  try {
    return normalizeLoginCode(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function consumeLoginCodeFile(filePath) {
  const code = await readLoginCodeFile(filePath);
  if (code) {
    await fs.rm(filePath, { force: true });
  }
  return code;
}

export async function waitForLoginCodeFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const code = await consumeLoginCodeFile(filePath);
    if (code) {
      return code;
    }
    await sleep(LOGIN_CODE_POLL_MS);
  }
  return null;
}

export async function findChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const roots = ["/ms-playwright", "/root/.cache/ms-playwright", "/home/pwuser/.cache/ms-playwright"];
  for (const root of roots) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const chromiumDirs = entries
        .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith("chromium"))
        .map((entry) => path.join(root, entry.name))
        .sort()
        .reverse();
      for (const directory of chromiumDirs) {
        for (const candidate of [
          path.join(directory, "chrome-linux", "chrome"),
          path.join(directory, "chrome-linux", "chrome-wrapper"),
        ]) {
          if (await exists(candidate)) {
            return candidate;
          }
        }
      }
    } catch {
      // Try the next known root.
    }
  }
  return undefined;
}

async function readablePath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      await fs.access(candidate, fsConstants.R_OK);
      return candidate;
    } catch {
      // Try the next representation of this evidence path.
    }
  }
  return null;
}

export async function enrichExistingRecords(dataDir, template) {
  const dailyDir = path.join(dataDir, template.output.dailyDirectory);
  const rawDir = path.join(dataDir, template.output.rawDirectory);
  const [dailyFiles, rawFiles] = await Promise.all([fs.readdir(dailyDir), fs.readdir(rawDir)]);
  const rawByDate = new Map();
  for (const fileName of rawFiles.filter((name) => /^\d{4}-\d{2}-\d{2}-\d+\.json$/.test(name)).sort()) {
    rawByDate.set(fileName.slice(0, 10), fileName);
  }

  let enriched = 0;
  let alreadyEnriched = 0;
  let missingEvidence = 0;
  const recordsByDate = new Map();
  for (const fileName of dailyFiles.filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()) {
    const filePath = path.join(dailyDir, fileName);
    const record = await readJson(filePath);
    const targetDate = fileName.slice(0, 10);
    if (Array.isArray(record.intervals) && record.intervals.length > 0) {
      alreadyEnriched += 1;
      recordsByDate.set(targetDate, record);
      continue;
    }
    const evidencePath = await readablePath([
      record.rawEvidencePath,
      record.rawEvidencePath ? path.join(rawDir, path.basename(record.rawEvidencePath)) : null,
      rawByDate.has(targetDate) ? path.join(rawDir, rawByDate.get(targetDate)) : null,
    ]);
    if (!evidencePath) {
      recordsByDate.set(targetDate, record);
      missingEvidence += 1;
      continue;
    }
    let evidence;
    try {
      evidence = await readJson(evidencePath);
    } catch {
      recordsByDate.set(targetDate, record);
      missingEvidence += 1;
      continue;
    }
    const intervals = extractIntervalsForDate(evidence.responses ?? [], targetDate);
    if (!intervals.length) {
      recordsByDate.set(targetDate, record);
      missingEvidence += 1;
      continue;
    }
    const next = { ...record, intervals, schemaVersion: 2 };
    await writeJson(filePath, next);
    recordsByDate.set(targetDate, next);
    enriched += 1;
  }

  let accountMetadata = null;
  for (const fileName of [...rawFiles].sort().reverse()) {
    if (!/^\d{4}-\d{2}-\d{2}-\d+\.json$/.test(fileName)) {
      continue;
    }
    let evidence;
    try {
      evidence = await readJson(path.join(rawDir, fileName));
    } catch {
      continue;
    }
    accountMetadata = extractAccountMetadata(evidence.responses ?? []);
    if (accountMetadata) {
      await writeJson(path.join(dataDir, "account.json"), accountMetadata);
      break;
    }
  }

  const latestPath = path.join(dataDir, template.output.latestFile);
  try {
    const latest = await readJson(latestPath);
    const enrichedLatest = recordsByDate.get(latest.targetDate);
    if (enrichedLatest) {
      await writeJson(latestPath, enrichedLatest);
    }
  } catch {
    // A daily corpus can be enriched even when latest.json has not been created yet.
  }

  return {
    accountMetadata: Boolean(accountMetadata),
    alreadyEnriched,
    enriched,
    missingEvidence,
    status: missingEvidence ? "enrichment_partial" : "enrichment_ok",
    total: dailyFiles.filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).length,
  };
}
