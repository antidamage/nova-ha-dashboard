"use client";

import { type CSSProperties, useRef } from "react";
import { usePathname } from "next/navigation";
import { appliedThemeRgb, useDeviceTheme } from "../../accentColor";
import { readExperienceFeatures } from "../../dashboard/experienceModeSetting";
import { useVoiceSpeechPhase } from "../../dashboard/voiceSpeech";
import { useVoiceMode } from "../../dashboard/voiceMode";
import { useStatusOrbInfoSetting } from "../../dashboard/statusOrbInfoSetting";
import { useOrbModule } from "../../orbModules";
import { OrbDialIndicator } from "../../orb-info/OrbDialIndicator";
import { useAgentName } from "../../AgentNameContext";
import { ORB_RADIUS_FRACTION, SIZE, SPEECH_RESOLUTION_BOOST, percentRatio } from "./avatar-model";
import { OrbGlassStack } from "./OrbGlassStack";
import { OrbInfoCounter } from "./OrbInfoCounter";
import type { NovaAvatarProps } from "./types";
import { useAvatarScrollScale } from "./useAvatarScrollScale";
import { useHydratedThemeReady } from "./useHydratedThemeReady";
import { useNovaLoadPoll } from "./useNovaLoadPoll";
import { useOrbAnimationLoop } from "./useOrbAnimationLoop";
import { useOrbFrameRefs } from "./useOrbFrameRefs";
import { useOrbGlass } from "./useOrbGlass";
import { useOrbInfoDial } from "./useOrbInfoDial";
import { useSpeechEndIdleReset, useSpeechMigration, useSpeechOnlyFade } from "./useSpeechMigration";

