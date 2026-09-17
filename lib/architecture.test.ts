import { readFileSync, statSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * specs/agent-token-footprint.md: this repo is read by agents, not by Adeline.
 * A file large enough that reading it is a decision is the thing that makes
 * every task expensive, so the cap is on the FILE, not on the repo.
 *
 * The rule needs enforcement for the same reason the no-household-data rule
 * did: splitting a file is easy to skip, and one 80KB file re-absorbs its
 * neighbours over time. This test is the ratchet.
 *
 * ALLOWLIST BELOW IS A BURN-DOWN, NOT A PARKING SPACE. Every entry is a file
 * that predates the convention, recorded at the size it was when the ratchet
 * landed. Two rules keep it from rotting:
 *
 *   - An entry may only ever shrink. A file that grows past its recorded size
 *     fails, so an allowlisted file cannot quietly get worse.
 *   - An entry that no longer needs waiving fails. Split the file, delete the
 *     line.
 *
 * A file may stay large permanently only under one of the criteria in
 * specs/agent-token-footprint.md section 2; mark it `permanent: true` with the
 * criterion named.
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["lib", "app"];
const SOURCE_EXT = new Set([".ts", ".tsx", ".css"]);

/** 10 KB, per the spec. Bytes, not lines: tokens track bytes far more closely. */
const CAP_BYTES = 10 * 1024;

type Allowance = {
  file: string;
  /** Size when the ratchet landed. The file may shrink; it may not grow. */
  bytes: number;
  /**
   * Set only for a file that is CORRECT at this size, with the
   * agent-token-footprint.md section 2 criterion named. Permanent entries are
   * exempt from the shrink-only rule and are never expected to disappear.
   */
  permanent?: string;
};

const ALLOWED: Allowance[] = [
  { file: "lib/aircon-control.test.ts", bytes: 47984, permanent: "section 2 criterion 1 — one table-driven test" },
  { file: "app/components/controls/rotary/RotaryEncoder.tsx", bytes: 39072, permanent: "individual component (Adeline, 2026-09-17): one component — the dial every knob is built on" },
  { file: "app/components/config/accent/AccentConfig.tsx", bytes: 32485, permanent: "individual component (Adeline, 2026-09-17): one component — the accent configuration section" },
  { file: "app/components/dashboard/camera/CameraPanel.tsx", bytes: 30655, permanent: "individual component (Adeline, 2026-09-17): one component — the camera player and timeline" },
  { file: "lib/orb-info/catalogue.data.ts", bytes: 26282, permanent: "section 2 criterion 1 — the orb-info catalogue table" },
  { file: "app/components/dashboard/advanced-fold/AdvancedFold.tsx", bytes: 25249, permanent: "individual component (Adeline, 2026-09-17): one component — the advanced fold and its gestures" },
  { file: "lib/config-schema/dashboard-config.ts", bytes: 24110, permanent: "section 2 criterion 3 — DashboardConfigSchema composes ~15 inline nested objects; extracting them forces a dozen single-consumer exports" },
  { file: "app/styles/responsive/landscape.css", bytes: 21530, permanent: "section 2 criterion 2 — one irreducible @media (aspect-ratio > 1) block; splitting it would emit the at-rule twice and change the cascade" },
  { file: "app/components/dashboard/climate/useAirconCommands.ts", bytes: 20600, permanent: "individual component (Adeline, 2026-09-17): one hook — the aircon command state machine" },
  { file: "app/shell/head-bootstrap-script.ts", bytes: 20484, permanent: "section 2 criterion 1 — one template literal served verbatim as the pre-hydration head script" },
  { file: "app/components/tasks/TasksPanel.tsx", bytes: 18949, permanent: "individual component (Adeline, 2026-09-17): one component — the tasks panel" },
  { file: "app/components/tasks/useTaskAlerts.ts", bytes: 16346 },
  { file: "lib/aircon-control/plan-model.ts", bytes: 16072 },
  { file: "app/components/auth/login-panel/useLoginFlow.ts", bytes: 15753, permanent: "section 2 criterion 2 — one password/passkey/face state machine sharing liveRef, fail, start and applyChallenge" },
  { file: "app/components/theme/accent/useDeviceTheme.ts", bytes: 15674 },
  { file: "lib/demo-config/bootstrap-script.ts", bytes: 14948, permanent: "section 2 criterion 3 — one template literal of browser JS; fragments would only be reassembled by the same caller" },
  { file: "app/components/dashboard/reminders/ReminderIconBar.tsx", bytes: 14775 },
  { file: "lib/voice-transcript/voice-transcript.test.ts", bytes: 14662 },
  { file: "lib/phonoscope-migrate-v3.ts", bytes: 14161 },
  { file: "app/components/dashboard/satellite/runtime.ts", bytes: 14129, permanent: "section 2 criterion 2 — one class sharing private instance state" },
  { file: "lib/phonoscope-effects.ts", bytes: 14090 },
  { file: "app/components/controls/dots/DotLineControl.tsx", bytes: 13901, permanent: "section 2 criterion 2 — gesture handlers share the component's refs" },
  { file: "lib/voice-settings/normalize-model.ts", bytes: 13855, permanent: "section 2 criterion 3 — splitting per-field readers needs ~10 single-consumer exports" },
  { file: "app/components/controls/dots/DotEnvelopeControl.tsx", bytes: 13685, permanent: "section 2 criterion 2 — gesture handlers share the component's refs" },
  { file: "lib/authentik-flow/authentik-flow.test.ts", bytes: 12884 },
  { file: "lib/orb-modules/layer-model.ts", bytes: 12668, permanent: "section 2 criterion 3 — moving its helpers out needs 8 exports whose only caller is normalizeOrbLayer" },
  { file: "lib/ha/client.ts", bytes: 12662 },
  { file: "lib/desktop-theme-actions/windows-terminal.test.ts", bytes: 12641 },
  { file: "app/components/face/capture/useFaceCapture.ts", bytes: 12314, permanent: "section 2 criterion 2 — capture steps share streamRef, recorderRef, clipTimerRef and videoRef" },
  { file: "app/components/dashboard/power/PowerPanel.tsx", bytes: 12149, permanent: "section 2 criterion 2 — one render tree" },
  { file: "app/components/theme/accent/defaults.ts", bytes: 12103, permanent: "section 2 criterion 1 — the two shipped theme tables" },
  { file: "lib/dashboard-config.ts", bytes: 12051 },
  { file: "lib/phonoscope-effect-groups.ts", bytes: 12045 },
  { file: "app/components/dashboard/state/useDashboardCommands.ts", bytes: 11872, permanent: "section 2 criterion 2 — one hook sharing sequence counters, timers and abort controller" },
  { file: "app/components/config/reminders/RemindersConfig.tsx", bytes: 11848, permanent: "section 2 criterion 2 — callbacks share roster and config state" },
  { file: "app/components/dashboard/zones/ZoneControls.test.tsx", bytes: 11741 },
  { file: "app/components/dashboard/state/useDashboardState.ts", bytes: 11737, permanent: "section 2 criterion 2 — poll loop, SSE handler and stall watchdog share refs" },
  { file: "lib/voice-settings/update-model.ts", bytes: 11669, permanent: "section 2 criterion 3 — splitting validators needs ~13 single-consumer exports" },
  { file: "app/components/tasks/TaskEditor.tsx", bytes: 11653, permanent: "section 2 criterion 2 — one form over one draft state" },
  { file: "lib/orb-modules/tech.data.ts", bytes: 11650, permanent: "section 2 criterion 1 — one built-in orb module document" },
  { file: "app/components/Dashboard.tsx", bytes: 11604 },
  { file: "lib/no-household-data.test.ts", bytes: 11485 },
  { file: "lib/modules/runtime/store.test.ts", bytes: 11361 },
  { file: "app/components/avatar/nova-avatar/NovaAvatarVisual.tsx", bytes: 11250, permanent: "section 2 criterion 3 — host wiring; further split needs ~20 pass-through props" },
  { file: "lib/preferences/store.ts", bytes: 10618, permanent: "section 2 criterion 2 — write queue, per-section merge and atomic write kept together so no merge branch is lost" },
  { file: "lib/ha/lighting/zone-action.ts", bytes: 10439, permanent: "section 2 criterion 2 — one function, setZoneAction" },
  { file: "app/components/theme/accent/store.ts", bytes: 10337, permanent: "section 2 criterion 2 — the package's single state owner" },
  { file: "app/components/dashboard/zones/ZoneControls.tsx", bytes: 10334, permanent: "section 2 criterion 2 — one component reading its own hook state" },
];

/**
 * Table-driven tests are the one shape where size is a virtue: the alternative
 * is the same assertions spread over files that must be read together anyway.
 * specs/agent-token-footprint.md section 2 makes these permanent.
 */
const PERMANENT_TEST_FILES = new Set([
  "lib/aircon-control.test.ts",
  "lib/phonoscope-drivers/phonoscope-drivers.test.ts",
  // This file: section 2 criterion 1, a single cohesive table. The allowlist is
  // the content, and it shrinks on its own as the burn-down proceeds.
  "lib/architecture.test.ts",
]);

function trackedSourceFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", ...SCAN_DIRS], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => SOURCE_EXT.has(path.extname(f)));
}

