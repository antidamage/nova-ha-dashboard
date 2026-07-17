import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dashboardConfig = {
  tasks: {
    iCloud: {
      caldavUrl: "https://caldav.example/",
      calendars: ["Default"],
      reminders: ["Errands"],
      defaultSyncDays: 7,
      defaultReminderDurationMs: 1_800_000,
      authBackoffMs: 60_000,
      syncIntervalMs: 300_000,
    },
  },
};

vi.mock("./dashboard-config", () => ({
  readDashboardConfigSync: () => dashboardConfig,
}));

const ENV_KEYS = ["ICLOUD_USERNAME", "ICLOUD_APP_PASSWORD", "ICLOUD_SYNC_DAYS", "ICLOUD_CALENDARS", "ICLOUD_REMINDERS"];

describe("readIcloudConfig", () => {
  beforeEach(() => ENV_KEYS.forEach((key) => delete process.env[key]));
  afterEach(() => ENV_KEYS.forEach((key) => delete process.env[key]));

  it("is disabled and falls back to config lists when no credentials are set", async () => {
    const { readIcloudConfig, isIcloudEnabled } = await import("./icloud-config");
    const config = readIcloudConfig();
    expect(config.enabled).toBe(false);
    expect(isIcloudEnabled(config)).toBe(false);
    expect(config.calendars).toEqual(["Default"]);
    expect(config.reminders).toEqual(["Errands"]);
    expect(config.syncDays).toBe(7);
  });

  it("is enabled when both credentials are present", async () => {
    process.env.ICLOUD_USERNAME = "  user@example.com  ";
    process.env.ICLOUD_APP_PASSWORD = "secret";
    const { readIcloudConfig } = await import("./icloud-config");
    const config = readIcloudConfig();
    expect(config.enabled).toBe(true);
    expect(config.username).toBe("user@example.com");
  });

  it("overrides calendar and reminder lists from the environment", async () => {
    process.env.ICLOUD_CALENDARS = "Work, Home ,";
    process.env.ICLOUD_REMINDERS = "Shopping";
    const { readIcloudConfig } = await import("./icloud-config");
    const config = readIcloudConfig();
    expect(config.calendars).toEqual(["Work", "Home"]);
    expect(config.reminders).toEqual(["Shopping"]);
  });

  it("clamps the sync window from the environment to 1..60 days", async () => {
    process.env.ICLOUD_SYNC_DAYS = "200";
    const { readIcloudConfig } = await import("./icloud-config");
    expect(readIcloudConfig().syncDays).toBe(60);
  });

  it("ignores an invalid sync window and uses the config default", async () => {
    process.env.ICLOUD_SYNC_DAYS = "-3";
    const { readIcloudConfig } = await import("./icloud-config");
    expect(readIcloudConfig().syncDays).toBe(7);
  });
});
