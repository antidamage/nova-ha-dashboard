import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * specs/agent-token-footprint.md section 10: a document an agent can read and
 * *stop at* is the defect. Every file here is one part of a suite, and the
 * failure it causes is real — a change made against `maintenance-rule.md` alone
 * missed the rules in `agent-token-footprint.md` and had to be redone several
 * times.
 *
 * So every documentation file read in this workspace opens with the same line,
 * naming the root document and this repo's index, and this file is the ratchet:
 * a new .md that does not carry it fails the unit suite, a served copy that
 * carries a path true only on this machine fails too, and a spec no index names
 * fails with them. The marker is byte-exact on purpose — if it needs a new
 * word, every doc changes in one sweep.
 */

const ROOT = process.cwd();

/** The one line every documentation file read here carries first. Byte-exact. */
const MARKER = String.raw`<!-- START HERE, never here alone: read D:\Projects\Agent\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->`;

/** The index the marker names. It lists the whole suite, so it must be whole. */
const INDEX = "specs/README.md";

/**
 * Served artifacts carry NO marker, and the case below fails if one ever does.
 * Everything under `public/` is copied verbatim by Next into the demo export
 * that `.github/workflows/demo-pages.yml` publishes to GitHub Pages, and
 * `public/agent/**` is also served by a deployed dashboard as its agent package
 * (repo `README.md`). Neither reader is in this workspace, so the root document
 * the marker names does not exist on their machine and the line would be a dead
 * instruction there — the failure this whole file exists to prevent. The skill
 * package under `skills/` is read here and carries the marker; the `public/`
 * copy is separately written (the two already differ, and
 * `scripts/package-agent-skills.mjs` validates both rather than deriving one),
 * so it carries none.
 */
const SERVED_PREFIX = "public/";

/**
 * How many files may go without the marker — Adeline sets this number, and it
 * is zero: every doc read here carries one. It guards the case above, not the
 * tree: raising it means adding an entry naming the work that removes it, and
 * an entry whose file carries the marker, or has gone, fails as soon as it
 * exists. It read 1 while `CLAUDE.md` was in the repo (another agent's own
 * configuration, not a shared doc); PR #56 moved that inventory to
 * `docs/control-inventory.md`, a doc like any other, so it went back to zero.
 */
const MAX_EXEMPT = 0;

const EXEMPT: Record<string, string> = {};

/**
 * Tracked files AND untracked-but-not-ignored ones, so a doc written in this
 * session is caught before it is committed: `git ls-files` alone sees a new
 * .md only after `git add`, which is exactly when nobody looks again.
 */