function sizeOf(file: string): number | null {
  try {
    return statSync(path.join(ROOT, file)).size;
  } catch {
    return null; // tracked but deleted in the working tree
  }
}

const allowanceFor = new Map(ALLOWED.map((a) => [a.file, a]));

describe("file size ratchet", () => {
  it("has no source file over the cap that is not allowed", () => {
    const offenders = trackedSourceFiles()
      .filter((f) => !PERMANENT_TEST_FILES.has(f))
      .map((file) => ({ file, bytes: sizeOf(file) ?? 0 }))
      .filter(({ file, bytes }) => bytes > CAP_BYTES && !allowanceFor.has(file));

    const report = offenders
      .map(({ file, bytes }) => `  ${file} (${(bytes / 1024).toFixed(1)} KB)`)
      .join("\n");

    expect(
      offenders,
      offenders.length
        ? `${offenders.length} file(s) over ${CAP_BYTES / 1024} KB with no allowance:\n${report}\n\n` +
            `Split them per specs/agent-token-footprint.md sections 3 and 4. If one genuinely ` +
            `cannot be split, add it to ALLOWED with \`permanent\` naming the section 2 criterion.`
        : "",
    ).toEqual([]);
  });

  it("has no allowed file that grew", () => {
    const grown = ALLOWED.filter((a) => !a.permanent).flatMap((a) => {
      const bytes = sizeOf(a.file);
      return bytes !== null && bytes > a.bytes ? [{ ...a, now: bytes }] : [];
    });

    const report = grown
      .map((g) => `  ${g.file}: ${(g.bytes / 1024).toFixed(1)} KB -> ${(g.now / 1024).toFixed(1)} KB`)
      .join("\n");

    expect(
      grown,
      grown.length
        ? `${grown.length} allowed file(s) grew. An allowance may only shrink:\n${report}\n\n` +
            `Put the new code in a sibling under the file's package directory instead.`
        : "",
    ).toEqual([]);
  });

  it("has no stale allowance, so the burn-down cannot rot", () => {
    const stale = ALLOWED.filter((a) => {
      if (a.permanent) return false;
      const bytes = sizeOf(a.file);
      return bytes === null || bytes <= CAP_BYTES;
    }).map((a) => a.file);

    expect(
      stale,
      stale.length
        ? `${stale.length} allowance(s) no longer needed — delete these lines:\n${stale
            .map((f) => `  ${f}`)
            .join("\n")}`
        : "",
    ).toEqual([]);
  });
});

