import { mkdtemp } from "fs/promises";
import os from "os";
import path from "path";
import { zipSync, strToU8 } from "fflate";
import { vi } from "vitest";

export async function importWithTempStore() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nova-modules-"));
  vi.stubEnv("NOVA_DASHBOARD_MODULES_DIR", path.join(tempDir, "modules"));
  vi.stubEnv("NOVA_DASHBOARD_SECRETS_PATH", path.join(tempDir, "dashboard-secrets.json"));
  vi.resetModules();
  return { store: await import("../store"), tempDir };
}

export const MANIFEST = {
  id: "fixture-module",
  name: "Fixture",
  version: "1.0.0",
  description: "Test fixture",
  hooks: ["entity.action", "thermostat.transition", "card.body.after"],
  secrets: ["fixture.token"],
  messages: { "thermostat.transition": "{entity} {state}" },
  configSchema: {
    type: "object",
    properties: {
      label: { type: "string", default: "hello" },
      "fixture.token": { type: "string", format: "secret" },
      volume: { type: "number", minimum: 0, maximum: 10, default: 5 },
      nested: { type: "object", properties: { enabled: { type: "boolean", default: true } } },
    },
  },
};

export function packageZip(overrides: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  return zipSync({
    "module.json": strToU8(JSON.stringify({ ...MANIFEST, ...overrides })),
    "server.mjs": strToU8("export default { register() {} };\n"),
    "client.mjs": strToU8("export default { register() {} };\n"),
    ...Object.fromEntries(Object.entries(files).map(([name, body]) => [name, strToU8(body)])),
  });
}
