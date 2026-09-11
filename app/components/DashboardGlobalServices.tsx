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

  // The colour-encoder rings demo (specs/color-encoder.md) is a control
  // bench: the orb would sit over the dials and the first-run modal over the
  // page. It keeps the haptics, since how the dials click is part of the demo.
  // Demo-mode builds add a trailing slash.
  if (pathname?.replace(/\/$/, "") === "/color-encoder-rings") {
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