export function NovaAvatarVisual({
  size = SIZE,
  forceVisible = false,
  forceGymAlert = false,
  className,
  scrollScaleDistance = 300,
  scrollScaleMin = 0.5,
  themeOverride,
  initialTheme,
  initialSun,
  orbInfoModuleId,
  orbInfoDisplay,
  speechOnly = false,
}: NovaAvatarProps & { speechOnly?: boolean }) {
  const { agentName } = useAgentName();
  const pathname = usePathname();
  const hidden = forceVisible ? false : (pathname?.startsWith("/config") ?? false);
  const [statusOrbInfoVisible] = useStatusOrbInfoSetting();
  // Voice-agent speaking state: "speaking" migrates the orb to the viewport
  // centre and pulses the alert colour to the consonant envelope; "ending"
  // runs the return migration. Config previews (forceVisible) never react.
  const speechPhase = useVoiceSpeechPhase();
  const speechActive = !forceVisible && speechPhase !== "idle";
  // Voice-mode state drives the listening glow and the virtual-load pin. Config
  // previews (forceVisible) and the transient speech-only orb never react to it.
  const voice = useVoiceMode();
  const voiceInteractive = !forceVisible && !speechOnly;
  const conversationActive = voiceInteractive && voice.conversationActive;
  // Speech activity is shared by the dashboard event stream, regardless of
  // which device is playing the reply. Keep the existing local listening glow
  // and also show it whenever Nova is speaking on any satellite or browser.
  const voiceGlowActive = conversationActive || speechActive;
  // The parent gate's setting-sync effect runs AFTER this component's own
  // effects on the hydration commit (child effects fire first), so an
  // opted-out device would still start the pollers for one tick. Reading the
  // stored setting synchronously keeps even that first fetch/frame from
  // happening; the gate then unmounts the component for good. This must stay
  // out of the rendered output (hidden) — SSR can't see localStorage, so
  // using it there would break hydration.
  // speechOnly instances exist PRECISELY on opted-out devices, so the opt-out
  // must not disable their pollers/animation for the short speech window.
  const orbOptedOut = !forceVisible && !speechOnly && !readExperienceFeatures().statusOrb;

  const { activeVariant, theme: deviceTheme, themeReady, themeSource } = useDeviceTheme(initialTheme ?? undefined, initialSun ?? undefined);
  const theme = themeOverride ?? deviceTheme.avatar;
  const { hydrated, gymColorReady } = useHydratedThemeReady({ themeOverride, themeReady });


  // The active theme names the orb module to draw with; the hook resolves it
  // against built-ins + host-deployed module files, falling back to classic.
  const orbModule = useOrbModule(theme.orbModule);
  const { glass, glassFilterId, glassEnabled, glassDriftActive, svgBackdrop } = useOrbGlass({ theme, hydrated });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { orbInfo, dialEnabled, dial, shownItem } = useOrbInfoDial({
    hidden,
    orbOptedOut,
    forceVisible,
    speechOnly,
    orbInfoModuleId,
    orbInfoDisplay,
    hostRef,
  });
  const {
    ingestNovaLoadRef,
    targetLoadRef,
    currentLoadRef,
    gymAlertActiveRef,
    themeRef,
    speechEnabledRef,
    voicePinRef,
    rendererRef,
  } = useOrbFrameRefs({ orbInfo, forceGymAlert, theme, forceVisible, conversationActive, orbModule });

  useNovaLoadPoll({ hidden, orbOptedOut, targetLoadRef, ingestNovaLoadRef });

  // Animation loop. All drawing is delegated to the module renderer: this
  // effect only owns the canvas surface, the load easing, and frame timing.
  // While the voice agent speaks the backing store is boosted so the
  // CSS-scaled centred orb stays crisp (the restart keeps arc state — the
  // renderer instance lives in a ref).
  const resolutionBoost = speechActive ? SPEECH_RESOLUTION_BOOST : 1;
  useOrbAnimationLoop({
    canvasRef,
    size,
    hidden,
    orbOptedOut,
    resolutionBoost,
    speechActive,
    voicePinRef,
    targetLoadRef,
    currentLoadRef,
    rendererRef,
    gymAlertActiveRef,
    themeRef,
    speechEnabledRef,
  });

  useAvatarScrollScale({ hostRef, hidden, forceVisible, scrollScaleDistance, scrollScaleMin });

  useSpeechMigration({ hostRef, speechPhase, hidden, forceVisible, speechOnly, size });

  useSpeechEndIdleReset({ speechPhase, voiceInteractive, voice });

  const speechOnlyVisible = useSpeechOnlyFade({ hostRef, speechOnly, speechPhase, size });

  if (hidden) return null;

  gymAlertActiveRef.current = forceGymAlert || (shownItem ? shownItem.alert : orbInfo.alert);
  const gymRgb = appliedThemeRgb(theme.gymNumberColor);
  const gymOpacity = percentRatio(theme.gymNumberOpacity);
  const gymCounterStyle = {
    color: gymColorReady ? `rgba(${gymRgb[0]}, ${gymRgb[1]}, ${gymRgb[2]}, ${gymOpacity})` : "transparent",
  };
  // Orb push-to-talk was removed (Round 2): a tap opens the stack dial or
  // dismisses an alert. `orbTappable` now only gates the stand-down catcher
  // for a live conversation started by wake word or another voice entry.
  const orbTappable = voiceInteractive && voice.tappable;
  // When the orb is enlarged mid-speech, a full-screen catcher lets a tap
  // anywhere stand the turn down (only while it is genuinely enlarged, so it
  // never blocks the dashboard during quiet listening).
  const showTapAnywhere = orbTappable && conversationActive && speechActive;
  // speechOnly hosts use their own class so the data-nova-no-orb / lite CSS
  // that hides .nova-avatar-host (and the body padding it reserves) never
  // applies to the transient speaking orb.
  const hostClass = [
    "nova-avatar-visual",
    speechOnly
      ? `nova-avatar-speech-host${speechOnlyVisible ? " nova-avatar-speech-visible" : ""}`
      : className ?? "nova-avatar-host",
    dialEnabled ? "nova-avatar-tappable" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const voiceGlowRgb = appliedThemeRgb(theme.voiceGlowColor);
  const hostStyle = {
    "--nova-avatar-instance-size": `${size}px`,
    "--nova-avatar-voice-glow": `${voiceGlowRgb[0]}, ${voiceGlowRgb[1]}, ${voiceGlowRgb[2]}`,
    width: size,
    height: size,
    // With glass OFF there is no disc box-shadow, so restore the classic host
    // drop-shadow. With glass ON the host must carry NO filter (it would kill
    // the backdrop-filter refraction) — the disc's box-shadow covers the cast.
    ...(glassEnabled ? {} : { filter: "drop-shadow(0 4px 14px rgba(0, 0, 0, 0.55))" }),
  } as CSSProperties;
  return (
    <>
      {showTapAnywhere ? (
        <button
          type="button"
          className="nova-avatar-tap-anywhere"
          aria-label={`Stop talking to ${agentName}`}
          onClick={voice.endTurn}
        />
      ) : null}
    {/* suppressHydrationWarning: the data-nova-avatar-* attributes derive from
        useDeviceTheme, which deliberately reads the localStorage shared-theme
        cache synchronously on the client to avoid a wrong-colour first frame.
        When the server had no theme to SSR (demo mode / fresh install) the
        first client render legitimately differs from the server markup, and
        the state-driven re-render corrects the attributes immediately. */}
    <div
      ref={hostRef}
      className={hostClass}
      aria-label={`${agentName} avatar`}
      suppressHydrationWarning
      data-demo-tooltip-title="Status Orb"
      data-demo-tooltip="Shows gym attendance and host server load."
      data-nova-avatar-gym-number-color={gymRgb.join(" ")}
      data-nova-avatar-gym-number-opacity={theme.gymNumberOpacity}
      data-nova-avatar-theme-ready={gymColorReady ? "true" : "false"}
      data-nova-orb-module={orbModule.id}
      data-nova-avatar-theme-source={themeOverride === undefined ? themeSource : "override"}
      data-nova-avatar-variant={themeOverride === undefined ? activeVariant : "override"}
      data-nova-avatar-voice={voiceGlowActive ? "active" : undefined}
      data-nova-force-orb-info={forceVisible ? "true" : undefined}
      role="group"
      style={hostStyle}
      data-orb-dial={dialEnabled ? (dial.open ? "open" : "closed") : undefined}
      data-orb-dial-index={dialEnabled ? dial.index : undefined}
      /* Dialling must never drag the page: any press starting on the orb is
         exempt from useClickDragScroll, the way .rotary-encoder-dial is.
         touch-action alone only stops native touch scrolling, which is why
         the orb used to pan the page under the mouse
         (specs/status-orb-stack.md, "The dial never drags the page"). */
      data-nova-no-drag-scroll={dialEnabled ? "true" : undefined}
      tabIndex={dialEnabled ? 0 : undefined}
      {...dial.handlers}
    >
      {dialEnabled ? (
        <OrbDialIndicator
          count={orbInfo.stack.length}
          index={dial.index}
          open={dial.open}
          /* The orb face is smaller than the canvas, which keeps a margin for
             glow spill; the ring belongs on the rim, not the canvas edge. */
          size={size * ORB_RADIUS_FRACTION * 2}
        />
      ) : null}
      <div
        className={`nova-avatar-voice-glow${voiceGlowActive ? " is-visible" : ""}`}
        aria-hidden="true"
      />
      <OrbGlassStack
        glass={glass}
        glassEnabled={glassEnabled}
        svgBackdrop={svgBackdrop}
        glassFilterId={glassFilterId}
        glassDriftActive={glassDriftActive}
        hostRef={hostRef}
        canvasRef={canvasRef}
        size={size}
      />
      <OrbInfoCounter
        forceVisible={forceVisible}
        statusOrbInfoVisible={statusOrbInfoVisible}
        orbInfo={orbInfo}
        speechActive={speechActive}
        gymCounterStyle={gymCounterStyle}
        shownItem={shownItem}
        dialEnabled={dialEnabled}
        dial={dial}
      />
    </div>
    </>
  );
}
