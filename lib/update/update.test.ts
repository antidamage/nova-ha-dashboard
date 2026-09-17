import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { definedSha, isUpdaterBusyState } from "../update";

describe("isUpdaterBusyState", () => {
  it("reports busy for an in-progress phase with a fresh timestamp", () => {
    expect(isUpdaterBusyState({
      schema: 1,
      phase: "building",
      phaseAt: new Date().toISOString(),
    })).toBe(true);
  });

  it("treats a long-stuck busy phase as a dead updater, not busy", () => {
    expect(isUpdaterBusyState({
      schema: 1,
      phase: "building",
      phaseAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    })).toBe(false);
  });

  it("stays busy when the timestamp is missing or unparseable", () => {
    expect(isUpdaterBusyState({ schema: 1, phase: "restarting" })).toBe(true);
  });

  it("is not busy for terminal phases or missing state", () => {
    expect(isUpdaterBusyState({ schema: 1, phase: "success", phaseAt: new Date().toISOString() })).toBe(false);
    expect(isUpdaterBusyState({ schema: 1, phase: "failed", phaseAt: new Date().toISOString() })).toBe(false);
    expect(isUpdaterBusyState(null)).toBe(false);
  });
});

describe("definedSha", () => {
  // The updater writes "currentSha": "" before it has ever deployed anything.
  // An empty string is not nullish, so `state?.currentSha ?? fallbackSha()`
  // accepted it as a real value: the fallback was never consulted and
  // updateAvailable -- which requires a truthy currentSha -- was pinned to
  // false. The dashboard reported "Already up to date ()" for eight days while
  // running an unknown version, and no update could be offered or applied.
  it("treats a blank sha as absent so the fallback is consulted", () => {
    expect(definedSha("")).toBeNull();
    expect(definedSha("   ")).toBeNull();
    expect(definedSha(undefined)).toBeNull();
    expect(definedSha(null)).toBeNull();
  });

  it("keeps a real sha, trimmed", () => {
    expect(definedSha("ae8279f")).toBe("ae8279f");
    expect(definedSha(" ae8279f\n")).toBe("ae8279f");
  });

  it("composes with ?? so an empty state sha falls through", () => {
    const fromState = "";
    const fromEnv = "51cb687";
    expect(definedSha(fromState) ?? fromEnv).toBe("51cb687");
    // Regression guard: the original expression did the opposite.
    expect((fromState as string | null) ?? fromEnv).toBe("");
  });
});

/**
 * The check asks a configurable channel, not GitHub specifically. Both hosts
 * answer the list-commits endpoint with an array, which is why one request
 * shape and one parser cover them; the branch-in-the-path form is GitHub-only
 * and 404s elsewhere. specs/self-update-channel.md.
 */
describe("checkForUpdate", () => {
  const FORGE = "https://forge.example/api/v1";
  const EXPECTED_URL =
    `${FORGE}/repos/antidamage/nova-ha-dashboard/commits?sha=main&per_page=1&limit=1`;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nova-update-"));
    vi.stubEnv("NOVA_UPDATE_DIR", dir);
    // No runtime store, so the channel can only come from the overlay.
    vi.stubEnv("NOVA_DASHBOARD_CONFIG", path.join(dir, "absent-runtime-config.json"));
    writeFileSync(path.join(dir, "household.json"), JSON.stringify({ update: { apiBase: FORGE } }), "utf8");
    vi.stubEnv("NOVA_DASHBOARD_HOUSEHOLD_CONFIG", path.join(dir, "household.json"));
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    rmSync(dir, { recursive: true, force: true });
  });

  function stubFetch(body: unknown, status = 200) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("asks the channel's apiBase and reads the array both hosts return", async () => {
    const fetchMock = stubFetch([
      { sha: "abc1234", commit: { message: "One\n\nbody", committer: { date: "2026-01-01T00:00:00Z" } } },
    ]);
    const { checkForUpdate } = await import("../update");

    const check = await checkForUpdate();

    expect(fetchMock.mock.calls[0][0]).toBe(EXPECTED_URL);
    expect(check.ok).toBe(true);
    expect(check.latestSha).toBe("abc1234");
    expect(check.latestMessage).toBe("One");
    expect(check.latestCommittedAt).toBe("2026-01-01T00:00:00Z");
    expect(check.branch).toBe("main");
  });

  it("tolerates the single-object response too", async () => {
    stubFetch({ sha: "def5678", commit: { message: "Solo" } });
    const { checkForUpdate } = await import("../update");

    const check = await checkForUpdate();

    expect(check.ok).toBe(true);
    expect(check.latestSha).toBe("def5678");
  });

  it("caches the answer where the status reader looks for it", async () => {
    stubFetch([{ sha: "abc1234", commit: { message: "One" } }]);
    const { checkForUpdate, getUpdateStatus } = await import("../update");

    await checkForUpdate();

    const cached = JSON.parse(readFileSync(path.join(dir, "check.json"), "utf8")) as { latestSha?: string };
    expect(cached.latestSha).toBe("abc1234");
    expect((await getUpdateStatus()).latestSha).toBe("abc1234");
  });

  it("sends no Authorization header when no token is configured", async () => {
    const fetchMock = stubFetch([{ sha: "abc1234" }]);
    const { checkForUpdate } = await import("../update");

    await checkForUpdate();

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("uses NOVA_UPDATE_TOKEN in preference to the legacy name", async () => {
    vi.stubEnv("NOVA_GITHUB_TOKEN", "legacy-token");
    vi.stubEnv("NOVA_UPDATE_TOKEN", "channel-token");
    const fetchMock = stubFetch([{ sha: "abc1234" }]);
    const { checkForUpdate } = await import("../update");

    await checkForUpdate();

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer channel-token");
  });

  it("still accepts NOVA_GITHUB_TOKEN alone", async () => {
    vi.stubEnv("NOVA_GITHUB_TOKEN", "legacy-token");
    const fetchMock = stubFetch([{ sha: "abc1234" }]);
    const { checkForUpdate } = await import("../update");

    await checkForUpdate();

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer legacy-token");
  });

  it("records a non-OK response as a failed check, not an update", async () => {
    stubFetch({ message: "Not Found" }, 404);
    const { checkForUpdate } = await import("../update");

    const check = await checkForUpdate();

    expect(check.ok).toBe(false);
    expect(check.latestSha).toBeUndefined();
    expect(check.error).toContain("404");
  });

  it("treats a response with no sha as a failed check", async () => {
    stubFetch([]);
    const { checkForUpdate } = await import("../update");

    const check = await checkForUpdate();

    expect(check.ok).toBe(false);
    expect(check.error).toBe("Update channel response missing sha");
  });
});
