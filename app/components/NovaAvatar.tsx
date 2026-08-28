"use client";

import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { appliedThemeRgb, useDeviceTheme, type SunThemeStatus, type ThemeStorageValue } from "./accentColor";
import type { NovaAvatarTheme } from "./avatarThemeModel";
import { resolveOrbModuleSettings } from "../../lib/orb-modules";
import { readExperienceFeatures, useExperienceFeature, useLiteMode } from "./dashboard/experienceModeSetting";
import {
  NovaOrbGlassBackdropCopy,
  NovaOrbGlassFilter,
  NovaOrbGlassLayers,
  glassBoxShadow,
  glassCanvasMask,
  glassCanvasOpacity,
  glassCssBackdropFilter,
  supportsSvgBackdropFilter,
} from "./NovaOrbGlass";
import { sampleVoiceSpeechEnvelope, useVoiceSpeechPhase } from "./dashboard/voiceSpeech";
import { markInput as markVoiceInput, useVoiceMode } from "./dashboard/voiceMode";
import { arePageUpdatesPaused } from "./dashboard/pageUpdatePause";
import { useStatusOrbInfoSetting } from "./dashboard/statusOrbInfoSetting";
import { buildOrbPalette, useOrbModule } from "./orbModules";
import { useOrbInfo } from "./orb-info/useOrbInfo";
import type { OrbInfoDisplay } from "../../lib/orb-info/types";
import { createOrbRenderer, type OrbRenderer } from "./orbRenderer";
import { useAgentName } from "./AgentNameContext";

type LoadResponse = {
  cpu: number;
  net: number;
  gpu: number;
  listening: boolean;
  load: number;
};

// Default rendered size in CSS pixels; callers can override via the `size`
// prop (e.g. the 150 px config preview).
const SIZE = 128;

// The orb's radius as a fraction of the canvas size. Module layers use unit
// space where 1.0 = this radius, so the canvas keeps a small margin for glow
// spill from layers that extend slightly past the rim.
const ORB_RADIUS_FRACTION = 0.48;

// Load polling cadence. This was 100ms -- ten requests a second, forever, from
// every open dashboard. It bought nothing visually (LOAD_EASE below smooths the
// orb over about a second regardless) and it wedged the kiosk: each response
// holds a shared-memory data pipe until the renderer garbage-collects it, and at
// 10Hz the renderer walked its 1024-descriptor limit in under an hour, after
// which the page froze and the watchdog killed the browser. Keep this well above
// the easing time constant.
const POLL_MS = 2000;
const LOAD_EASE = 1.0; // ease toward server-reported load

// While the voice agent speaks, the canvas backing store is rendered at a
// higher resolution so the CSS-scaled centred orb stays crisp.
const SPEECH_RESOLUTION_BOOST = 2;
// The return migration must outlast the CSS transition (globals.css).
const SPEECH_RETURN_FALLBACK_MS = 600;

/** How large the speaking orb should be relative to the viewport. */
function speechScaleFor(viewportWidth: number, viewportHeight: number, size: number) {
  const target = Math.min(viewportWidth, viewportHeight) * 0.45;
  return Math.max(1.3, Math.min(3, target / size));
}

function percentRatio(value: number | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(1, parsed / 100));
}

type NovaAvatarProps = {
  size?: number;
  forceVisible?: boolean;
  forceGymAlert?: boolean;
  className?: string;
  scrollScaleDistance?: number;
  scrollScaleMin?: number;
  themeOverride?: NovaAvatarTheme;
  // Server-rendered theme so the canvas paints the saved colours on its very
  // first frame. The orb is a canvas driven purely by React state, so unlike
  // the rest of the UI it cannot be seeded by the synchronous head-bootstrap
  // (which only sets CSS variables). Without this it falls back to the
  // compiled-in default theme until the async /api/theme fetch lands — the
  // "wrong colour on first load" flash. Null in demo mode / when unset.
  initialTheme?: ThemeStorageValue | null;
  // Server-known sun status so an "auto" theme selection resolves the correct
  // dark/light variant on the first render (SSR included) instead of the
  // hour-of-day guess. Null when the server has no state snapshot yet.
  initialSun?: SunThemeStatus | null;
  // Status orb info module overrides. The config preview drives both directly
  // so it renders the setting being edited rather than the saved one.
  orbInfoModuleId?: string;
  orbInfoDisplay?: OrbInfoDisplay;
};

