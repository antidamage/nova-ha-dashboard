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
  { file: "app/styles/responsive/landscape.css", bytes: 21530, permanent: "section 2 criterion 2 — one irreducible @media (aspect-ratio > 1) block; splitting it would emit the at-rule twice and change the cascade" },
  { file: "lib/power.ts", bytes: 82909 },
  { file: "app/components/accentColor.ts", bytes: 82139 },
  { file: "app/components/AccentConfig.tsx", bytes: 77028 },
  { file: "lib/orb-modules.ts", bytes: 74198 },
  { file: "lib/ha.ts", bytes: 60532 },
  { file: "app/components/TasksPanel.tsx", bytes: 58380 },
  { file: "app/components/VoiceConfig.tsx", bytes: 55109 },
  { file: "app/components/VoiceInfrastructureConfig.tsx", bytes: 54870 },
  { file: "app/components/DotControls.tsx", bytes: 53732 },
  { file: "app/components/RotaryEncoder.tsx", bytes: 53490 },
  { file: "lib/phonoscope-store.ts", bytes: 51673 },
  { file: "lib/aircon-control.test.ts", bytes: 47984, permanent: "section 2 criterion 1 — one table-driven test" },
  { file: "lib/voice-host-settings.ts", bytes: 47764 },
  { file: "lib/voice-settings.ts", bytes: 46916 },
  { file: "lib/aircon-control.ts", bytes: 45996 },
  { file: "lib/climate-control.ts", bytes: 44586 },
  { file: "lib/camera/recorder.ts", bytes: 42894 },
  { file: "lib/config-schema.ts", bytes: 41653 },
  { file: "lib/dashboard-events.ts", bytes: 41332 },
  { file: "lib/phonoscope-drivers.ts", bytes: 41050 },
  { file: "lib/types.ts", bytes: 39216 },
  { file: "app/components/dashboard/climateCommands.ts", bytes: 36884 },
  { file: "app/components/dashboard/CameraPanel.tsx", bytes: 36198 },
  { file: "lib/phonoscope-theme-state.ts", bytes: 35666 },
  { file: "lib/phonoscope-drivers.test.ts", bytes: 35256, permanent: "section 2 criterion 1 — one table-driven test" },
  { file: "app/components/orbRenderer.ts", bytes: 34143 },
  { file: "lib/tasks.ts", bytes: 32926 },
  { file: "app/components/NovaAvatar.tsx", bytes: 32454 },
  { file: "lib/phonoscope-theme-state.test.ts", bytes: 32437 },
  { file: "app/layout.tsx", bytes: 32250 },
  { file: "app/components/ConfigWorkspace.tsx", bytes: 32195 },
  { file: "lib/managed-computers.ts", bytes: 30768 },
  { file: "lib/phonoscope.ts", bytes: 30517 },
  { file: "app/components/MapPanel.tsx", bytes: 30176 },
  { file: "lib/orb-info/catalogue.ts", bytes: 29013 },
  { file: "app/components/NovaOrbGlass.tsx", bytes: 28668 },
  { file: "app/components/face/faceCapture.ts", bytes: 28225 },
  { file: "app/components/NovaAvatarConfig.tsx", bytes: 28130 },
  { file: "app/components/AgentAdministration.tsx", bytes: 27134 },
  { file: "app/components/phonoscope/EffectEntry.tsx", bytes: 27100 },
  { file: "app/components/auth/LoginPanel.tsx", bytes: 26732 },
  { file: "app/components/dashboard/AdvancedFold.tsx", bytes: 26382 },
  { file: "lib/phonoscope-tracks.ts", bytes: 25798 },
  { file: "app/components/RotaryEncoder.test.tsx", bytes: 25303 },
  { file: "app/components/phonoscope/SettingsGroupLibrary.tsx", bytes: 23894 },
  { file: "app/components/ColorEncoder.test.tsx", bytes: 23353 },
  { file: "lib/mcp-dashboard.ts", bytes: 22947 },
  { file: "app/components/phonoscope/effectCatalogue.ts", bytes: 22921 },
  { file: "app/components/ModulesConfig.tsx", bytes: 22813 },
  { file: "app/components/CameraConfig.tsx", bytes: 22753 },
  { file: "app/components/ConfigControls.tsx", bytes: 22454 },
  { file: "app/components/orb-info/useOrbInfo.ts", bytes: 21977 },
  { file: "app/components/StatusOrbInfoConfig.tsx", bytes: 21255 },
  { file: "app/components/dashboard/state.ts", bytes: 21178 },
  { file: "lib/managed-desktop-sync.test.ts", bytes: 20314 },
  { file: "app/components/SpeakerProfilesConfig.tsx", bytes: 20158 },
  { file: "lib/managed-desktop-sync.ts", bytes: 20155 },
  { file: "app/components/FluidBackground.tsx", bytes: 19639 },
  { file: "lib/icloud-sync.ts", bytes: 19615 },
  { file: "app/components/PhonoscopeConfig.tsx", bytes: 19534 },
  { file: "app/components/dashboard/ClimateControls.tsx", bytes: 19320 },
  { file: "app/components/dashboard/PowerPanel.tsx", bytes: 18814 },
  { file: "lib/modules/runtime/store.ts", bytes: 18581 },
  { file: "lib/voice-settings.test.ts", bytes: 18266 },
  { file: "lib/authentik-flow.ts", bytes: 17707 },
  { file: "app/components/FaceEnrolmentConfig.tsx", bytes: 17556 },
  { file: "app/components/CameraAnalysisConfig.tsx", bytes: 17375 },
  { file: "app/components/dashboard/QuickAccessCard.tsx", bytes: 17371 },
  { file: "app/components/dashboard/ZoneLightEvents.tsx", bytes: 17286 },
  { file: "app/components/DotControls.test.tsx", bytes: 17280 },
  { file: "lib/voice-transcript.ts", bytes: 17172 },
  { file: "lib/zone-light-rules.ts", bytes: 17018 },
  { file: "lib/preferences-history.ts", bytes: 16998 },
  { file: "lib/phonoscope-images.ts", bytes: 16786 },
  { file: "app/components/ColorEncoderRings.test.tsx", bytes: 16706 },
  { file: "lib/demo-config.ts", bytes: 16678 },
  { file: "app/components/dashboard/ReminderIconBar.tsx", bytes: 16644 },
  { file: "lib/bedroom-heater-control.test.ts", bytes: 15850 },
  { file: "app/components/dashboard/ZoneControls.tsx", bytes: 15528 },
  { file: "lib/bedroom-heater-control.ts", bytes: 15185 },
  { file: "app/components/avatarThemeModel.ts", bytes: 15013 },
  { file: "lib/reminder-icons.ts", bytes: 14994 },
  { file: "lib/doorbell.ts", bytes: 14888 },
  { file: "app/components/VoiceTrainingConfig.tsx", bytes: 14801 },
  { file: "app/components/dashboard/shared.ts", bytes: 14691 },
  { file: "app/components/phonoscope/ColorGroupEditor.tsx", bytes: 14687 },
  { file: "lib/voice-transcript.test.ts", bytes: 14661 },
  { file: "app/components/dashboard/browserSatellite.ts", bytes: 14630 },
  { file: "lib/phonoscope.test.ts", bytes: 14271 },
  { file: "app/components/dashboard/CameraEventReport.tsx", bytes: 14224 },
  { file: "app/components/accentColor.test.ts", bytes: 14187 },
  { file: "lib/phonoscope-migrate-v3.ts", bytes: 14161 },
  { file: "lib/phonoscope-effects.ts", bytes: 14090 },
  { file: "app/components/ManagedComputersConfig.tsx", bytes: 13933 },
  { file: "lib/washing-machine.ts", bytes: 13893 },
  { file: "lib/doorbell.test.ts", bytes: 13884 },
  { file: "app/components/RemindersConfig.tsx", bytes: 13666 },
  { file: "app/components/dashboard/PowerMeters.tsx", bytes: 13528 },
  { file: "lib/washing-machine.test.ts", bytes: 13349 },
  { file: "lib/orb-modules.test.ts", bytes: 13260 },
  { file: "lib/reminder-glyph.ts", bytes: 13048 },
  { file: "app/components/dashboard/useDashboardCommands.ts", bytes: 12988 },
  { file: "lib/authentik-flow.test.ts", bytes: 12883 },
  { file: "app/components/dashboard/AdvancedFold.test.tsx", bytes: 12882 },
  { file: "lib/ha/client.ts", bytes: 12662 },
  { file: "lib/desktop-theme-actions/windows-terminal.test.ts", bytes: 12641 },
  { file: "lib/tasks.test.ts", bytes: 12558 },
  { file: "lib/orb-info/catalogue.test.ts", bytes: 12541 },
  { file: "app/components/rotaryEncoderGeometry.ts", bytes: 12461 },
  { file: "app/components/CompanionStatusCard.tsx", bytes: 12283 },
  { file: "app/components/AgentConfig.tsx", bytes: 12276 },
  { file: "lib/dashboard-config.ts", bytes: 12051 },
  { file: "lib/phonoscope-effect-groups.ts", bytes: 12045 },
  { file: "lib/household-events.ts", bytes: 11898 },
  { file: "app/components/dashboard/ZoneControls.test.tsx", bytes: 11732 },
  { file: "app/components/Dashboard.tsx", bytes: 11604 },
  { file: "app/components/tasks/task-model.ts", bytes: 11600 },
  { file: "lib/kiosk-witness.ts", bytes: 11488 },
  { file: "app/components/dashboard/ClimateKnobs.tsx", bytes: 11449 },
  { file: "lib/modules/runtime/loader.ts", bytes: 11413 },
  { file: "lib/power-estimation.ts", bytes: 11366 },
  { file: "lib/modules/runtime/store.test.ts", bytes: 11361 },
  { file: "lib/no-household-data.test.ts", bytes: 11317 },
  { file: "lib/desktop-theme-actions/jsonc-profile-patch.ts", bytes: 11265 },
  { file: "app/components/phonoscope/effectCatalogue.test.ts", bytes: 11062 },
  { file: "app/components/UpdateConfig.tsx", bytes: 10936 },
  { file: "app/components/HistoryPanel.tsx", bytes: 10829 },
  { file: "app/api/radar/[z]/[x]/[y]/route.ts", bytes: 10791 },
  { file: "lib/update.ts", bytes: 10506 },
  { file: "lib/preferences.ts", bytes: 10438 },
  { file: "app/components/SystemActivityBlocker.tsx", bytes: 10315 },
];

/**
 * Table-driven tests are the one shape where size is a virtue: the alternative
 * is the same assertions spread over files that must be read together anyway.
 * specs/agent-token-footprint.md section 2 makes these permanent.
 */
const PERMANENT_TEST_FILES = new Set([
  "lib/aircon-control.test.ts",
  "lib/phonoscope-drivers.test.ts",
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
