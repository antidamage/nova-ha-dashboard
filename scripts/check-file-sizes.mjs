#!/usr/bin/env node
/**
 * Reports tracked source files over the size cap in
 * specs/agent-token-footprint.md.
 *
 * lib/architecture.test.ts is the enforcement — it has the allowlist and fails
 * the build. This script is the human-and-agent-facing view: it covers the
 * whole tree rather than just lib/ and app/ (so the Python services are
 * included), groups by directory, and says how far over the cap each file is.
 *
 *   node scripts/check-file-sizes.mjs            # files over the cap
 *   node scripts/check-file-sizes.mjs --all      # every file, largest first
 *   node scripts/check-file-sizes.mjs --top 20   # the worst 20
 *   node scripts/check-file-sizes.mjs --cap 20   # a different cap, in KB
 *
 * Exits 1 when anything is over the cap, so it can gate a script.
 */

import { execFileSync } from "child_process";
import { statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXT = new Set([".ts", ".tsx", ".css", ".py", ".mjs", ".js"]);

/** Kept in step with PERMANENT_TEST_FILES in lib/architecture.test.ts. */
const PERMANENT = new Set([
  "lib/aircon-control.test.ts",
  "lib/phonoscope-drivers/phonoscope-drivers.test.ts",
  "lib/architecture.test.ts",
]);

function parseArgs(argv) {
  const opts = { all: false, top: 0, capKb: 10 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") opts.all = true;
    else if (arg === "--top") opts.top = Number(argv[(i += 1)]);
    else if (arg === "--cap") opts.capKb = Number(argv[(i += 1)]);
    else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const cap = opts.capKb * 1024;

const files = execFileSync("git", ["ls-files", "-z"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)
  .filter((f) => SOURCE_EXT.has(path.extname(f)))
  .filter((f) => !PERMANENT.has(f))
  .map((file) => {
    try {
      return { file, bytes: statSync(path.join(ROOT, file)).size };
    } catch {
      return null; // tracked but deleted in the working tree
    }
  })
  .filter(Boolean)
  .sort((a, b) => b.bytes - a.bytes);

const over = files.filter((f) => f.bytes > cap);
const shown = opts.all ? files : over;
const limited = opts.top > 0 ? shown.slice(0, opts.top) : shown;

const kb = (b) => `${(b / 1024).toFixed(1)} KB`;

for (const { file, bytes } of limited) {
  const marker = bytes > cap ? "!" : " ";
  console.log(`${marker} ${kb(bytes).padStart(9)}  ${file}`);
}

if (!over.length) {
  console.log(`\nNo file over ${opts.capKb} KB. ${files.length} source files checked.`);
  process.exit(0);
}

const total = over.reduce((sum, f) => sum + f.bytes, 0);
const byDir = new Map();
for (const { file, bytes } of over) {
  const dir = path.dirname(file).split("/").slice(0, 2).join("/");
  byDir.set(dir, (byDir.get(dir) ?? 0) + bytes);
}

console.log(
  `\n${over.length} of ${files.length} source files over ${opts.capKb} KB, ` +
    `${kb(total)} total.\n`,
);
console.log("Worst directories:");
for (const [dir, bytes] of [...byDir].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${kb(bytes).padStart(9)}  ${dir}`);
}
console.log(
  "\nSplitting convention: specs/agent-token-footprint.md sections 3 and 4.\n" +
    "Enforcement (with the allowlist): lib/architecture.test.ts",
);
process.exit(1);