// Status-orb feature gate: when the status orb is turned off the visual never
// mounts, so none of its hooks run — no theme/orb-module fetches, no 100 ms
// load poll, no gym-counter poll, no canvas animation loop. SSR still emits
// the markup (the server can't see localStorage); the head bootstrap in
// layout.tsx hides it via CSS (html[data-nova-lite] / html[data-nova-no-orb])
// before first paint and this gate unmounts it right after hydration. Config
// previews pass forceVisible and are never suppressed.
export default function NovaAvatar(props: NovaAvatarProps) {
  const showOrb = useExperienceFeature("statusOrb");
  const speechPhase = useVoiceSpeechPhase();
  if (!props.forceVisible && !showOrb) {
    // The voice agent's speaking orb appears on EVERY connected client, orb
    // feature setting included: while speech is live a centred speech-only
    // orb mounts (fading in/out in place instead of migrating), then unmounts
    // completely so opted-out devices pay nothing when Nova is quiet.
    if (speechPhase === "idle") {
      return null;
    }
    return <NovaAvatarVisual {...props} speechOnly />;
  }
  return <NovaAvatarVisual {...props} />;
}

function NovaAvatarVisual({
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
  // Two-pass hydration guard — the actual fix for the long-standing "gym number
  // is transparent (a translucent black) after a reload" bug. The host div sets
  // suppressHydrationWarning because its theme-derived output comes from a
  // client-only localStorage read the server can't see, and the page is
  // force-static so the server prerenders the digit transparent (themeReady
  // false, no data/ dir at build). On a *warm* reload the client's first render
  // instead computes themeReady=true from the warm shared-theme cache — a
  // mismatch. Because of suppressHydrationWarning React keeps the stale server
  // DOM AND treats the client's (correct) values as its committed baseline, so
  // no later state change ever diffs the digit back into view: it stays
  // transparent forever even though the React state is perfect. (A cold load
  // works only because its first render also computes false, matching the
  // server, so the later false->true flip is a real diff that repaints.)
  //
  // Starting `hydrated` false makes the first client render match the server
  // (transparent), then flipping it in a mount effect guarantees a genuine
  // false->true transition React must reconcile — forcing the saved gym colour
  // to actually paint. Overrides (config preview) are unaffected.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const gymColorReady = themeOverride !== undefined || (hydrated && themeReady);

  // The active theme names the orb module to draw with; the hook resolves it
  // against built-ins + host-deployed module files, falling back to classic.
  const orbModule = useOrbModule(theme.orbModule);

  // "Liquid glass" overlay (SVG displacement + silver-room reflection + gloss;
  // see NovaOrbGlass). Each mount gets a unique filter id so multiple orbs
  // (dashboard + config preview) don't collide on one <filter>. The reflection
  // drift only runs when it can actually be seen and lite mode allows motion.
  const glass = theme.glass;
  const lite = useLiteMode();
  const rawFilterId = useId();
  // Chromium caches backdrop-filter URL references aggressively. Include every
  // filter-shaping value in the id so slider/checkbox edits force a rebuild.
  const glassFilterId = [
    `nova-orb-glass-${rawFilterId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    glass.displace,
    glass.refractPower,
    glass.smoothness,
    glass.localStretch + 100,
    glass.flipVertical ? 1 : 0,
    // ×2 keeps the 0.5-step blur an integer so the id has no "." (kept valid
    // as a url(#id) reference).
    Math.round(glass.imageBlur * 2),
    glass.refractionOpacity,
  ].join("-");
  const glassEnabled = glass.enabled;
  const glassDriftActive = glassEnabled && !lite && glass.reflection > 0 && glass.drift > 0;
  // WebKit / iOS ignore `backdrop-filter: url(#svg)`, so the displacement
  // refraction never paints there — fall back to a CSS filter-function frost.
  // Gated on `hydrated` so SSR and the first client paint both use the SVG path
  // (no hydration mismatch); the detection only kicks in after mount.
  const svgBackdrop = !hydrated || supportsSvgBackdropFilter();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The readout is a selectable "status orb info module" (lib/orb-info): the orb
  // asks the module for its output and renders whatever the module's display
  // config formats it into. It knows nothing about gyms, CPUs or thermometers.
  const orbInfo = useOrbInfo({
    enabled: !hidden && !orbOptedOut,
    moduleIdOverride: orbInfoModuleId,
    displayOverride: orbInfoDisplay,
  });
  // Read by the load poll without making the hook a dependency of that effect
  // (which would tear the 2s poll down and rebuild it on every readout change).
  const ingestNovaLoadRef = useRef(orbInfo.ingestNovaLoad);
  ingestNovaLoadRef.current = orbInfo.ingestNovaLoad;
  // Mutable references — avoid re-creating the animation loop on data tick.
  const targetLoadRef = useRef(0);
  const currentLoadRef = useRef(0);
  const gymAlertActiveRef = useRef(forceGymAlert);
  const themeRef = useRef<NovaAvatarTheme>(theme);
  themeRef.current = theme;
  // Read by the draw loop each frame without retriggering the effect.
  const speechEnabledRef = useRef(!forceVisible);
  speechEnabledRef.current = !forceVisible;
  // While a voice conversation is live this device pins the orb's virtual load
  // to 100; the draw loop eases toward it and eases back to the real server
  // load once the conversation ends. Kept in a ref so it's read per-frame
  // without restarting the animation loop.
  const voicePinRef = useRef(false);
  voicePinRef.current = conversationActive;
  // The renderer holds the module's arcField animation state; it is swapped
  // (and the animation restarted) only when the module itself changes. Theme
  // color edits flow through the per-frame palette without touching it.
  const rendererRef = useRef<OrbRenderer | null>(null);
  if (rendererRef.current?.module !== orbModule) {
    rendererRef.current = createOrbRenderer(orbModule);
  }

  useEffect(() => {
    if (hidden || orbOptedOut) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/nova-load", { cache: "no-store" });
        if (!r.ok) {
          // Drop the body explicitly: an unread response keeps its data pipe --
          // and the descriptor behind it -- alive until garbage collection.
          await r.body?.cancel();
          return;
        }
        const data = (await r.json()) as LoadResponse;
        if (!alive) return;
        const load = Math.max(0, Math.min(1, Number(data.load) || 0));
        targetLoadRef.current = load;
        // Host modules read this same sample rather than opening a second poll.
        // The hook drops it unless a host module is selected.
        ingestNovaLoadRef.current({
          cpu: Number(data.cpu) || 0,
          gpu: Number(data.gpu) || 0,
          net: Number(data.net) || 0,
          load,
          listening: Boolean(data.listening),
          ts: Date.now(),
        });
      } catch {
        // ignore — keep previous target
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [hidden, orbOptedOut]);

  // Animation loop. All drawing is delegated to the module renderer: this
  // effect only owns the canvas surface, the load easing, and frame timing.
  // While the voice agent speaks the backing store is boosted so the
  // CSS-scaled centred orb stays crisp (the restart keeps arc state — the
  // renderer instance lives in a ref).
  const resolutionBoost = speechActive ? SPEECH_RESOLUTION_BOOST : 1;
  useEffect(() => {
    if (hidden || orbOptedOut) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1) * resolutionBoost;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    let raf = 0;
    let lastTs = performance.now();

    const draw = (now: number) => {
      if (arePageUpdatesPaused() && !speechActive) {
        lastTs = now;
        raf = requestAnimationFrame(draw);
        return;
      }
      const dt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;

      // ease load toward target — a live voice conversation pins it to 100,
      // otherwise it tracks the server-reported load.
      const tgt = voicePinRef.current ? 1 : targetLoadRef.current;
      currentLoadRef.current += (tgt - currentLoadRef.current) * Math.min(1, dt * LOAD_EASE);

      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, size, size);

      // Render the active module. The palette and module settings are rebuilt
      // from the live theme every frame so config edits appear on the very
      // next frame.
      const renderer = rendererRef.current;
      if (renderer) {
        // Voice speech drives the alert machinery directly: the consonant
        // envelope replaces the gym-alert oscillation for as long as a
        // speech session is live (sampleVoiceSpeechEnvelope returns null
        // otherwise, restoring normal gym-alert behaviour).
        let alertActive = gymAlertActiveRef.current;
        let alertPulseOverride: number | undefined;
        if (speechEnabledRef.current) {
          const envelope = sampleVoiceSpeechEnvelope(now, renderer.module.alertPulsePeriod);
          if (envelope !== null) {
            alertActive = true;
            alertPulseOverride = envelope;
          }
        }
        renderer.render(ctx, {
          centerX: size / 2,
          centerY: size / 2,
          radiusPx: size * ORB_RADIUS_FRACTION,
          palette: buildOrbPalette(themeRef.current),
          load: currentLoadRef.current,
          alertActive,
          alertPulseOverride,
          nowMs: now,
          dtSec: dt,
          settings: resolveOrbModuleSettings(
            renderer.module,
            themeRef.current.orbModuleSettings[renderer.module.id],
          ),
        });
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, hidden, orbOptedOut, resolutionBoost]);

  useEffect(() => {
    if (hidden || forceVisible) return;
    const host = hostRef.current;
    if (!host) return;
    const root = document.documentElement;
    const distance = Math.max(1, scrollScaleDistance);
    const minScale = Math.max(0, Math.min(1, scrollScaleMin));
    const onScroll = () => {
      const y = typeof window !== "undefined" ? window.scrollY || 0 : 0;
      const t = Math.min(1, Math.max(0, y / distance));
      const scale = 1 + (minScale - 1) * t;
      host.style.setProperty("--nova-avatar-scale", scale.toFixed(4));
      // Same scroll-derived progress drives the header fade strip, the mini
      // clock/date, and the reload/config buttons (globals.css) — one
      // continuous function of scrollY, not a triggered animation, so
      // stopping mid-scroll or scrolling back up reverses it exactly.
      root.style.setProperty("--nova-header-fade", t.toFixed(4));
      root.classList.toggle("nova-header-controls-disabled", t >= 0.5);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      root.style.removeProperty("--nova-header-fade");
      root.classList.remove("nova-header-controls-disabled");
    };
  }, [hidden, forceVisible, scrollScaleDistance, scrollScaleMin]);

  // Voice speech migration: on "speaking" the fixed host animates from its
  // resting spot to the viewport centre and enlarges; on "ending"/"idle" it
  // animates back. The travel is expressed as CSS variables consumed by the
  // .nova-avatar-speaking transform (globals.css) so lite mode's
  // instant-transition blanket rule applies automatically. speechOnly hosts
  // are already centred by their own class and only fade.
  useEffect(() => {
    if (hidden || forceVisible || speechOnly) return;
    const host = hostRef.current;
    if (!host) return;
    if (speechPhase === "speaking") {
      // Anchor = the transform origin (top centre), which scroll scaling
      // cannot move — so the measurement is stable mid-animation.
      const rect = host.getBoundingClientRect();
      const anchorX = rect.left + rect.width / 2;
      const anchorY = rect.top;
      const scale = speechScaleFor(window.innerWidth, window.innerHeight, size);
      host.style.setProperty("--nova-avatar-speech-x", `${window.innerWidth / 2 - anchorX}px`);
      host.style.setProperty("--nova-avatar-speech-y", `${window.innerHeight / 2 - (scale * size) / 2 - anchorY}px`);
      host.style.setProperty("--nova-avatar-speech-scale", scale.toFixed(4));
      host.classList.remove("nova-avatar-returning");
      host.classList.add("nova-avatar-speaking");
      return;
    }
    if (!host.classList.contains("nova-avatar-speaking")) return;
    // Return journey: the transient .nova-avatar-returning class carries the
    // transition (the base rule must stay transition-free so scroll scaling
    // never lags), removed once the orb lands.
    host.classList.add("nova-avatar-returning");
    host.classList.remove("nova-avatar-speaking");
    const land = () => host.classList.remove("nova-avatar-returning");
    const timer = window.setTimeout(land, SPEECH_RETURN_FALLBACK_MS);
    host.addEventListener("transitionend", land, { once: true });
    return () => {
      window.clearTimeout(timer);
      host.removeEventListener("transitionend", land);
    };
  }, [speechPhase, hidden, forceVisible, speechOnly, size]);

  // Reset the voice idle timer at the END of agent speech: while Nova speaks the
  // turn is held open, and when speech finishes the follow-up window restarts.
  const prevSpeechPhaseRef = useRef(speechPhase);
  const voiceActive = voice.active;
  useEffect(() => {
    const prev = prevSpeechPhaseRef.current;
    prevSpeechPhaseRef.current = speechPhase;
    if (voiceInteractive && voiceActive && prev !== "idle" && speechPhase === "idle") {
      markVoiceInput();
    }
  }, [speechPhase, voiceInteractive, voiceActive]);

  // speechOnly fade-in: the host mounts already at the viewport centre, so
  // the visible class is added one frame later for the opacity transition to
  // actually run.
  const [speechOnlyVisible, setSpeechOnlyVisible] = useState(false);
  useEffect(() => {
    if (!speechOnly) return;
    const host = hostRef.current;
    if (host) {
      host.style.setProperty(
        "--nova-avatar-speech-scale",
        speechScaleFor(window.innerWidth, window.innerHeight, size).toFixed(4),
      );
    }
    if (speechPhase === "speaking") {
      const raf = requestAnimationFrame(() => setSpeechOnlyVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setSpeechOnlyVisible(false);
  }, [speechOnly, speechPhase, size]);

  if (hidden) return null;

  gymAlertActiveRef.current = forceGymAlert || orbInfo.alert;
  const gymRgb = appliedThemeRgb(theme.gymNumberColor);
  const gymOpacity = percentRatio(theme.gymNumberOpacity);
  const gymCounterStyle = {
    color: gymColorReady ? `rgba(${gymRgb[0]}, ${gymRgb[1]}, ${gymRgb[2]}, ${gymOpacity})` : "transparent",
  };
  // Tapping the orb starts/stops a push-to-talk turn on non-always-on native
  // devices. Custom-input and always-on devices are inert (see useVoiceMode).
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
    orbTappable ? "nova-avatar-tappable" : "",
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
  // The refraction is a backdrop-filter on the glass disc; a `filter` on any
  // ancestor would silently disable it, so the cast shadow lives on the disc
  // as a box-shadow (see NovaOrbGlass.glassBoxShadow) and the host carries no
  // filter. The disc sits BEHIND the canvas and in front of the voice glow.
  const glassBackdropValue = svgBackdrop
    ? `url(#${glassFilterId})`
    : glassCssBackdropFilter(glass);
  const glassDiscStyle = glassEnabled
    ? ({
        backdropFilter: glassBackdropValue,
        WebkitBackdropFilter: glassBackdropValue,
        boxShadow: glassBoxShadow(glass),
      } as CSSProperties)
    : undefined;
  const glassCanvasMaskValue = glassEnabled ? glassCanvasMask(glass) : undefined;
  const canvasStyle = {
    width: size,
    height: size,
    ...(glassEnabled
      ? {
          opacity: glassCanvasOpacity(glass),
          ...(glassCanvasMaskValue
            ? { maskImage: glassCanvasMaskValue, WebkitMaskImage: glassCanvasMaskValue }
            : {}),
        }
      : {}),
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
      data-nova-avatar-theme-source={themeOverride === undefined ? themeSource : "override"}
      data-nova-avatar-variant={themeOverride === undefined ? activeVariant : "override"}
      data-nova-avatar-voice={voiceGlowActive ? "active" : undefined}
      data-nova-force-orb-info={forceVisible ? "true" : undefined}
      role="group"
      style={hostStyle}
      onClick={orbTappable ? voice.toggleTap : undefined}
    >
      <div
        className={`nova-avatar-voice-glow${voiceGlowActive ? " is-visible" : ""}`}
        aria-hidden="true"
      />
      {/* Liquid glass sits BEHIND the orb canvas and in front of the voice
          glow: a clear disc whose backdrop-filter refracts the page behind the
          whole orb, with the silver-room reflection + gloss fading in from the
          rim. The canvas (below) is dialled clear toward its centre so the
          refraction reads through the middle; the gym counter stays on top and
          sharp. */}
      {glassEnabled ? (
        <div className="nova-orb-glass" style={glassDiscStyle} aria-hidden="true">
          {/* WebKit/iOS can't refract the live backdrop (url() backdrop-filter
              is a no-op there), so it gets a self-contained copy of the page
              backdrop run through the SAME lens filter as a regular filter:.
              The disc still carries the CSS-function frost above; the copy adds
              the actual displacement refraction on top of it. */}
          {!svgBackdrop ? (
            <NovaOrbGlassBackdropCopy filterId={glassFilterId} glass={glass} />
          ) : null}
          <NovaOrbGlassLayers glass={glass} hostRef={hostRef} active={glassDriftActive} />
        </div>
      ) : null}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="nova-avatar-canvas"
        style={canvasStyle}
      />
      {/* The SVG lens filter is used by BOTH paths: Chromium references it from
          `backdrop-filter: url()` on the disc; WebKit/iOS references it as a
          regular `filter:` on the backdrop copy above. So mount it whenever the
          glass is on. */}
      {glassEnabled ? <NovaOrbGlassFilter filterId={glassFilterId} glass={glass} size={size} /> : null}
      {(forceVisible || statusOrbInfoVisible) && !orbInfo.empty ? (
        <div
          className={`nova-avatar-gym-counter${speechActive ? " nova-avatar-gym-counter-speech-hidden" : ""}`}
          style={gymCounterStyle}
          aria-label={orbInfo.ariaLabel}
          data-nova-orb-info-module={orbInfo.module.id}
          suppressHydrationWarning
        >
          {orbInfo.text}
        </div>
      ) : null}
    </div>
    </>
  );
}
