import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OrbTimer } from "../../lib/orb-timer-model";
import { useDialHarness } from "./controls/rotary/RotaryEncoder.fixtures";

// What the set-timer control reads while a timer runs (specs/status-orb-stack.md,
// "Set-timer control"): a timer whose end belongs to its driver — the wash's — is
// done when that driver says so, never when its own period runs out. The dial's
// own gestures are covered in TimerEncoder.test.tsx; this is the face alone.

const orb = vi.hoisted(() => ({
  command: vi.fn(async () => ({})),
  now: 1_000_000,
  timer: null as OrbTimer | null,
}));

vi.mock("./orb-info/useOrbTimer", () => ({ useOrbTimer: () => ({ timer: orb.timer, now: orb.now, command: orb.command }) }));
vi.mock("./orb-info/useOrbSettings", () => ({ useOrbSettings: () => ({
  entries: [], hasTimer: true, hasWashing: false,
  icons: [{ glyph: { id: "timer", kind: "phosphor" as const }, id: "timer", label: "Countdown" }],
}) }));
vi.mock("./dashboard/controlSound", () => ({ playUxSound: vi.fn() }));

import { TimerEncoder } from "./TimerEncoder";

useDialHarness();

const face = () => document.querySelector(".timer-encoder-face")?.textContent;

describe("the set-timer control's face", () => {
  it("reads a driver-completed timer as its countdown, never Done", () => {
    orb.timer = { autoComplete: false, completedAt: null, dismissedAt: null, durationMs: 4_200_000,
      endsAt: 900_000, icon: "timer", id: "wash", label: "Wash clothes", startedAt: 0 };
    const first = render(<TimerEncoder />);

    expect(face()).toContain("0:00");
    expect(face()).not.toContain("Done");
    first.unmount();
  });

  it("reads Done once that timer has actually finished", () => {
    orb.timer = { autoComplete: false, completedAt: 900_000, dismissedAt: null, durationMs: 4_200_000,
      endsAt: 900_000, icon: "timer", id: "wash", label: "Wash clothes", startedAt: 0 };
    render(<TimerEncoder />);

    expect(face()).toContain("Done");
    expect(screen.getByRole("slider", { name: "Set household timer" })).toBeTruthy();
  });
});
