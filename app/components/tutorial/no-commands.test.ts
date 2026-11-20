import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * No command leaves the dashboard during the tour, by construction
 * (specs/tutorial-mode.md, "Sandbox copies, never the real devices"): nothing
 * the tour imports, however deep, reaches a command hook or a writing store,
 * and the tour's own files never call fetch.
 */

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "app", "components", "tutorial");

/** Modules that send commands or write state. Matched by file name. */
const BANNED = [
  "useAirconCommands",
  "useBedroomHeaterCommands",
  "useZoneLighting",
  "zoneLightRulesClient",
  "climateCommands",
  "ClimateCommandsProvider",
  "useDashboardCommands",
];

function packageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return packageFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function resolve(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function importGraph(entries: string[]) {
  const seen = new Map<string, string | null>();
  const queue = entries.map((file) => ({ file, via: null as string | null }));
  while (queue.length) {
    const { file, via } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.set(file, via);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT)) {
      // Type-only imports carry no code.
      if (/^import\s+type\s/.test(match[0]) || /^export\s+type\s/.test(match[0])) continue;
      const next = resolve(file, match[1] ?? match[2]);
      if (next && !seen.has(next)) queue.push({ file: next, via: file });
    }
  }
  return seen;
}

describe("the tutorial cannot send a command", () => {
  const files = packageFiles(PACKAGE);

  it("imports no command hook or writing store, at any depth", () => {
    const graph = importGraph(files);
    const offenders = [...graph.keys()]
      .filter((file) => BANNED.includes(path.basename(file).replace(/\.tsx?$/, "")))
      .map((file) => `${path.relative(ROOT, file)} (via ${path.relative(ROOT, graph.get(file) ?? "")})`);
    expect(offenders).toEqual([]);
  });

  it("never calls fetch in its own files", () => {
    const offenders = files.filter((file) => /\bfetch\s*\(/.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
  });
});
