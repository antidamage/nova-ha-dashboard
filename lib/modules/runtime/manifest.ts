import { z } from "zod";
import { ALL_HOOK_IDS } from "./types";

/**
 * `module.json` validation (`specs/module-system.md` §1).
 *
 * Everything is checked before a single byte is written to disk, so a bad
 * package fails the install rather than producing a half-installed directory
 * that then fails at load.
 */

const ID_PATTERN = /^[a-z][a-z0-9-]{1,38}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * The config-form schema is a restricted JSON Schema subset, because the form is
 * generated and may only use the shared controls in `nova-ha-dashboard/CLAUDE.md`.
 * Module config is deliberately not text-editable, so anything the form cannot
 * render is rejected at install with the offending property named.
 */
const LeafFieldSchema = z.object({
  type: z.enum(["boolean", "string", "number"]),
  title: z.string().max(80).optional(),
  description: z.string().max(300).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  enum: z.array(z.string().max(120)).min(1).max(50).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  step: z.number().positive().optional(),
  readOnly: z.boolean().optional(),
  /** Marks a value held in the dashboard secrets store, never in config.json. */
  format: z.literal("secret").optional(),
  "x-nova-control": z.literal("template").optional(),
});

export type ModuleConfigLeafField = z.infer<typeof LeafFieldSchema>;

const GroupFieldSchema = z.object({
  type: z.literal("object"),
  title: z.string().max(80).optional(),
  description: z.string().max(300).optional(),
  properties: z.record(z.string().max(60), LeafFieldSchema),
});

const FieldSchema = z.union([LeafFieldSchema, GroupFieldSchema]);

export type ModuleConfigField = z.infer<typeof FieldSchema>;

export const ModuleConfigSchemaSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.string().max(60), FieldSchema).default({}),
});

export type ModuleConfigSchema = z.infer<typeof ModuleConfigSchemaSchema>;

export const ModuleManifestSchema = z.object({
  id: z.string().regex(ID_PATTERN, "id must be lower-case letters, digits and hyphens"),
  name: z.string().min(1).max(80),
  version: z.string().regex(SEMVER_PATTERN, "version must be semver"),
  description: z.string().max(300).default(""),
  author: z.string().max(120).optional(),
  repository: z.string().url().max(300).optional(),
  entry: z
    .object({
      server: z.string().max(120).optional(),
      client: z.string().max(120).optional(),
    })
    .default({}),
  /**
   * Every hook the module intends to use, declared up front so the config tab
   * can list them and an unknown id is a load-time error rather than a silent
   * no-op.
   */
  hooks: z.array(z.string().max(80)).default([]),
  configSchema: ModuleConfigSchemaSchema.default({ type: "object", properties: {} }),
  /** Secret NAMES only. Values live in the dashboard secrets store. */
  secrets: z.array(z.string().regex(/^[a-z][a-zA-Z0-9._-]{0,63}$/)).max(20).default([]),
  /** Default message template per hook id. An empty template means silence. */
  messages: z.record(z.string().max(80), z.string().max(600)).default({}),
  /** Whether the module serves its own routes under /api/modules/<id>/… */
  routes: z.boolean().default(false),
  minDashboardSchemaVersion: z.number().int().min(1).default(1),
});

export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

export type ManifestParseResult =
  | { ok: true; manifest: ModuleManifest }
  | { ok: false; error: string };

function issueText(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const at = issue.path.length ? issue.path.join(".") : "(root)";
      return `${at}: ${issue.message}`;
    })
    .join("; ");
}

export function parseModuleManifest(value: unknown): ManifestParseResult {
  const parsed = ModuleManifestSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: issueText(parsed.error) };
  }
  const manifest = parsed.data;
  // Checked here rather than in the schema so the message can name the offending
  // ids — an unknown hook is nearly always a typo, and "invalid" alone is no help.
  const unknownHooks = manifest.hooks.filter((hook) => !ALL_HOOK_IDS.includes(hook));
  if (unknownHooks.length) {
    return { ok: false, error: `unknown hook id: ${unknownHooks.join(", ")}` };
  }
  const entryServer = manifest.entry.server ?? "server.mjs";
  const entryClient = manifest.entry.client ?? "client.mjs";
  for (const [label, entry] of [["entry.server", entryServer], ["entry.client", entryClient]] as const) {
    if (entry.includes("..") || entry.startsWith("/") || entry.includes("\\")) {
      return { ok: false, error: `${label} must be a relative path inside the package` };
    }
  }
  // A message template for a hook the module never declared is dead config: the
  // field would appear in the config form and control nothing.
  for (const hook of Object.keys(manifest.messages)) {
    if (!manifest.hooks.includes(hook)) {
      return { ok: false, error: `messages.${hook} has no matching entry in hooks` };
    }
  }
  return { ok: true, manifest };
}

export function manifestEntries(manifest: ModuleManifest) {
  return {
    server: manifest.entry.server ?? "server.mjs",
    client: manifest.entry.client ?? "client.mjs",
  };
}
