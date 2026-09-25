import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * VOCABULARY.md is a map, and an agent follows it instead of searching: a path
 * that has stopped resolving sends the next agent to the wrong file, which is
 * worse than having no entry at all. This is the ratchet that keeps it true —
 * the same shape as `lib/architecture.test.ts`'s size cap and
 * `lib/no-household-data.test.ts`.
 *
 * What it cannot do is notice a term that is MISSING, and nothing honest can:
 * that half is a written rule, in §4 of the file.
 */
const ROOT = process.cwd();
const FILE = "VOCABULARY.md";

/** Every backticked span in the file, stripped of its delimiters and any #anchor. */
function backtickedSpans(source: string): string[] {
  return (source.match(/`[^`\n]*`/g) ?? []).map((span) => span.slice(1, -1).split("#")[0].trim());
}

/**
 * The tokens that claim to be paths: one with a slash, not a URL, not a glob,
 * and not a `<placeholder>` shape — the file's header says a shape is written in
 * angle brackets precisely so it is not read as a file.
 */
function pathTokens(source: string): string[] {
  return backtickedSpans(source).filter(
    (token) =>
      token.includes("/")
      && !/^https?:\/\//.test(token)
      && !token.includes("*")
      && !token.includes("<")
      && !token.includes(">"),
  );
}

function resolves(token: string): boolean {
  const full = path.join(ROOT, token);
  return existsSync(full) && (statSync(full).isDirectory() || statSync(full).isFile());
}

describe("the vocabulary stays a map", () => {
  it("is at the repo root, and states the base its paths are relative to", () => {
    const source = readFileSync(path.join(ROOT, FILE), "utf8");
    // A table of paths with no stated base is how a whole column was once read
    // against the wrong directory.
    expect(source).toMatch(/relative to the repo root/);
  });

  it("actually detects the shapes it claims to", () => {
    // Without this, a format change could leave the assertion below passing on
    // an empty list.
    expect(pathTokens("see `lib/ha/` and `app/api/entity/route.ts`")).toEqual([
      "lib/ha/",
      "app/api/entity/route.ts",
    ]);
    expect(pathTokens("`lib/wash-*.ts` `app/styles/<area>.css` `data/modules/<id>/`")).toEqual([]);
    expect(pathTokens("`https://example.com/a/b`")).toEqual([]);
    expect(pathTokens("`module` `one word`")).toEqual([]);
  });

  it("names only paths that resolve, from the repo root", () => {
    const source = readFileSync(path.join(ROOT, FILE), "utf8");
    const tokens = [...new Set(pathTokens(source))];
    const broken = tokens.filter((token) => !resolves(token));

    expect(tokens.length).toBeGreaterThan(100);
    expect(
      broken,
      broken.length
        ? `${FILE} names ${broken.length} path(s) that no longer resolve:\n` +
            broken.map((token) => `  ${token}`).join("\n") +
            "\nFix the entry, or the file it points at. A map with a wrong path in it " +
            "sends the next agent to the wrong file."
        : undefined,
    ).toEqual([]);
  });
});
