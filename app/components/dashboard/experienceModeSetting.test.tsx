import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EXPERIENCE_MODE_STORAGE_KEY,
  readExperienceFeatures,
  readExperienceModeSetting,
  readStoredExperienceMode,
  setExperienceFeature,
  useExperienceFeature,
  useExperienceFeatures,
  useExperienceMode,
  useLiteMode,
  writeExperienceModeSetting,
} from "./experienceModeSetting";

function ModeHarness() {
  const [mode, setMode] = useExperienceMode();
  return (
    <button type="button" data-mode={mode} onClick={() => setMode(mode === "rich" ? "lite" : "rich")}>
      mode
    </button>
  );
}

function LiteHarness() {
  const lite = useLiteMode();
  return <output data-lite={String(lite)}>lite</output>;
}

function FeatureHarness() {
  const [features, setFeature] = useExperienceFeatures();
  return (
    <button
      type="button"
      data-orb={String(features.statusOrb)}
      data-background={String(features.background)}
      onClick={() => setFeature("background", !features.background)}
    >
      features
    </button>
  );
}

function OrbHarness() {
  const showOrb = useExperienceFeature("statusOrb");
  return <output data-orb={String(showOrb)}>orb</output>;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-nova-lite");
  document.documentElement.removeAttribute("data-nova-no-orb");
});

afterEach(() => {
  cleanup();
});

