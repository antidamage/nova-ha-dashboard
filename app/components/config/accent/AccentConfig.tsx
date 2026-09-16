"use client";

import { ArrowLeftRight, Bell, CircleDot, Clipboard, Copy, Image as ImageIcon, Map as MapIcon, Palette, SlidersHorizontal, Type, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  MAP_BUILDING_OPACITY_MAX,
  MAP_BUILDING_OPACITY_MIN,
  MAP_LABEL_SIZE_MAX,
  MAP_LABEL_SIZE_MIN,
  RADAR_OPACITY_DEFAULT,
  RADAR_OPACITY_MAX,
  RADAR_OPACITY_MIN,
  VOICE_TRANSCRIPT_GLOW_INTENSITY_MAX,
  VOICE_TRANSCRIPT_GLOW_INTENSITY_MIN,
  VOICE_TRANSCRIPT_GLOW_SIZE_MAX,
  VOICE_TRANSCRIPT_GLOW_SIZE_MIN,
  VOICE_TRANSCRIPT_SCANLINE_OPACITY_MAX,
  VOICE_TRANSCRIPT_SCANLINE_OPACITY_MIN,
  VOICE_TRANSCRIPT_SCANLINE_SCALE_MAX,
  VOICE_TRANSCRIPT_SCANLINE_SCALE_MIN,
  appliedThemeRgb,
  normalizeRadarOpacity,
  setDocumentThemeOverride,
  useDeviceTheme,
} from "../../accentColor";
import type {
  DeviceTheme,
  SunThemeStatus,
  ThemeColorValue,
  ThemeMapLayerValue,
  ThemeStorageValue,
  ThemeVariant,
} from "../../theme/accent/types";
import { type NovaAvatarTheme } from "../../avatarThemeModel";
import {
  ColorEncoderPanel,
  ColorWidget,
  type ColorEncoderRingSpec,
  ConfigAccordion,
} from "../../ConfigControls";
import { useConfigPreviewBackground } from "../../ConfigPreviewBackground";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { TASK_REMINDER_AUDIO_PATH } from "../../tasks/task-audio-client";
import { useAutoFullscreen } from "../../dashboard/useAutoFullscreen";
import { useAutoFullscreenSetting } from "../../dashboard/autoFullscreenSetting";
import { useExperienceFeatures } from "../../dashboard/experienceModeSetting";
import { useStatusOrbInfoSetting } from "../../dashboard/statusOrbInfoSetting";
import { NovaAvatarConfig } from "../../NovaAvatarConfig";
import { useBuildReload } from "../../useBuildReload";
import { ThemeLibraryControl } from "../../ThemeLibraryControl";
import { DesignSelectControl } from "../../DesignSelectControl";
import { useThemeLibrary } from "../../themeLibrary";
import { copyColorToClipboard, copySectionToClipboard, useThemeClipboard } from "../../themeClipboard";
import { extractSection, mergeSection, type ThemeSectionKind } from "../../themeSections";
import { useAgentName } from "../../AgentNameContext";
import { SwitchRow } from "../../SlideSwitch";
import {
  THEME_VARIANT_LABELS,
  TASK_GLOW_PREVIEW_MS,
  clamp,
  isMapConfigSlot,
  isTitleConfigSlot,
  isVoiceTranscriptConfigSlot,
  mapSlotKey,
  removeLegacyConfigWidgetParam,
  themeColorForSlot,
  themeSetSignature,
  titleSlotKey,
  voiceTranscriptSlotKey,
  type ThemeConfigColorSlot,
  type ThemeConfigSlot,
  type ThemeSlotChoice,
} from "./accent-config-model";
import { BackgroundSection } from "./BackgroundSection";
import { FontsSection } from "./FontsSection";
import { KnobSkinControl } from "./KnobSkinControl";
import { MapSection } from "./MapSection";
import { RemindersSection } from "./RemindersSection";
import { SoundSection } from "./SoundSection";
import { ThemeColoursSection } from "./ThemeColoursSection";
import { ThemeSelectionControl } from "./ThemeSelectionControl";
import { ThemeVariantTabs } from "./ThemeVariantTabs";
import { ThisDeviceSection } from "./ThisDeviceSection";
import { WaterToggle } from "./WaterToggle";

