/**
 * Argument parsing, the Playwright loader, and everything that touches
 * the filesystem.
 *
 * Moved verbatim from `scripts/gymmaster-attendance-scrape.mjs`, which stays
 * the entry point (`node /app/scripts/gymmaster-attendance-scrape.mjs`).
 */

import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export function argValue(name) {
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

export function hasArg(name) {
  return process.argv.includes(name) || process.argv.some((value) => value.startsWith(`${name}=`));
}

export async function loadPlaywright() {
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

export async function exists(filePath) {
  try {
    await fs.access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}
