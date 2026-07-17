import { afterEach, describe, expect, it } from "vitest";
import { CAMERAS } from "./config";
import { ensureRecorder, recordersPaused, setRecordersPaused } from "./recorder";

describe("recorder pause gate", () => {
  afterEach(() => {
    setRecordersPaused(false);
  });

  it("refuses to start a recorder while paused", async () => {
    // The camera routes call ensureRecorder on every status/segment request;
    // without this gate an open dashboard would restart the feed mid-update.
    setRecordersPaused(true);
    expect(recordersPaused()).toBe(true);
    expect(await ensureRecorder(CAMERAS[0])).toBe(false);
  });
});
