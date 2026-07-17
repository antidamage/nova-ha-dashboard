import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function okResponse() {
  return {
    json: async () => [],
    ok: true,
  };
}

type MockResponse = ReturnType<typeof okResponse>;
type MockFetchCall = [RequestInfo | URL, RequestInit?];

async function loadClient() {
  vi.resetModules();
  process.env.HA_TOKEN = "test-token";
  process.env.HA_URL = "http://ha.local";
  return import("./client");
}

describe("Home Assistant latest service calls", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces unsent pending service calls with the newest value for a lane", async () => {
    const { callService, resetLatestServiceLanesForTest } = await loadClient();
    resetLatestServiceLanesForTest();

    const first = callService(
      "light",
      "turn_on",
      { brightness_pct: 10, entity_id: "light.desk" },
      { latestKey: "light:light.desk" },
    );
    const second = callService(
      "light",
      "turn_on",
      { brightness_pct: 90, entity_id: "light.desk" },
      { latestKey: "light:light.desk" },
    );

    await Promise.all([first, second]);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as MockFetchCall;
    expect(JSON.parse(String(init?.body))).toEqual({
      brightness_pct: 90,
      entity_id: "light.desk",
    });
  });

  it("keeps only the newest pending value while a lane is active", async () => {
    let resolveActiveFetch: ((value: MockResponse) => void) | undefined;
    const fetchMock = vi.fn((..._args: MockFetchCall): Promise<MockResponse> => {
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<MockResponse>((resolve) => {
          resolveActiveFetch = resolve;
        });
      }

      return Promise.resolve(okResponse());
    });
    vi.stubGlobal("fetch", fetchMock);

    const { callService, resetLatestServiceLanesForTest } = await loadClient();
    resetLatestServiceLanesForTest();

    const first = callService(
      "light",
      "turn_on",
      { brightness_pct: 10, entity_id: "light.desk" },
      { latestKey: "light:light.desk" },
    );
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    const second = callService(
      "light",
      "turn_on",
      { brightness_pct: 30, entity_id: "light.desk" },
      { latestKey: "light:light.desk" },
    );
    const third = callService(
      "light",
      "turn_on",
      { brightness_pct: 90, entity_id: "light.desk" },
      { latestKey: "light:light.desk" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (!resolveActiveFetch) {
      throw new Error("Active fetch was not started");
    }
    resolveActiveFetch(okResponse());
    await Promise.all([first, second, third]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1] as MockFetchCall;
    expect(JSON.parse(String(init?.body))).toEqual({
      brightness_pct: 90,
      entity_id: "light.desk",
    });
  });
});
