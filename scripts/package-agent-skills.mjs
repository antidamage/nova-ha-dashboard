#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const skillDir = path.join(root, "skills", "nova-dashboard-management");
const publicSkillDir = path.join(root, "public", "agent", "skills", "nova-dashboard-management");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseFrontmatter(text) {
  const match = /^---\n([\s\S]+?)\n---/.exec(text);
  if (!match) {
    throw new Error("SKILL.md is missing YAML frontmatter");
  }
  return Object.fromEntries(
    match[1]
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon).trim(), line.slice(colon + 1).trim().replace(/^"|"$/g, "")];
      }),
  );
}

async function validateSkill(baseDir) {
  const skillPath = path.join(baseDir, "SKILL.md");
  const text = await fs.readFile(skillPath, "utf8");
  const frontmatter = parseFrontmatter(text);
  if (frontmatter.name !== "nova-dashboard-management") {
    throw new Error(`${skillPath} has the wrong skill name`);
  }
  if (!frontmatter.description || frontmatter.description.length < 40) {
    throw new Error(`${skillPath} needs a useful description`);
  }
  for (const fileName of ["mcp-tools.md", "config-schema.md", "setup-workflow.md", "security.md"]) {
    const referencePath = path.join(baseDir, "references", fileName);
    if (!(await exists(referencePath))) {
      throw new Error(`Missing reference: ${referencePath}`);
    }
  }
}

await validateSkill(skillDir);
await validateSkill(publicSkillDir);
await fs.access(path.join(root, "public", "agent", "nova-dashboard-mcp.json"));
console.log("Nova dashboard agent skill package is valid.");
