import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The household overlay is the boundary that keeps this one home's devices out
 * of the shipped product. These tests pin the three properties that make the
 * boundary real: it applies, it is optional, and it never leaks into the
 * generic config demo mode renders from.
 *
 * The config module reads its paths from the environment at import time, so
 * each case sets the variable and then imports a fresh copy.
 */

const scratchDirs: string[] = [];

function householdFile(contents: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), "nova-household-"));
  scratchDirs.push(dir);
  const file = path.join(dir, "dashboard-config.json");
  writeFileSync(file, JSON.stringify(contents), "utf8");
  return file;
}

/** A runtime-store path in a fresh scratch dir, with nothing written yet. */
function scratchRuntimePath() {
  const dir = mkdtempSync(path.join(tmpdir(), "nova-runtime-"));
  scratchDirs.push(dir);
  return path.join(dir, "dashboard-config.json");
}

function runtimeFile(contents: unknown) {
  const file = scratchRuntimePath();
  writeFileSync(file, JSON.stringify(contents), "utf8");
  return file;
}

async function freshConfigModule(householdPath: string | undefined, runtimePath?: string) {
  vi.resetModules();
  if (householdPath) {
    vi.stubEnv("NOVA_DASHBOARD_HOUSEHOLD_CONFIG", householdPath);
  } else {
    vi.stubEnv("NOVA_DASHBOARD_HOUSEHOLD_CONFIG", "");
  }
  // Out of the way by default; this suite is mostly about the household layer.
  vi.stubEnv("NOVA_DASHBOARD_CONFIG", runtimePath ?? path.join(tmpdir(), "nova-absent-runtime-config.json"));
  return import("./dashboard-config");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  while (scratchDirs.length) {
    rmSync(scratchDirs.pop()!, { recursive: true, force: true });
  }
});

describe("household config layer", () => {
  it("applies household values over the shipped defaults", async () => {
    const file = householdFile({ power: { billing: { startDay: 3, endDay: 2 } } });
    const { readDashboardConfig, readDefaultDashboardConfig } = await freshConfigModule(file);

    const defaults = await readDefaultDashboardConfig();
    const live = await readDashboardConfig();

    expect(live.power.billing.startDay).toBe(3);
    expect(live.power.billing.endDay).toBe(2);
    // Untouched keys still come from the shipped defaults.
    expect(live.power.timeZone).toBe(defaults.power.timeZone);
  });

  it("is entirely optional — an unset variable is a supported state", async () => {
    const { readDashboardConfig, readDefaultDashboardConfig } = await freshConfigModule(undefined);

    const defaults = await readDefaultDashboardConfig();
    const live = await readDashboardConfig();

    expect(live.power.billing).toEqual(defaults.power.billing);
  });

  it("tolerates the variable pointing at a file that does not exist", async () => {
    const { readDashboardConfig } = await freshConfigModule(
      path.join(tmpdir(), "nova-household-does-not-exist", "dashboard-config.json"),
    );

    await expect(readDashboardConfig()).resolves.toBeTruthy();
  });

  it("never leaks into the generic config, which demo mode renders from", async () => {
    const file = householdFile({ power: { billing: { startDay: 3, endDay: 2 } } });
    const { readDefaultDashboardConfig } = await freshConfigModule(file);

    const defaults = await readDefaultDashboardConfig();

    expect(defaults.power.billing.startDay).not.toBe(3);
  });

  it("survives a config save, which composes a whole document over the layer", async () => {
    const file = householdFile({ power: { billing: { startDay: 3, endDay: 2 } } });
    const { dryRunDashboardConfigImport } = await freshConfigModule(file);

    // A /config save sends the full document; composing it over bare defaults
    // would silently write generic values on top of this home's.
    const result = await dryRunDashboardConfigImport({ mcp: { requireBearerAuth: false } });

    expect(result.ok).toBe(true);
    expect(result.ok && result.config.power.billing.startDay).toBe(3);
  });

  /**
   * If a household package is sitting next to this repo, prove its overlay
   * still validates against the current schema. A broken overlay would
   * otherwise only surface when the dashboard refused to start in production,
   * and the schema moves under it every time a module gains config.
   *
   * Skipped when no package is present, which is the normal case for anyone
   * other than the maintainer.
   */
  it("validates the sibling household package, when there is one", async () => {
    const sibling = path.join(process.cwd(), "..", "nova-household", "dashboard-config.json");
    if (!existsSync(sibling)) {
      expect(true).toBe(true);
      return;
    }

    const { readDefaultDashboardConfig, validateDashboardConfig } = await freshConfigModule(sibling);
    const defaults = await readDefaultDashboardConfig();
    const overlay = JSON.parse(readFileSync(sibling, "utf8")) as Record<string, unknown>;

    const merge = (base: unknown, override: unknown): unknown => {
      if (!override || typeof override !== "object" || Array.isArray(override)) {
        return override === undefined ? base : override;
      }
      if (!base || typeof base !== "object" || Array.isArray(base)) return override;
      const next: Record<string, unknown> = { ...(base as Record<string, unknown>) };
      for (const [key, value] of Object.entries(override)) {
        next[key] = key in next ? merge(next[key], value) : value;
      }
      return next;
    };

    const result = validateDashboardConfig(merge(defaults, overlay));
    expect(
      result.ok,
      result.ok ? undefined : `nova-household overlay no longer validates: ${JSON.stringify(result.errors)}`,
    ).toBe(true);
  });

  it("applies the same layering to the synchronous reader", async () => {
    const file = householdFile({ power: { billing: { startDay: 3, endDay: 2 } } });
    const { readDashboardConfigSync } = await freshConfigModule(file);

    expect(readDashboardConfigSync().power.billing.startDay).toBe(3);
  });
});