describe("experienceModeSetting", () => {
  it("treats an absent or invalid key as undecided, resolving to rich for rendering", () => {
    expect(readStoredExperienceMode()).toBeNull();
    expect(readExperienceModeSetting()).toBe("rich");

    window.localStorage.setItem(EXPERIENCE_MODE_STORAGE_KEY, "garbage");
    expect(readStoredExperienceMode()).toBeNull();
    expect(readExperienceModeSetting()).toBe("rich");
  });

  it("write persists the mode, toggles data-nova-lite, and dispatches the change event", () => {
    let events = 0;
    const onChange = () => {
      events += 1;
    };
    window.addEventListener("nova-experience-mode-change", onChange);

    writeExperienceModeSetting("lite");
    expect(window.localStorage.getItem(EXPERIENCE_MODE_STORAGE_KEY)).toBe("lite");
    expect(document.documentElement.hasAttribute("data-nova-lite")).toBe(true);
    expect(events).toBe(1);

    writeExperienceModeSetting("rich");
    expect(window.localStorage.getItem(EXPERIENCE_MODE_STORAGE_KEY)).toBe("rich");
    expect(document.documentElement.hasAttribute("data-nova-lite")).toBe(false);
    expect(events).toBe(2);

    window.removeEventListener("nova-experience-mode-change", onChange);
  });

  it("useExperienceMode reads the stored value after mount and writes through its setter", () => {
    window.localStorage.setItem(EXPERIENCE_MODE_STORAGE_KEY, "lite");
    render(<ModeHarness />);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("data-mode", "lite");

    act(() => {
      button.click();
    });
    expect(button).toHaveAttribute("data-mode", "rich");
    expect(window.localStorage.getItem(EXPERIENCE_MODE_STORAGE_KEY)).toBe("rich");
    expect(document.documentElement.hasAttribute("data-nova-lite")).toBe(false);
  });

  it("hook instances stay in sync via the change event, and cross-tab via storage events", () => {
    render(
      <>
        <ModeHarness />
        <LiteHarness />
      </>,
    );
    const output = screen.getByText("lite");
    expect(output).toHaveAttribute("data-lite", "false");

    // Same-tab write from anywhere (modal, checkbox) syncs every hook.
    act(() => {
      writeExperienceModeSetting("lite");
    });
    expect(output).toHaveAttribute("data-lite", "true");
    expect(screen.getByRole("button")).toHaveAttribute("data-mode", "lite");

    // Cross-tab writes arrive as native storage events.
    act(() => {
      window.localStorage.setItem(EXPERIENCE_MODE_STORAGE_KEY, "rich");
      window.dispatchEvent(new StorageEvent("storage", { key: EXPERIENCE_MODE_STORAGE_KEY }));
    });
    expect(output).toHaveAttribute("data-lite", "false");
  });

  it("reads the legacy rich/lite strings as all-on / all-off feature sets", () => {
    window.localStorage.setItem(EXPERIENCE_MODE_STORAGE_KEY, "rich");
    expect(readExperienceFeatures()).toEqual({
      statusOrb: true,
      background: true,
      camera: true,
      worldMap: true,
    });

    window.localStorage.setItem(EXPERIENCE_MODE_STORAGE_KEY, "lite");
    expect(readExperienceFeatures()).toEqual({
      statusOrb: false,
      background: false,
      camera: false,
      worldMap: false,
    });
  });

  it("setExperienceFeature toggles one feature, keeps a mixed set as JSON, and stays rich", () => {
    setExperienceFeature("background", false);

    const stored = window.localStorage.getItem(EXPERIENCE_MODE_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual({
      statusOrb: true,
      background: false,
      camera: true,
      worldMap: true,
    });
    // A mixed set is not full lite, so it resolves to rich and no kill-switch.
    expect(readExperienceModeSetting()).toBe("rich");
    expect(document.documentElement.hasAttribute("data-nova-lite")).toBe(false);
    expect(readStoredExperienceMode()).toBe("rich");
  });

  it("normalises an all-off feature set back to the canonical lite string", () => {
    setExperienceFeature("statusOrb", false);
    setExperienceFeature("background", false);
    setExperienceFeature("camera", false);
    setExperienceFeature("worldMap", false);

    expect(window.localStorage.getItem(EXPERIENCE_MODE_STORAGE_KEY)).toBe("lite");
    expect(document.documentElement.hasAttribute("data-nova-lite")).toBe(true);
    expect(readExperienceModeSetting()).toBe("lite");
  });

  it("toggles data-nova-no-orb when only the status orb is turned off", () => {
    setExperienceFeature("statusOrb", false);
    expect(document.documentElement.hasAttribute("data-nova-no-orb")).toBe(true);
    // Other features still on → not full lite.
    expect(document.documentElement.hasAttribute("data-nova-lite")).toBe(false);

    setExperienceFeature("statusOrb", true);
    expect(document.documentElement.hasAttribute("data-nova-no-orb")).toBe(false);
  });

  it("useExperienceFeatures/useExperienceFeature read stored state and write through", () => {
    window.localStorage.setItem(
      EXPERIENCE_MODE_STORAGE_KEY,
      JSON.stringify({ statusOrb: true, background: false, camera: true, worldMap: true }),
    );
    render(
      <>
        <FeatureHarness />
        <OrbHarness />
      </>,
    );
    const button = screen.getByRole("button", { name: "features" });
    expect(button).toHaveAttribute("data-orb", "true");
    expect(button).toHaveAttribute("data-background", "false");
    expect(screen.getByText("orb")).toHaveAttribute("data-orb", "true");

    // Toggling background back on syncs every hook instance via the change event.
    act(() => {
      button.click();
    });
    expect(button).toHaveAttribute("data-background", "true");
    expect(window.localStorage.getItem(EXPERIENCE_MODE_STORAGE_KEY)).toBe("rich");
  });

  it("ignores storage events for unrelated keys", () => {
    window.localStorage.setItem(EXPERIENCE_MODE_STORAGE_KEY, "lite");
    render(<LiteHarness />);
    const output = screen.getByText("lite");
    expect(output).toHaveAttribute("data-lite", "true");

    act(() => {
      window.localStorage.setItem(EXPERIENCE_MODE_STORAGE_KEY, "rich");
      window.dispatchEvent(new StorageEvent("storage", { key: "nova.dashboard.accent.v1" }));
    });
    // Unrelated key: the hook must not resync.
    expect(output).toHaveAttribute("data-lite", "true");
  });
});
