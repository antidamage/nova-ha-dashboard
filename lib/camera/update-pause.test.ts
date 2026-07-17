import { afterEach, describe, expect, it, vi } from "vitest";

const updaterBusy = vi.fn(async () => false);
vi.mock("../update", () => ({
  updaterBusy: () => updaterBusy(),
}));

let paused = false;
const setRecordersPaused = vi.fn((next: boolean) => {
  paused = next;
});
const ensureRecorder = vi.fn(async (_camera: unknown) => true);
vi.mock("./recorder", () => ({
  ensureRecorder: (camera: unknown) => ensureRecorder(camera),
  recordersPaused: () => paused,
  setRecordersPaused: (next: boolean) => setRecordersPaused(next),
}));

vi.mock("./config", () => ({
  CAMERAS: [{ id: "outside" }, { id: "inside" }],
}));

describe("camera update pause watcher", () => {
  afterEach(() => {
    paused = false;
    vi.clearAllMocks();
  });

  it("pauses recorders when the updater becomes busy", async () => {
    const { runCameraUpdatePauseTick } = await import("./update-pause");
    updaterBusy.mockResolvedValueOnce(true);

    await runCameraUpdatePauseTick();

    expect(setRecordersPaused).toHaveBeenCalledWith(true);
    expect(ensureRecorder).not.toHaveBeenCalled();
  });

  it("resumes every camera when the updater finishes", async () => {
    const { runCameraUpdatePauseTick } = await import("./update-pause");
    paused = true;

    await runCameraUpdatePauseTick();

    expect(setRecordersPaused).toHaveBeenCalledWith(false);
    expect(ensureRecorder).toHaveBeenCalledTimes(2);
  });

  it("does nothing in steady state", async () => {
    const { runCameraUpdatePauseTick } = await import("./update-pause");

    await runCameraUpdatePauseTick();
    updaterBusy.mockResolvedValueOnce(true);
    paused = true;
    await runCameraUpdatePauseTick();

    expect(setRecordersPaused).not.toHaveBeenCalled();
    expect(ensureRecorder).not.toHaveBeenCalled();
  });
});
