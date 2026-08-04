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
  if (pathname === "/phonoscope-debug") return null;

  return (
    <>
      <TouchClickGuard />
      <HapticFeedback />
      <SmoothScrollController />
      <ExperienceModeModal />
      <NovaAvatar size={200} initialTheme={initialTheme} initialSun={initialSun} />
      <BrowserVoiceSatellite />
      <DemoTooltipLayer />
      <SystemActivityBlocker />
    </>
  );
}
