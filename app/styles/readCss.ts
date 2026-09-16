import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// Test helper, not shipped code.
//
// app/globals.css is now an entry file: a header, `@import "tailwindcss"`, and
// one `@import "./styles/…"` line per partial. The partials are in exact
// document order because the stylesheet has no `@layer` discipline — source
// order decides which rule wins (specs/agent-token-footprint.md §7).
//
// The contract tests read the stylesheet as text and regex it, and several of
// their assertions are order-aware or "defined anywhere in the bundle". So they
// must see the whole bundle, in order, not one partial. This resolves the
// imports and returns the concatenation, which is byte-identical to the
// pre-split globals.css apart from each partial's one-line banner comment.

const stylesDir = __dirname;
const appDir = resolve(stylesDir, "..");
const entryPath = join(appDir, "globals.css");

const IMPORT_LINE = /^@import\s+"\.\/styles\/(.+?)";\s*$/;

function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function everyPartial(dir: string, found: string[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) everyPartial(full, found);
    else if (entry.name.endsWith(".css")) {
      found.push(relative(stylesDir, full).split(sep).join("/"));
    }
  }
  return found;
}

let cached: string | null = null;

/**
 * The whole stylesheet: app/globals.css with its `./styles/…` imports resolved
 * in order. Asserts that every partial under app/styles/ is imported exactly
 * once, which makes this the tripwire for import-order drift — a partial added
 * without an import, or imported twice, fails here rather than silently
 * dropping out of the cascade.
 */
export function readCss(): string {
  if (cached !== null) return cached;

  const entry = stripBom(readFileSync(entryPath, "utf8"));
  const entryLines = entry.split("\n");
  const imported: string[] = [];
  const out = entryLines
    .map((line, index) => {
      const match = IMPORT_LINE.exec(line);
      if (!match) return index === entryLines.length - 1 ? line : `${line}\n`;
      // A partial already ends in its own newline, so the import line's
      // newline is consumed here rather than added back.
      imported.push(match[1]);
      return stripBom(readFileSync(join(stylesDir, match[1]), "utf8"));
    })
    .join("");

  const onDisk = everyPartial(stylesDir).sort();
  const seen = [...imported].sort();
  const missing = onDisk.filter((name) => !imported.includes(name));
  const duplicated = imported.filter((name, i) => imported.indexOf(name) !== i);
  const unknown = imported.filter((name) => !onDisk.includes(name));
  if (missing.length || duplicated.length || unknown.length) {
    throw new Error(
      [
        "app/globals.css must import every partial under app/styles/ exactly once.",
        missing.length ? `never imported: ${missing.join(", ")}` : "",
        duplicated.length ? `imported more than once: ${duplicated.join(", ")}` : "",
        unknown.length ? `imported but missing on disk: ${unknown.join(", ")}` : "",
        `on disk: ${onDisk.length}, imported: ${seen.length}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  cached = out;
  return out;
}