describe("types.ts is type-only", () => {
  /**
   * `types.ts` sits at the top of the dependency direction in
   * specs/agent-token-footprint.md section 3.2 precisely so that importing a
   * shape never drags runtime code in behind it. A value import here is what
   * turns a 2KB type read into a whole package.
   */
  it("has no runtime import in any types.ts", () => {
    const offenders = trackedSourceFiles()
      .filter((f) => path.basename(f) === "types.ts")
      .flatMap((file) => {
        const src = readFileSync(path.join(ROOT, file), "utf8");
        const bad = [...src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s*["']([^"']+)["']/gm)].map(
          (m) => `${file} -> ${m[1]}`,
        );
        return bad;
      });

    expect(
      offenders,
      offenders.length
        ? `types.ts must use \`import type\` only:\n${offenders.map((o) => `  ${o}`).join("\n")}`
        : "",
    ).toEqual([]);
  });
});

describe("test fixtures stay test-only", () => {
  /**
   * lib/no-household-data.test.ts skips *.fixtures.* files because they hold
   * sample entity ids and timezones for tests. That exemption is only sound
   * while no product code imports a fixture.
   */
  it("has no product source importing a *.fixtures helper", () => {
    const offenders = trackedSourceFiles()
      .filter((file) => !/\.(test|spec|fixtures)\.tsx?$/.test(file))
      .filter((file) => /from\s+["'][^"']*\.fixtures["']/.test(readFileSync(path.join(ROOT, file), "utf8")));

    const report = offenders.map((file) => `  ${file}`).join("\n");
    expect(offenders, offenders.length ? `product source imports test fixtures:\n${report}` : "").toEqual([]);
  });
});
