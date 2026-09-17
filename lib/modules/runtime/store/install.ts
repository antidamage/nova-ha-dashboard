// Install / uninstall / pack: the zip-handling side-effecting operations.

import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "fs/promises";
import path from "path";
import { unzipSync, zipSync } from "fflate";
import { manifestEntries, parseModuleManifest } from "../manifest";
import { ALLOWED_ASSET_EXTENSIONS, INSTALL_LIMITS } from "./constants";
import { coerceModuleConfig } from "./config";
import { enqueue, moduleDir, patchInstalledRecord, readJson, removeInstalledRecord } from "./store";
import type { InstallResult } from "./types";

function assertSafeEntryName(name: string) {
  if (name.startsWith("/") || name.includes("..") || name.includes("\\") || name.startsWith(".")) {
    throw new Error(`Rejected package entry "${name}"`);
  }
  const segments = name.split("/");
  if (segments.some((segment) => !segment || segment.startsWith("."))) {
    throw new Error(`Rejected package entry "${name}"`);
  }
  if (segments.length === 1) {
    if (name === "module.json" || name.endsWith(".mjs") || name.endsWith(".js")) {
      return;
    }
    throw new Error(`Rejected package entry "${name}"`);
  }
  if (segments[0] !== "assets") {
    throw new Error(`Rejected package entry "${name}"`);
  }
  if (!ALLOWED_ASSET_EXTENSIONS.has(path.extname(name).toLowerCase())) {
    throw new Error(`Rejected asset "${name}"`);
  }
}

/**
 * Unpack, validate, then write. Nothing reaches disk until every entry has
 * passed — a rejected package leaves no trace.
 */
export async function installModulePackage(
  zipBytes: Uint8Array,
  source: string,
): Promise<InstallResult> {
  if (zipBytes.byteLength > INSTALL_LIMITS.compressedBytes) {
    throw new Error("Module package is too large");
  }

  const unpacked = unzipSync(zipBytes);
  const names = Object.keys(unpacked).filter((name) => !name.endsWith("/"));
  if (names.length > INSTALL_LIMITS.fileCount) {
    throw new Error("Module package has too many files");
  }

  let total = 0;
  for (const name of names) {
    assertSafeEntryName(name);
    const bytes = unpacked[name];
    if (bytes.byteLength > INSTALL_LIMITS.fileBytes) {
      throw new Error(`"${name}" is too large`);
    }
    total += bytes.byteLength;
    if (total > INSTALL_LIMITS.extractedBytes) {
      throw new Error("Module package expands too large");
    }
  }

  const manifestBytes = unpacked["module.json"];
  if (!manifestBytes) {
    throw new Error("Module package has no module.json");
  }
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown;
  } catch {
    throw new Error("module.json is not valid JSON");
  }
  const parsed = parseModuleManifest(manifestValue);
  if (!parsed.ok) {
    throw new Error(`module.json is invalid — ${parsed.error}`);
  }
  const manifest = parsed.manifest;

  const entries = manifestEntries(manifest);
  if (!unpacked[entries.server] && !unpacked[entries.client]) {
    throw new Error("Module package has neither a server nor a client entry");
  }
  // A client bundle carrying its own React would mount a second copy and break
  // hooks at render time. Cheaper to refuse here with a message that says why.
  const clientBytes = unpacked[entries.client];
  if (clientBytes && looksLikeBundledReact(clientBytes)) {
    throw new Error(
      "Client bundle appears to contain React. Mark react/react-dom/react/jsx-runtime external and use api.react.",
    );
  }

  return enqueue(async () => {
    const target = moduleDir(manifest.id);
    const staging = `${target}.${process.pid}.incoming`;
    await rm(staging, { recursive: true, force: true });
    for (const name of names) {
      const filePath = path.join(staging, name);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, unpacked[name]);
    }

    // Carry existing config across an upgrade; a fresh install starts empty.
    const previousConfig = await readJson(path.join(target, "config.json"));
    if (previousConfig !== undefined) {
      await writeFile(
        path.join(staging, "config.json"),
        `${JSON.stringify(coerceModuleConfig(manifest, previousConfig), null, 2)}\n`,
        "utf8",
      );
    }

    // And the module's own durable state. Upgrading is not a reset: the whole
    // point of api.storage is surviving restarts, and an outbound queue that
    // vanished on every version bump would lose real events silently.
    await cp(path.join(target, "storage"), path.join(staging, "storage"), {
      recursive: true,
      force: true,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });

    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    return { id: manifest.id, version: manifest.version };
  }).then(async (result) => {
    await patchInstalledRecord(manifest.id, {
      version: manifest.version,
      source,
      installedAt: new Date().toISOString(),
      state: "loaded",
      error: undefined,
    });
    return result;
  });
}

function looksLikeBundledReact(bytes: Uint8Array): boolean {
  // The bundled-React tells that survive minification: React's own dev warning
  // prefix and the internals field every copy defines.
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 2 * 1024 * 1024)));
  return (
    text.includes("__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED") ||
    text.includes("react-dom.production") ||
    text.includes("Invalid hook call. Hooks can only be called")
  );
}

export async function deleteModule(id: string) {
  await rm(moduleDir(id), { recursive: true, force: true });
  await removeInstalledRecord(id);
}

/** Re-pack an installed module for download, without its installation state. */
export async function packModule(id: string): Promise<Uint8Array> {
  const dir = moduleDir(id);
  const files: Record<string, Uint8Array> = {};

  async function walk(relative: string) {
    const entries = await readdir(path.join(dir, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      // Installation state, not package content.
      if (child === "config.json" || child.startsWith("storage/")) {
        continue;
      }
      files[child] = new Uint8Array(await readFile(path.join(dir, child)));
    }
  }

  await walk("");
  return zipSync(files);
}