function tracked(glob: string): string[] {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", glob], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

function docFiles(): string[] {
  return tracked("*.md");
}

function specFiles(): string[] {
  return tracked("specs").filter((file) => file.endsWith(".md"));
}

/**
 * Markdown link targets in the index, as written — `](target)`, a wrapped
 * `<target>`, or a title after the target. One extractor for both checks below,
 * so a link form one of them can see is a form the other can see too.
 */
function indexLinks(index: string): string[] {
  return [...index.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((match) => match[1]);
}

/**
 * The marker is the first line of the file, or the first line after the YAML
 * frontmatter — a skill's `---` block has to stay line 1 for the skill loader.
 * Frontmatter is recognised structurally, not by position: line 1 must be `---`
 * *and* the next line must be a YAML key, so a doc whose line 1 is a horizontal
 * rule is held to line 1 where a reader actually sees the marker. A file that
 * opens `---`, a key-like line, a blank and a closing `---` is frontmatter by
 * any structural reading, and is accepted with the marker directly after the
 * block even though a reader meets it on line 5; no file in the tree has that
 * shape.
 */
function firstContentLine(file: string): string {
  const lines = readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/);
  let start = 0;
  if (lines[0]?.trim() === "---" && /^[A-Za-z0-9_.-]+\s*:/.test((lines[1] ?? "").trim())) {
    const end = lines.findIndex((line, i) => i > 1 && line.trim() === "---");
    if (end > 1) start = end + 1;
  }
  while (start < lines.length && lines[start].trim() === "") start++;
  return lines[start] ?? "";
}

const PLACE_IT =
  `Add this as the file's first line (after the YAML frontmatter, if it has one):\n\n${MARKER}\n\n` +
  `Then list the file in ${INDEX} if it is a new spec. Rule: specs/agent-token-footprint.md section 10.`;

describe("documentation suite entry point", () => {
  it("has the entry-point marker as the first content line of every doc read here", () => {
    const offenders = docFiles()
      .filter((file) => !file.startsWith(SERVED_PREFIX) && !(file in EXEMPT))
      .filter((file) => firstContentLine(file) !== MARKER);
    expect(
      offenders,
      `${offenders.length} documentation file(s) do not name where the suite starts:\n` +
        `${offenders.join("\n")}\n\n${PLACE_IT}`,
    ).toEqual([]);
  });

  it("keeps this workspace's path out of the served agent package", () => {
    const served = docFiles().filter((file) => file.startsWith(SERVED_PREFIX));
    const offenders = served.filter((file) => readFileSync(path.join(ROOT, file), "utf8").includes(MARKER));
    expect(
      offenders,
      `${offenders.length} served file(s) carry a path that exists only on this machine:\n` +
        `${offenders.join("\n")}\n\n${SERVED_PREFIX} is copied verbatim into the demo published ` +
        `to GitHub Pages, and ${SERVED_PREFIX}agent/ is served as a deployed dashboard's agent ` +
        `package. Its reader cannot open D:\\Projects\\Agent\\AGENTS.md, so the marker is ` +
        `dropped there — see the comment on SERVED_PREFIX.`,
    ).toEqual([]);
    expect(
      served.length,
      `no file under ${SERVED_PREFIX} — if the served package moved, move SERVED_PREFIX with it`,
    ).toBeGreaterThan(0);
  });

  it("keeps the exemption knob honest, and the list empty", () => {
    const entries = Object.entries(EXEMPT);
    expect(entries.length, `MAX_EXEMPT is ${MAX_EXEMPT}; the list has ${entries.length}`).toBeLessThanOrEqual(
      MAX_EXEMPT,
    );
    const stale = entries
      .filter(([file]) => !existsSync(path.join(ROOT, file)) || firstContentLine(file) === MARKER)
      .map(([file]) => file);
    expect(
      stale,
      `${stale.join(", ")} needs no exemption — it carries the marker, or it is gone. Delete the entry.`,
    ).toEqual([]);
  });

  it("names every spec in the index, so no spec sits outside the suite", () => {
    const index = readFileSync(path.join(ROOT, INDEX), "utf8");
    // Named means its own path under specs/, so a nested spec cannot borrow a
    // top-level row that happens to share its basename.
    const named = new Set(indexLinks(index).map((link) => link.replace(/#.*$/, "")));
    const missing = specFiles()
      .filter((file) => file !== INDEX)
      .filter((file) => !named.has(file.replace(/^specs\//, "")));
    expect(
      missing,
      `${missing.length} spec(s) are in no index, so nothing leads a reader to them:\n` +
        `${missing.join("\n")}\n\nAdd a row for each to ${INDEX}.`,
    ).toEqual([]);
  });

  it("has no index entry pointing at a file that is not there", () => {
    const index = readFileSync(path.join(ROOT, INDEX), "utf8");
    const links = indexLinks(index)
      .map((link) => link.replace(/#.*$/, ""))
      .filter((link) => link && !/^[a-z]+:/i.test(link));
    const dead = [...new Set(links)].filter((link) => !existsSync(path.join(ROOT, "specs", link)));
    expect(
      dead,
      `${dead.length} index link(s) match nothing:\n${dead.join("\n")}\n\n${INDEX} is the map — fix or drop each.`,
    ).toEqual([]);
  });
});