/**
 * The update channel is the one part of the overlay the runtime store may not
 * override or hold. It used to: the store merges above this layer and a
 * `/config` save wrote the whole merged document, so one save froze the
 * then-current shipped default and every later override here silently lost.
 * specs/self-update-channel.md.
 */
describe("the household update channel", () => {
  const FORGE = "https://forge.example/api/v1";
  const SHIPPED = { repo: "antidamage/nova-ha-dashboard", branch: "main", apiBase: "https://api.github.com" };

  it("wins over a store that pinned the shipped default", async () => {
    const runtime = runtimeFile({ update: SHIPPED });
    const file = householdFile({ update: { apiBase: FORGE } });
    const { readDashboardConfig } = await freshConfigModule(file, runtime);

    const live = await readDashboardConfig();
    expect(live.update.apiBase).toBe(FORGE);
    expect(live.update.repo).toBe(SHIPPED.repo);
  });

  it("wins in the synchronous reader too", async () => {
    const runtime = runtimeFile({ update: SHIPPED });
    const file = householdFile({ update: { apiBase: FORGE, branch: "household" } });
    const { readDashboardConfigSync } = await freshConfigModule(file, runtime);

    expect(readDashboardConfigSync().update.apiBase).toBe(FORGE);
    expect(readDashboardConfigSync().update.branch).toBe("household");
  });

  it("still lets an ordinary update setting come from the store", async () => {
    const runtime = runtimeFile({ update: { checkHourLocal: 5 } });
    const file = householdFile({ update: { apiBase: FORGE } });
    const { readDashboardConfig } = await freshConfigModule(file, runtime);

    expect((await readDashboardConfig()).update.checkHourLocal).toBe(5);
  });

  it("cannot be set by a config import", async () => {
    const runtime = scratchRuntimePath();
    const file = householdFile({ update: { apiBase: FORGE } });
    const { readDashboardConfig, writeDashboardConfig } = await freshConfigModule(file, runtime);

    const result = await writeDashboardConfig({ update: { apiBase: "https://elsewhere.example/api/v1" } });

    expect(result.ok).toBe(true);
    expect((await readDashboardConfig()).update.apiBase).toBe(FORGE);
  });

  it("is never written to the runtime store", async () => {
    const runtime = scratchRuntimePath();
    const file = householdFile({ update: { apiBase: FORGE } });
    const { writeDashboardConfig } = await freshConfigModule(file, runtime);

    await writeDashboardConfig({ mcp: { requireBearerAuth: false } });

    const stored = JSON.parse(readFileSync(runtime, "utf8")) as { update?: Record<string, unknown> };
    expect(stored.update).toBeDefined();
    expect(Object.keys(stored.update ?? {}).sort()).toEqual(["autoUpdate", "checkHourLocal"]);
  });

  it("carries through a dry run, which reports what a save would apply", async () => {
    const file = householdFile({ update: { apiBase: FORGE } });
    const { dryRunDashboardConfigImport } = await freshConfigModule(file);

    const result = await dryRunDashboardConfigImport({
      update: { apiBase: "https://elsewhere.example/api/v1" },
      mcp: { requireBearerAuth: false },
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.config.update.apiBase).toBe(FORGE);
  });

  it("falls back to the shipped GitHub channel when nothing overrides it", async () => {
    const { readDashboardConfig } = await freshConfigModule(undefined);

    expect((await readDashboardConfig()).update).toMatchObject(SHIPPED);
  });
});
