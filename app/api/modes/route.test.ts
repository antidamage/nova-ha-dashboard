import { beforeEach, describe, expect, it, vi } from "vitest";

const preferences = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../../../lib/preferences", () => ({
  readDashboardPreferences: vi.fn(async () => preferences.current),
  mergeDashboardPreferences: vi.fn(async (next: Record<string, unknown>) => {
    // Mirrors the real merge's House Party branch: a caller writing only
    // `enabled` must not lose the colour-behaviour modes beside it.
    const nextPhonoscope = (next.phonoscope ?? {}) as Record<string, unknown>;
    const currentPhonoscope = (preferences.current.phonoscope ?? {}) as Record<string, unknown>;
    preferences.current = {
      ...preferences.current,
      phonoscope: {
        ...currentPhonoscope,
        ...nextPhonoscope,
        ...(nextPhonoscope.houseParty
          ? {
            houseParty: {
              ...(currentPhonoscope.houseParty as Record<string, unknown> ?? {}),
              ...(nextPhonoscope.houseParty as Record<string, unknown>),
            },
          }
          : {}),
      },
    };
  }),
}));

const { GET, POST } = await import("./route");
const { mergeDashboardPreferences } = await import("../../../lib/preferences");

function request(body: unknown) {
  return new Request("http://localhost/api/modes", {
    body: JSON.stringify(body),
    method: "POST",
  });
}

describe("/api/modes", () => {
  beforeEach(() => {
    preferences.current = {
      phonoscope: {
        houseParty: { enabled: false, hueMode: "complement", brightnessMode: "oppose" },
        soloColorThemeId: "midnight",
      },
    };
    vi.clearAllMocks();
  });

  it("reports which modes are on", async () => {
    const payload = await (await GET()).json();

    expect(payload).toEqual({ modes: { "house-party": false } });
  });

  it("turns House Party on and reports the state that landed", async () => {
    const response = await POST(request({ mode: "house-party", enabled: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "house-party", enabled: true });
  });

  it("keeps the sibling House Party settings when only enabled is written", async () => {
    await POST(request({ mode: "house-party", enabled: true }));

    // The colour-behaviour modes belong to the House Party editor, not to this
    // switch: they are carried through, never reasserted with defaults.
    expect(mergeDashboardPreferences).toHaveBeenCalledWith({
      phonoscope: {
        houseParty: { enabled: true, hueMode: "complement", brightnessMode: "oppose" },
      },
    });
    expect(preferences.current.phonoscope).toEqual({
      houseParty: { enabled: true, hueMode: "complement", brightnessMode: "oppose" },
      soloColorThemeId: "midnight",
    });
  });

  it("rejects an unknown mode rather than writing an arbitrary preference", async () => {
    const response = await POST(request({ mode: "phonoscope.soloColorThemeId", enabled: true }));

    expect(response.status).toBe(400);
    expect(mergeDashboardPreferences).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean enabled", async () => {
    const response = await POST(request({ mode: "house-party", enabled: "yes" }));

    expect(response.status).toBe(400);
    expect(mergeDashboardPreferences).not.toHaveBeenCalled();
  });
});