// FontSelect + the reusable FontControl now live in ./FontControl so the gym readout
// and other panels can share them (and the font list's alphabetical-with-current-first
// sorting lives in one place).

export function AccentConfig({
  initialSun,
  initialTheme,
}: {
  initialSun?: SunThemeStatus | null;
  initialTheme?: ThemeStorageValue | null;
}) {
  const { agentName } = useAgentName();
  useBuildReload();

  // Defer revealing the theme panels until after hydration. Their visibility is
  // gated on themeReady, which is derived from client-only storage and so can
  // differ from the server render. Gating on a post-mount flag keeps the first
  // client render identical to the server (both hidden), avoiding a hydration
  // mismatch that React refuses to patch — which previously left the panels
  // stuck hidden whenever themeReady started true and never changed.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const {
    activeVariant,
    globalVariant,
    setThemeScope,
    setThemeSelection,
    setThemeSet,
    setThemeVariant,
    themeReady,
    themeScope,
    themeSet,
  } = useDeviceTheme(initialTheme, initialSun);
  const [followVisualizerWhenActive, setFollowVisualizerWhenActive] = useState(false);
  const [followVisualizerError, setFollowVisualizerError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/theme", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Shared config request failed: ${response.status}`);
        const payload = await response.json() as { followVisualizerWhenActive?: boolean };
        if (!cancelled) setFollowVisualizerWhenActive(payload.followVisualizerWhenActive === true);
      })
      .catch((error) => {
        if (!cancelled) {
          setFollowVisualizerError(error instanceof Error ? error.message : "Failed to load shared config");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateFollowVisualizerWhenActive = useCallback(async (checked: boolean) => {
    const previous = followVisualizerWhenActive;
    setFollowVisualizerWhenActive(checked);
    setFollowVisualizerError(null);
    try {
      const response = await fetch("/api/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followVisualizerWhenActive: checked }),
      });
      if (!response.ok) throw new Error(`Shared config update failed: ${response.status}`);
      const payload = await response.json() as { followVisualizerWhenActive?: boolean };
      setFollowVisualizerWhenActive(payload.followVisualizerWhenActive === true);
    } catch (error) {
      setFollowVisualizerWhenActive(previous);
      setFollowVisualizerError(error instanceof Error ? error.message : "Failed to save shared config");
    }
  }, [followVisualizerWhenActive]);

  // The shared/local scope switch has been retired: the editor always targets
  // the shared host theme so loaded themes and edits reach every dashboard.
  useEffect(() => {
    if (themeScope !== "shared") {
      setThemeScope("shared");
    }
  }, [themeScope, setThemeScope]);

  const library = useThemeLibrary();
  const clipboard = useThemeClipboard();
  // Open on the global selection's variant; a per-device override is not
  // what this editor edits (specs/theme-override.md).
  const [editingVariant, setEditingVariant] = useState<ThemeVariant>(globalVariant);
  const theme = themeSet.themes[editingVariant];
  const previewBackground = useConfigPreviewBackground();
  const setPreviewTheme = previewBackground?.setPreviewTheme;

  // Render the whole config page in the variant currently being edited: both the
  // live fluid background and the page chrome (CSS colour variables) follow the
  // editing tab, so editing the light theme shows the editor in light even when
  // the active selection resolves to dark. setDocumentThemeOverride pins :root to
  // this variant so the shared-theme poll and sun-change events in useDeviceTheme
  // apply it (instead of the selection-resolved variant) too — without that pin the
  // page flickered between the edited variant and the dashboard's active one.
  useEffect(() => {
    setPreviewTheme?.(theme);
    setDocumentThemeOverride(theme);
  }, [setPreviewTheme, theme]);
  // On unmount, clear the preview canvas and release the override so the document
  // returns to the active (selection-resolved) theme. Only on unmount so editing
  // never remounts the canvas.
  useEffect(() => {
    return () => {
      setPreviewTheme?.(null);
      setDocumentThemeOverride(null);
    };
  }, [setPreviewTheme]);
  const [autoFullscreen, setAutoFullscreen] = useAutoFullscreenSetting();
  useAutoFullscreen(autoFullscreen);
  const [experienceFeatures, setExperienceFeature] = useExperienceFeatures();
  const [statusOrbInfoVisible, setStatusOrbInfoVisible] = useStatusOrbInfoSetting();
  const [taskReminderAudioExists, setTaskReminderAudioExists] = useState(false);
  const taskAudioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const taskAudioPreviewStopTimer = useRef<number | null>(null);
  const taskGlowPreviewTimer = useRef<number | null>(null);
  const accentRgb = appliedThemeRgb(theme.accent);
  const highlightRgb = appliedThemeRgb(theme.highlight);
  const borderRgb = appliedThemeRgb(theme.border.color);
  const waterRgb = appliedThemeRgb(theme.map.water);
  const radarLowRgb = appliedThemeRgb(theme.map.radarLow);
  const radarHighRgb = appliedThemeRgb(theme.map.radarHigh);

  const setTheme = useCallback((nextTheme: DeviceTheme, options: { persist?: boolean } = {}) => {
    setThemeVariant(editingVariant, nextTheme, options);
  }, [editingVariant, setThemeVariant]);

  const setThemeColor = useCallback((slot: ThemeConfigColorSlot, value: ThemeColorValue, options: { persist?: boolean } = {}) => {
    setTheme({ ...theme, [slot]: value }, options);
  }, [setTheme, theme]);

  const updateSlotColor = (slot: ThemeConfigSlot, value: ThemeColorValue, options: { persist?: boolean } = {}) => {
    if (slot === "headerFade") {
      setTheme({ ...theme, headerFade: { ...theme.headerFade, color: value } }, options);
      return;
    }
    if (slot === "panel") {
      setTheme({ ...theme, panel: { ...theme.panel, color: value } }, options);
      return;
    }
    if (slot === "border") {
      setTheme({ ...theme, border: { ...theme.border, color: value } }, options);
      return;
    }
    if (slot === "clockColor") {
      setTheme({ ...theme, clockColor: value }, options);
      return;
    }
    if (slot === "ledColor") {
      setTheme({ ...theme, ledColor: value }, options);
      return;
    }
    if (isTitleConfigSlot(slot)) {
      setTheme({ ...theme, titleColors: { ...theme.titleColors, [titleSlotKey(slot)]: value } }, options);
      return;
    }
    if (isVoiceTranscriptConfigSlot(slot)) {
      setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, [voiceTranscriptSlotKey(slot)]: value } }, options);
      return;
    }
    if (isMapConfigSlot(slot)) {
      setTheme({ ...theme, map: { ...theme.map, [mapSlotKey(slot)]: value } }, options);
      return;
    }
    setThemeColor(slot, value, options);
  };

  // Opacity folds into the colour dial only where it belongs to exactly one
  // colour slot (specs/color-encoder.md, "Opacity"). Buildings and radar share
  // one opacity across two colours, so they keep their own slider.
  const slotOpacity = (slot: ThemeConfigSlot) => {
    if (slot === "border") return theme.border.opacity;
    if (slot === "headerFade") return theme.headerFade.opacity;
    if (slot === "panel") return theme.panel.opacity;
    if (slot === "map.water") return theme.mapWater.opacity;
    return undefined;
  };

  const updateSlotColorAndOpacity = (
    slot: ThemeConfigSlot,
    value: ThemeColorValue,
    opacity: number,
    options: { persist?: boolean } = {},
  ) => {
    if (slot === "border") {
      setTheme({ ...theme, border: { ...theme.border, color: value, opacity } }, options);
      return;
    }
    if (slot === "headerFade") {
      setTheme({ ...theme, headerFade: { ...theme.headerFade, color: value, opacity } }, options);
      return;
    }
    if (slot === "panel") {
      setTheme({ ...theme, panel: { ...theme.panel, color: value, opacity } }, options);
      return;
    }
    if (slot === "map.water") {
      setTheme({ ...theme, map: { ...theme.map, [mapSlotKey(slot)]: value }, mapWater: { ...theme.mapWater, opacity } }, options);
      return;
    }
    updateSlotColor(slot, value, options);
  };

  const swapAccentHighlight = () => {
    setTheme({ ...theme, accent: theme.highlight, highlight: theme.accent });
  };

  // ---- Theme library (save / load / rename / duplicate / delete) ----------
  const activeEntry = useMemo(
    () => library.library.entries.find((entry) => entry.id === library.library.activeId) ?? null,
    [library.library],
  );
  const dirty = useMemo(
    () => (activeEntry ? themeSetSignature(themeSet) !== themeSetSignature(activeEntry.themeSet) : false),
    [activeEntry, themeSet],
  );

  const loadThemeFromLibrary = (id: string) => {
    const entry = library.library.entries.find((item) => item.id === id);
    if (!entry) {
      return;
    }
    setThemeSet(entry.themeSet);
    library.setActive(id);
  };

  // ---- Section copy / paste (type-guarded: map only pastes into map) -------
  const copySection = (kind: ThemeSectionKind) =>
    copySectionToClipboard({ kind, payload: extractSection(theme, kind) });
  const pasteSection = (kind: ThemeSectionKind) => {
    if (clipboard.section?.kind === kind) {
      setTheme(mergeSection(theme, kind, clipboard.section.payload));
    }
  };
  const sectionActions = (kind: ThemeSectionKind, label: string, extra?: ReactNode) => (
    <>
      {extra}
      <MomentaryFeedbackButton
        type="button"
        aria-label={`Copy ${label} section`}
        className="icon-link"
        data-demo-tooltip-title="Copy Section"
        data-demo-tooltip={`Copy every ${label} value to paste into another theme's ${label}.`}
        onClick={() => copySection(kind)}
      >
        <Copy className="h-5 w-5" />
      </MomentaryFeedbackButton>
      <MomentaryFeedbackButton
        type="button"
        aria-label={`Paste ${label} section`}
        className="icon-link"
        disabled={clipboard.section?.kind !== kind}
        data-demo-tooltip-title="Paste Section"
        data-demo-tooltip={`Paste a copied ${label} into this theme.`}
        onClick={() => pasteSection(kind)}
      >
        <Clipboard className="h-5 w-5" />
      </MomentaryFeedbackButton>
    </>
  );

  // ---- Per-widget colour copy / paste (any colour into any widget) --------
  const copyColorForSlot = (slot: ThemeConfigSlot) => {
    const value = themeColorForSlot(theme, slot);
    const opacity = slot === "border"
      ? theme.border.opacity
      : slot === "headerFade"
        ? theme.headerFade.opacity
      : slot === "panel"
        ? theme.panel.opacity
      : slot === "map.water"
        ? theme.mapWater.opacity
        : undefined;
    copyColorToClipboard({ value, opacity });
  };
  const pasteColorIntoSlot = (slot: ThemeConfigSlot) => {
    const clip = clipboard.color;
    if (!clip) {
      return;
    }
    if (slot === "headerFade") {
      setTheme({
        ...theme,
        headerFade: {
          ...theme.headerFade,
          color: clip.value,
          ...(clip.opacity !== undefined ? { opacity: clamp(Math.round(clip.opacity), 0, 100) } : {}),
        },
      });
      return;
    }
    if (slot === "panel") {
      setTheme({
        ...theme,
        panel: {
          ...theme.panel,
          color: clip.value,
          ...(clip.opacity !== undefined ? { opacity: clamp(Math.round(clip.opacity), 0, 100) } : {}),
        },
      });
      return;
    }
    if (slot === "border") {
      setTheme({
        ...theme,
        border: {
          ...theme.border,
          color: clip.value,
          ...(clip.opacity !== undefined ? { opacity: clamp(Math.round(clip.opacity), 0, 100) } : {}),
        },
      });
      return;
    }
    if (slot === "map.water") {
      setTheme({
        ...theme,
        map: { ...theme.map, water: clip.value },
        ...(clip.opacity !== undefined
          ? { mapWater: { ...theme.mapWater, opacity: clamp(Math.round(clip.opacity), 0, 100) } }
          : {}),
      });
      return;
    }
    updateSlotColor(slot, clip.value);
  };

  const updateMapWater = (mapWater: ThemeMapLayerValue, options: { persist?: boolean } = {}) => {
    setTheme({ ...theme, mapWater }, options);
  };

  const updateStatusOrb = useCallback((avatar: NovaAvatarTheme, options: { persist?: boolean } = {}) => {
    setTheme({ ...theme, avatar }, options);
  }, [setTheme, theme]);

  const stopTaskAudioPreview = useCallback(() => {
    if (taskAudioPreviewStopTimer.current !== null) {
      window.clearTimeout(taskAudioPreviewStopTimer.current);
      taskAudioPreviewStopTimer.current = null;
    }

    const audio = taskAudioPreviewRef.current;
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // Some browsers will not allow seeking until the MP3 has loaded metadata.
      }
    }
  }, []);

  const previewTaskAudio = useCallback(() => {
    if (!taskReminderAudioExists) {
      return;
    }

    stopTaskAudioPreview();

    let audio = taskAudioPreviewRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = "auto";
      taskAudioPreviewRef.current = audio;
    }

    audio.src = `${TASK_REMINDER_AUDIO_PATH}?preview=${Date.now()}`;
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch((error) => {
        console.info("[nova-dashboard] task preview audio blocked or unavailable", error);
      });
    }

    taskAudioPreviewStopTimer.current = window.setTimeout(stopTaskAudioPreview, TASK_GLOW_PREVIEW_MS);
  }, [stopTaskAudioPreview, taskReminderAudioExists]);

  const previewTaskGlow = useCallback(() => {
    if (taskGlowPreviewTimer.current !== null) {
      window.clearTimeout(taskGlowPreviewTimer.current);
    }

    previewTaskAudio();
    document.body.classList.remove("task-glow-preview");
    void document.body.offsetWidth;
    document.body.classList.add("task-glow-preview");
    taskGlowPreviewTimer.current = window.setTimeout(() => {
      document.body.classList.remove("task-glow-preview");
      taskGlowPreviewTimer.current = null;
    }, TASK_GLOW_PREVIEW_MS);
  }, [previewTaskAudio]);

  // The colour dials are always on screen now, so there is no open widget to
  // restore — only the legacy ?widget= parameter to sweep out of old links.
  useEffect(() => {
    removeLegacyConfigWidgetParam();
  }, []);

  useEffect(() => {
    return () => {
      if (taskGlowPreviewTimer.current !== null) {
        window.clearTimeout(taskGlowPreviewTimer.current);
      }
      stopTaskAudioPreview();
      document.body.classList.remove("task-glow-preview");
    };
  }, [stopTaskAudioPreview]);

  /**
   * A map slot's extra slider, as a ring round its dial
   * (specs/color-encoder.md, "The map colour slots carry their sliders as
   * rings"). Buildings and radar share one value between their Low and High
   * slots: both dials carry the ring and either one moves it.
   */
  const ringsForSlot = (slot: ThemeSlotChoice["slot"]): ColorEncoderRingSpec[] | undefined => {
    if (slot === "map.labels") {
      return [{
        id: "map-label-size",
        label: "Label Size",
        value: clamp(Math.round(Number(theme.mapLabelSize)), MAP_LABEL_SIZE_MIN, MAP_LABEL_SIZE_MAX),
        min: MAP_LABEL_SIZE_MIN,
        max: MAP_LABEL_SIZE_MAX,
        step: 50,
        onChange: (mapLabelSize) => setTheme({ ...theme, mapLabelSize }, { persist: false }),
        onCommit: (mapLabelSize) => setTheme({ ...theme, mapLabelSize }),
      }];
    }
    if (slot === "map.buildingLow" || slot === "map.buildingHigh") {
      return [{
        id: "map-building-opacity",
        label: "Opacity",
        value: clamp(Math.round(Number(theme.mapBuildingOpacity)), MAP_BUILDING_OPACITY_MIN, MAP_BUILDING_OPACITY_MAX),
        min: MAP_BUILDING_OPACITY_MIN,
        max: MAP_BUILDING_OPACITY_MAX,
        step: 1,
        onChange: (mapBuildingOpacity) => setTheme({ ...theme, mapBuildingOpacity }, { persist: false }),
        onCommit: (mapBuildingOpacity) => setTheme({ ...theme, mapBuildingOpacity }),
      }];
    }
    if (slot === "voiceTranscript.text") {
      const set = (glowIntensity: number, options?: { persist: boolean }) =>
        setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, glowIntensity } }, options);
      const setSize = (glowSize: number, options?: { persist: boolean }) =>
        setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, glowSize } }, options);
      return [
        {
          id: "transcript-glow-intensity",
          label: "Glow Intensity",
          value: theme.voiceTranscriptColors.glowIntensity,
          min: VOICE_TRANSCRIPT_GLOW_INTENSITY_MIN,
          max: VOICE_TRANSCRIPT_GLOW_INTENSITY_MAX,
          step: 1,
          valueText: (value) => `${Math.round(value)}%`,
          valueTextWidest: `${VOICE_TRANSCRIPT_GLOW_INTENSITY_MAX}%`,
          onChange: (value) => set(value, { persist: false }),
          onCommit: (value) => set(value),
        },
        {
          id: "transcript-glow-size",
          label: "Glow Size",
          value: theme.voiceTranscriptColors.glowSize,
          min: VOICE_TRANSCRIPT_GLOW_SIZE_MIN,
          max: VOICE_TRANSCRIPT_GLOW_SIZE_MAX,
          step: 1,
          valueText: (value) => `${Math.round(value)}px`,
          valueTextWidest: `${VOICE_TRANSCRIPT_GLOW_SIZE_MAX}px`,
          onChange: (value) => setSize(value, { persist: false }),
          onCommit: (value) => setSize(value),
        },
      ];
    }
    if (slot === "voiceTranscript.background") {
      const setOpacity = (scanlineOpacity: number, options?: { persist: boolean }) =>
        setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, scanlineOpacity } }, options);
      const setScale = (scanlineScale: number, options?: { persist: boolean }) =>
        setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, scanlineScale } }, options);
      return [
        {
          id: "transcript-scanline-opacity",
          label: "Scanline Opacity",
          value: theme.voiceTranscriptColors.scanlineOpacity,
          min: VOICE_TRANSCRIPT_SCANLINE_OPACITY_MIN,
          max: VOICE_TRANSCRIPT_SCANLINE_OPACITY_MAX,
          step: 1,
          valueText: (value) => `${Math.round(value)}%`,
          valueTextWidest: `${VOICE_TRANSCRIPT_SCANLINE_OPACITY_MAX}%`,
          onChange: (value) => setOpacity(value, { persist: false }),
          onCommit: (value) => setOpacity(value),
        },
        {
          id: "transcript-scanline-scale",
          label: "Scanline Scale",
          value: theme.voiceTranscriptColors.scanlineScale,
          min: VOICE_TRANSCRIPT_SCANLINE_SCALE_MIN,
          max: VOICE_TRANSCRIPT_SCANLINE_SCALE_MAX,
          step: 5,
          valueText: (value) => `${Math.round(value)}%`,
          valueTextWidest: `${VOICE_TRANSCRIPT_SCANLINE_SCALE_MAX}%`,
          onChange: (value) => setScale(value, { persist: false }),
          onCommit: (value) => setScale(value),
        },
      ];
    }
    if (slot === "map.radarLow" || slot === "map.radarHigh") {
      return [{
        id: "map-radar-opacity",
        label: "Opacity",
        value: normalizeRadarOpacity(theme.radarOpacity ?? RADAR_OPACITY_DEFAULT),
        min: RADAR_OPACITY_MIN,
        max: RADAR_OPACITY_MAX,
        step: 1,
        onChange: (radarOpacity) => setTheme({ ...theme, radarOpacity: normalizeRadarOpacity(radarOpacity) }, { persist: false }),
        onCommit: (radarOpacity) => setTheme({ ...theme, radarOpacity: normalizeRadarOpacity(radarOpacity) }),
      }];
    }
    return undefined;
  };

  const renderWidget = (choice: ThemeSlotChoice) => {
    const value = themeColorForSlot(theme, choice.slot);
    const isWater = choice.slot === "map.water";
    return (
      <ColorWidget
        key={choice.slot}
        label={choice.label}
        onCopyColor={() => copyColorForSlot(choice.slot)}
        onPasteColor={() => pasteColorIntoSlot(choice.slot)}
        pasteColorDisabled={!clipboard.color}
      >
        {isWater ? (
          <WaterToggle
            checked={theme.mapWater.enabled}
            onChange={(enabled) => updateMapWater({ ...theme.mapWater, enabled })}
          />
        ) : null}
        <ColorEncoderPanel
          knobSkin={theme.knobSkin}
          label={choice.label}
          value={value}
          opacity={slotOpacity(choice.slot)}
          rings={ringsForSlot(choice.slot)}
          onPreview={(nextValue, opacity) => updateSlotColorAndOpacity(choice.slot, nextValue, opacity, { persist: false })}
          onCommit={(nextValue, opacity) => updateSlotColorAndOpacity(choice.slot, nextValue, opacity)}
        />
      </ColorWidget>
    );
  };

  return (
    <>
      <section
        className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 p-4 shadow-2xl"
        style={{ visibility: mounted && themeReady ? "visible" : "hidden" }}
      >
        <div className="panel-corner panel-corner-left" />
        <div className="panel-corner panel-corner-right" />
        <div className="grid gap-4">
          <ThisDeviceSection
            agentName={agentName}
            autoFullscreen={autoFullscreen}
            setAutoFullscreen={setAutoFullscreen}
            experienceFeatures={experienceFeatures}
            setExperienceFeature={setExperienceFeature}
            statusOrbInfoVisible={statusOrbInfoVisible}
            setStatusOrbInfoVisible={setStatusOrbInfoVisible}
          />
          <div className="grid gap-3">
            <h2 className="theme-display-label zone-title-bar">Theme Library</h2>
            <SwitchRow
              checked={followVisualizerWhenActive}
              label="Follow visualiser when active"
              detail={
                followVisualizerWhenActive
                  ? "Dashboard colours temporarily blend into the active visualiser theme"
                  : "Dashboard colours remain on the selected theme"
              }
              onChange={(checked) => void updateFollowVisualizerWhenActive(checked)}
            />
            {followVisualizerError ? <p className="theme-library-error">{followVisualizerError}</p> : null}
            <ThemeLibraryControl
              activeId={library.library.activeId}
              dirty={dirty}
              entries={library.library.entries}
              onLoad={loadThemeFromLibrary}
              onSaveChanges={() => library.saveChanges(themeSet)}
              onSaveAs={(name) => library.saveAs(name, themeSet)}
              onRename={(id, name) => library.rename(id, name)}
              onDuplicate={(id) => library.duplicate(id)}
              onDelete={(id) => library.remove(id)}
            />
            {library.error ? <p className="theme-library-error">{library.error}</p> : null}
          </div>

          <div className="grid gap-3">
            <h2 className="theme-display-label zone-title-bar">Design</h2>
            <DesignSelectControl />
          </div>
        </div>
      </section>

      <section
        className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 p-4 shadow-2xl"
        style={{ visibility: mounted && themeReady ? "visible" : "hidden" }}
      >
        <div className="panel-corner panel-corner-left" />
        <div className="panel-corner panel-corner-right" />

        <div className="grid gap-4">
          <ThemeSelectionControl
            accentColor={accentRgb}
            highlightColor={highlightRgb}
            value={themeSet.selection}
            onPreview={(selection) => setThemeSelection(selection, { persist: false })}
            onCommit={setThemeSelection}
          />
          <ThemeVariantTabs value={editingVariant} onChange={setEditingVariant} />

          <div role="tabpanel" aria-label={`${THEME_VARIANT_LABELS[editingVariant]} theme settings`}>
            <KnobSkinControl
              accentColor={accentRgb}
              highlightColor={highlightRgb}
              value={theme.knobSkin}
              onPreview={(knobSkin) => setTheme({ ...theme, knobSkin }, { persist: false })}
              onCommit={(knobSkin) => setTheme({ ...theme, knobSkin })}
            />
            <ConfigAccordion id="theme-settings" title="Theme Settings" icon={<SlidersHorizontal className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-sub-accordion">
          <ConfigAccordion
            id="theme-colours"
            title="Theme Colours"
            icon={<Palette className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("themeColours", "theme colours", (
              <MomentaryFeedbackButton
                type="button"
                aria-label="Swap accent and highlight colours"
                className="icon-link"
                onClick={swapAccentHighlight}
              >
                <ArrowLeftRight className="h-5 w-5" />
              </MomentaryFeedbackButton>
            ))}
          >
            <ThemeColoursSection
              accentRgb={accentRgb}
              highlightRgb={highlightRgb}
              renderWidget={renderWidget}
              setTheme={setTheme}
              theme={theme}
            />
          </ConfigAccordion>

          <ConfigAccordion
            id="fonts"
            title="Fonts"
            icon={<Type className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("typography", "fonts")}
          >
            <FontsSection
              accentRgb={accentRgb}
              highlightRgb={highlightRgb}
              setTheme={setTheme}
              theme={theme}
            />
          </ConfigAccordion>

          <ConfigAccordion
            id="status-orb"
            title="Status Orb"
            icon={<CircleDot className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("statusOrb", "status orb")}
          >
            <NovaAvatarConfig
              embedded
              theme={theme.avatar}
              onThemeChange={updateStatusOrb}
              onThemePreview={(avatar) => updateStatusOrb(avatar, { persist: false })}
            />
          </ConfigAccordion>

          <ConfigAccordion
            id="background"
            title="Background"
            icon={<ImageIcon className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("background", "background")}
          >
            <BackgroundSection
              accentRgb={accentRgb}
              highlightRgb={highlightRgb}
              setTheme={setTheme}
              theme={theme}
            />
          </ConfigAccordion>

          <ConfigAccordion
            id="map"
            title="Map"
            icon={<MapIcon className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("map", "map")}
          >
            <MapSection
              radarHighRgb={radarHighRgb}
              radarLowRgb={radarLowRgb}
              renderWidget={renderWidget}
              setTheme={setTheme}
              theme={theme}
            />
          </ConfigAccordion>

          <ConfigAccordion
            id="theme-reminders"
            title="Reminders"
            icon={<Bell className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("reminders", "reminders")}
          >
            <RemindersSection
              highlightRgb={highlightRgb}
              previewTaskGlow={previewTaskGlow}
              setTaskReminderAudioExists={setTaskReminderAudioExists}
              setTheme={setTheme}
              theme={theme}
            />
          </ConfigAccordion>

          <ConfigAccordion
            id="sound"
            title="Sound"
            icon={<Volume2 className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("sound", "sound")}
          >
            <SoundSection
              highlightRgb={highlightRgb}
              setTheme={setTheme}
              theme={theme}
            />
          </ConfigAccordion>
            </ConfigAccordion>
          </div>
        </div>
      </section>
    </>
  );
}
