import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { unzipSync, zipSync } from "fflate";
import { parse as parseYaml } from "yaml";

const LIMITS = {
  compressed: 25 * 1024 * 1024,
  extracted: 100 * 1024 * 1024,
};
const idPattern = /^[a-z][a-z0-9_-]{1,63}$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;

function validateObject(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["module must be a YAML object"];
  if (!idPattern.test(value.id ?? "")) errors.push("id must be a safe lowercase module id");
  if (!versionPattern.test(value.version ?? "")) errors.push("version must use semantic form such as 1.0.0");
  if (!["2d", "3d"].includes(value.dimension)) errors.push("dimension must be 2d or 3d");
  const vectorSize = value.dimension === "3d" ? 3 : 2;
  if (!value.bounds || value.bounds.min?.length !== vectorSize || value.bounds.max?.length !== vectorSize) {
    errors.push(`bounds must contain ${vectorSize}D min and max vectors`);
  }
  if (!Array.isArray(value.scene) || value.scene.length === 0) errors.push("scene must contain at least one entity");
  const text = JSON.stringify(value);
  for (const key of ["shader", "script", "javascript", "metalSource", "executable", "binary"]) {
    if (new RegExp(`"${key}"\\s*:`).test(text)) errors.push(`${key} content is not allowed`);
  }
  return errors;
}

function parseModule(bytes) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return parseYaml(source, { maxAliasCount: 32, prettyErrors: true, uniqueKeys: true });
}

async function readPackage(target) {
  const bytes = new Uint8Array(await readFile(target));
  if (bytes.byteLength > LIMITS.compressed) throw new Error("package exceeds 25 MB");
  if (!target.toLowerCase().endsWith(".zip")) return { module: parseModule(bytes), files: ["module.yaml"] };
  const archive = unzipSync(bytes);
  const names = Object.keys(archive);
  let extracted = 0;
  for (const name of names) {
    extracted += archive[name].byteLength;
    if (extracted > LIMITS.extracted) throw new Error("package exceeds 100 MB extracted");
    const normalized = name.replaceAll("\\", "/");
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) throw new Error(`unsafe path: ${name}`);
    if (name !== "module.yaml" && !/^assets\/.+\.(png|jpe?g)$/i.test(name) && name !== "preview.png") {
      throw new Error(`unsupported package entry: ${name}`);
    }
  }
  if (!archive["module.yaml"]) throw new Error("package is missing root module.yaml");
  return { module: parseModule(archive["module.yaml"]), files: names.sort() };
}

async function collectFiles(directory, prefix = "") {
  const result = {};
  for (const entry of (await readdir(directory)).sort()) {
    const absolute = path.join(directory, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    const info = await stat(absolute);
    if (info.isDirectory()) Object.assign(result, await collectFiles(absolute, relative));
    else result[relative] = new Uint8Array(await readFile(absolute));
  }
  return result;
}

async function validate(target) {
  if (!target) throw new Error("usage: npm run phonoscope:validate -- <module.yaml|package.zip>");
  const input = await readPackage(path.resolve(target));
  const errors = validateObject(input.module);
  if (errors.length) {
    errors.forEach((error) => process.stderr.write(`ERROR ${error}\n`));
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`VALID ${input.module.id}@${input.module.version} (${input.module.dimension}); ${input.files.length} file(s)\n`);
}

async function pack(directory, output) {
  if (!directory) throw new Error("usage: npm run phonoscope:pack -- <directory> [output.zip]");
  const absolute = path.resolve(directory);
  const files = await collectFiles(absolute);
  if (!files["module.yaml"]) throw new Error("directory is missing module.yaml");
  const errors = validateObject(parseModule(files["module.yaml"]));
  if (errors.length) throw new Error(errors.join("; "));
  const destination = path.resolve(output ?? `${path.basename(absolute)}.zip`);
  const bytes = zipSync(files, { level: 9, mtime: new Date("1980-01-01T00:00:00Z") });
  await writeFile(destination, bytes);
  process.stdout.write(`PACKED ${destination} (${bytes.byteLength} bytes)\n`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "validate") await validate(args[0]);
  else if (command === "pack") await pack(args[0], args[1]);
  else throw new Error("usage: phonoscope-module.mjs <validate|pack> ...");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
}
