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

async function freshConfigModule(householdPath: string | undefined) {
  vi.resetModules();
  if (householdPath) {
    vi.stubEnv("NOVA_DASHBOARD_HOUSEHOLD_CONFIG", householdPath);
  } else {
    vi.stubEnv("NOVA_DASHBOARD_HOUSEHOLD_CONFIG", "");
  }
  // Keep the runtime store out of it; this suite is about the household layer.
  vi.stubEnv("NOVA_DASHBOARD_CONFIG", path.join(tmpdir(), "nova-absent-runtime-config.json"));
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
