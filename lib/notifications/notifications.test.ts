import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_ACTIVE_NOTIFICATIONS, activeNotifications, notificationFromInput } from "./model";

describe("notificationFromInput", () => {
  it("defaults to info with a one hour expiry", () => {
    const now = Date.parse("2026-10-20T00:00:00Z");
    const result = notificationFromInput({ title: " Hello " }, now);
    expect(result.ok && result.notification).toMatchObject({
      title: "Hello",
      severity: "info",
      expiresAt: "2026-10-20T01:00:00.000Z",
    });
  });

  it("sticky ignores ttlSeconds", () => {
    const result = notificationFromInput({ title: "x", sticky: true, ttlSeconds: 5 });
    expect(result.ok && result.notification.expiresAt).toBeNull();
  });

  it.each([
    [{}, "title"],
    [{ title: "x", severity: "loud" }, "severity"],
    [{ title: "x", ttlSeconds: 0 }, "ttlSeconds"],
    [{ title: "x", ttlSeconds: 8 * 24 * 3600 }, "ttlSeconds"],
    [{ title: "x".repeat(121) }, "title"],
    [{ title: "x", body: "y".repeat(501) }, "body"],
    [[], "object"],
  ])("rejects %j", (input, field) => {
    const result = notificationFromInput(input);
    expect(!result.ok && result.error).toContain(field);
  });

  it("drops expired entries and caps the list", () => {
    const base = Date.parse("2026-10-20T00:00:00Z");
    const list = Array.from({ length: MAX_ACTIVE_NOTIFICATIONS + 3 }, (_, i) => {
      const made = notificationFromInput({ title: `n${i}`, sticky: true }, base + i);
      if (!made.ok) throw new Error("fixture");
      return made.notification;
    });
    const expired = notificationFromInput({ title: "old", ttlSeconds: 1 }, base - 10_000);
    if (!expired.ok) throw new Error("fixture");
    const kept = activeNotifications([...list, expired.notification], base);
    expect(kept).toHaveLength(MAX_ACTIVE_NOTIFICATIONS);
    expect(kept.some((entry) => entry.title === "old")).toBe(false);
    expect(kept.at(-1)?.title).toBe(`n${MAX_ACTIVE_NOTIFICATIONS + 2}`);
  });
});

describe("notification store", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  async function isolatedStore() {
    vi.resetModules();
    const dir = await mkdtemp(path.join(os.tmpdir(), "nova-notifications-"));
    dirs.push(dir);
    vi.stubEnv("NOVA_DASHBOARD_NOTIFICATIONS", path.join(dir, "notifications.json"));
    return import("../notifications");
  }

  it("creates, lists and dismisses", async () => {
    const store = await isolatedStore();
    const created = await store.createNotification({ title: "Deploy done", severity: "success" });
    expect(created.ok).toBe(true);
    expect(await store.readNotifications()).toHaveLength(1);
    const id = created.ok ? created.notification.id : "";
    expect(await store.dismissNotification(id)).toBe(true);
    expect(await store.dismissNotification(id)).toBe(false);
    expect(await store.readNotifications()).toHaveLength(0);
  });

  it("rejects invalid input without writing", async () => {
    const store = await isolatedStore();
    expect((await store.createNotification({ title: "" })).ok).toBe(false);
    expect(await store.readNotifications()).toHaveLength(0);
  });

  it("dismisses everything", async () => {
    const store = await isolatedStore();
    await store.createNotification({ title: "a" });
    await store.createNotification({ title: "b" });
    expect(await store.dismissAllNotifications()).toHaveLength(2);
    expect(await store.readNotifications()).toHaveLength(0);
  });
});
