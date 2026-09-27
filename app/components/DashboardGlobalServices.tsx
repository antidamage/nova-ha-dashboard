"use client";

import { usePathname } from "next/navigation";
import { DemoTooltipLayer } from "./DemoTooltipLayer";
import { ExperienceModeModal } from "./ExperienceModeModal";
import { HapticFeedback } from "./HapticFeedback";
import NovaAvatar from "./NovaAvatar";
import { SmoothScrollController } from "./SmoothScrollController";
import { SystemActivityBlocker } from "./SystemActivityBlocker";
import { TouchClickGuard } from "./TouchClickGuard";
import type { SunThemeStatus, ThemeStorageValue } from "./accentColor";
import BrowserVoiceSatellite from "./dashboard/BrowserVoiceSatellite";
import { useActiveDesignId } from "../design/activeDesign";
import { resolveDesign } from "../design/registry";

type DashboardGlobalServicesProps = {
  initialTheme: ThemeStorageValue | null;
  initialSun: SunThemeStatus | null;
};

// The stream inspector is intentionally a clean diagnostic surface. Mounting
// the dashboard's status orb, voice satellite and first-run modal there both
// obscures the video and spends resources unrelated to stream debugging.
export function DashboardGlobalServices({
  initialTheme,
  initialSun,
}: DashboardGlobalServicesProps) {
  const pathname = usePathname();
  const activeDesignId = useActiveDesignId();

  if (pathname === "/phonoscope-debug") return null;

  // Standalone surfaces that are neither the dashboard nor the config page. The
  // orb is body-level chrome that lands on top of whatever such a page shows, and
  // the first-run chooser has nothing to do with reading one:
  //
  //   - the knob demos are control benches, and that modal at z 10000 covers the
  //     temperature knob's floating rings at 9000, which made the review
  //     screenshots useless;
  //   - /laundry is the washing machine's history read as a bill — by one person
  //     on a phone, and printed — so the orb, the voice satellite and the chooser
  //     are furniture nobody asked for (specs/power-meters.md §5.3).
  //
  // Both keep the haptics, since their controls are touched. Demo-mode builds add
  // a trailing slash.
  const standalone = pathname?.replace(/\/$/, "");
  if (standalone === "/color-encoder-rings" || standalone === "/temperature-encoder" || standalone === "/laundry") {
    return (
      <>
        <TouchClickGuard />
        <HapticFeedback />
      </>
    );
  }

  // The status orb is body-level chrome, but on the dashboard route it is the
  // active Design's call whether it appears at all — that is what makes the
  // `lite` declaration in a design manifest load-bearing rather than a comment.
  // Everywhere else (notably /config, which no design owns) it always renders.
  const onDashboardRoute = pathname === "/";
  const showStatusOrb = !onDashboardRoute || resolveDesign(activeDesignId).lite.statusOrb;

  return (
    <>
      <TouchClickGuard />
      <HapticFeedback />
      <SmoothScrollController />
      <ExperienceModeModal />
      {showStatusOrb ? (
        <NovaAvatar size={200} initialTheme={initialTheme} initialSun={initialSun} />
      ) : null}
      <BrowserVoiceSatellite />
      <DemoTooltipLayer />
      <SystemActivityBlocker />
    </>
  );
}
