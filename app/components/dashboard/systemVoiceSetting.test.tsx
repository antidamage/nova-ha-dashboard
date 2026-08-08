import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetSystemVoiceStateForTests,
  useSystemVoiceEnabled,
} from "./systemVoiceSetting";

function Harness({ armed }: { armed: boolean }) {
  const enabled = useSystemVoiceEnabled(armed);
  return <output data-enabled={String(enabled)}>system voice</output>;
}

function value(): string | null {
  return screen.getByText("system voice").getAttribute("data-enabled");
}

function respondWith(systemVoiceEnabled: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ voice: { systemVoiceEnabled } }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useSystemVoiceEnabled", () => {
  beforeEach(() => {
    resetSystemVoiceStateForTests();
  });

  afterEach(() => {
    cleanup();
    resetSystemVoiceStateForTests();
    vi.unstubAllGlobals();
  });

  it("never polls and stays false when the device is not armed", async () => {
    const fetchMock = respondWith(true);
    render(<Harness armed={false} />);
    expect(value()).toBe("false");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts false and turns true once the killswitch reads as on", async () => {
    respondWith(true);
    render(<Harness armed />);
    // Fail-safe: not confirmed on yet, so the mic must stay shut.
    expect(value()).toBe("false");
    await waitFor(() => expect(value()).toBe("true"));
  });

  it("stays false while the killswitch is off", async () => {
    const fetchMock = respondWith(false);
    render(<Harness armed />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(value()).toBe("false");
  });

  it("treats a missing flag as on, matching normalizeVoiceSettings", async () => {
    respondWith(undefined);
    render(<Harness armed />);
    await waitFor(() => expect(value()).toBe("true"));
  });

  it("keeps the last known answer when a poll fails", async () => {
    respondWith(true);
    render(<Harness armed />);
    await waitFor(() => expect(value()).toBe("true"));

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(value()).toBe("true");
  });
});
