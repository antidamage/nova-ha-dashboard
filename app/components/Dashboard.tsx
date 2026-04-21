"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Fan,
  Flame,
  Gauge,
  Lightbulb,
  Minus,
  Power,
  PowerOff,
  Plus,
  Settings,
  Snowflake,
  Sun,
  Thermometer,
  ToggleLeft,
  Waves,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AirconPreferences,
  DashboardEntity,
  DashboardPreferences,
  DashboardState,
  DashboardZone,
  HaDomain,
  RouterStatus,
  SpectrumCursor,
  WeatherStatus,
} from "../../lib/types";
import { useDeviceTheme } from "./accentColor";

type LoadState = "idle" | "loading" | "error";

type EntityActionInput = {
  entityId: string;
  domain: HaDomain;
  service: string;
  data?: Record<string, unknown>;
  remember?: DashboardPreferences;
};

const domainIcons: Record<HaDomain, React.ComponentType<{ className?: string }>> = {
  light: Lightbulb,
  switch: ToggleLeft,
  climate: Thermometer,
  fan: Fan,
  cover: Gauge,
  humidifier: Gauge,
};

const domainAccent: Record<HaDomain, string> = {
  light: "text-yellow-300 border-yellow-300/40 bg-yellow-300/10",
  switch: "text-cyan-300 border-cyan-300/40 bg-cyan-300/10",
  climate: "text-fuchsia-300 border-fuchsia-300/40 bg-fuchsia-300/10",
  fan: "text-emerald-300 border-emerald-300/40 bg-emerald-300/10",
  cover: "text-orange-300 border-orange-300/40 bg-orange-300/10",
  humidifier: "text-sky-300 border-sky-300/40 bg-sky-300/10",
};

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

type SpectrumValue = {
  cursor: { x: number; y: number };
  preview: [number, number, number];
};

type SpectrumDot = {
  id: string;
  x: number;
  xPx: number;
  y: number;
  yPx: number;
  padWidth: number;
  padHeight: number;
  rgb: [number, number, number];
};

const CLOCK_TIME_ZONE = "Pacific/Auckland";
const SPECTRUM_DOT_GAP_PX = 15;
const SPECTRUM_DOT_INFLUENCE_RADIUS_PX = 78;
const LIGHT_DRAG_COMMAND_INTERVAL_MS = 160;
const LIGHT_COMMAND_POLL_HOLD_MS = 5000;
const SPECTRUM_LOCAL_HOLD_MS = LIGHT_COMMAND_POLL_HOLD_MS;
const REMOTE_CONTROL_EASE_MS = 1000;
const SPECTRUM_PROGRAMMATIC_CURSOR_MS = REMOTE_CONTROL_EASE_MS;
const SPECTRUM_CURSOR_INSET_PX = 40;
const SVG_SPECTRUM_DOT_RADIUS_PX = 0.5;
const SVG_SPECTRUM_CURSOR_RADIUS_PX = 38;
const SVG_SPECTRUM_CURSOR_STROKE_PX = 3;
const SVG_LINE_HEIGHT_PX = 48;
const SVG_LINE_CENTER_Y_PX = SVG_LINE_HEIGHT_PX / 2;
const SVG_LINE_CURSOR_RADIUS_PX = 16.5;
const SVG_LINE_CURSOR_STROKE_PX = 3;
const LINE_CURSOR_INSET_PX = 18;
const CLIMATE_COMMAND_POLL_DELAYS_MS = [500, 1500, 3500];
const STEP_EPSILON = 0.0001;

const CANDLELIGHT_SPECTRUM: SpectrumValue = {
  cursor: { x: 0.08, y: 0.12 },
  preview: [255, 147, 41],
};

const ACCENT_DOT_RGB: [number, number, number] = [215, 255, 50];
const DISABLED_SPECTRUM_DOT_RGB = "126 126 126";
const HIGHLIGHT_DOT_RGB: [number, number, number] = [40, 243, 255];

const WHITE_SPECTRUM: SpectrumValue = {
  cursor: { x: 0.13, y: 0.96 },
  preview: [255, 255, 255],
};

async function fetchDashboardStateSnapshot() {
  const response = await fetch("/api/state", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to load dashboard state");
  }
  return payload as DashboardState;
}

function numberArray(value: unknown, length: number) {
  if (!Array.isArray(value) || value.length < length) {
    return null;
  }

  const numbers = value.slice(0, length).map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

function rgbToHsl([red, green, blue]: [number, number, number]): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return [0, 0, lightness * 100];
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;

  if (max === r) {
    hue = (g - b) / delta + (g < b ? 6 : 0);
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  return [hue * 60, saturation * 100, lightness * 100];
}

function spectrumFromHs(hue: number, saturation: number): SpectrumValue {
  const boundedHue = ((hue % 360) + 360) % 360;
  const boundedSaturation = clamp(saturation, 0, 100);
  const x = clamp(boundedHue / 359, 0, 1);
  const y = clamp(1 - boundedSaturation / 100, 0, 1);

  return {
    cursor: { x, y },
    preview: spectrumRgbAtPosition(x, y),
  };
}

function spectrumRgbAtPosition(x: number, y: number): [number, number, number] {
  const hue = Math.round(clamp(x, 0, 1) * 359);
  const boundedY = clamp(y, 0, 1);
  const saturation = Math.round((1 - boundedY) * 100);
  const lightness = Math.round(50 + boundedY * 50);

  return hslToRgb(hue, saturation, lightness);
}

function buildSpectrumDots(width: number, height: number): SpectrumDot[] {
  const columns = Math.max(2, Math.round(width / SPECTRUM_DOT_GAP_PX) + 1);
  const rows = Math.max(2, Math.round(height / SPECTRUM_DOT_GAP_PX) + 1);
  const dots: SpectrumDot[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = columns === 1 ? 0.5 : column / (columns - 1);
      const y = rows === 1 ? 0.5 : row / (rows - 1);

      dots.push({
        id: `${column}-${row}`,
        x,
        xPx: x * width,
        y,
        yPx: y * height,
        padWidth: width,
        padHeight: height,
        rgb: spectrumRgbAtPosition(x, y),
      });
    }
  }

  return dots;
}

function spectrumFromRgb(rgb: [number, number, number]): SpectrumValue {
  const normalized = rgb.map((value) => clamp(Math.round(value), 0, 255)) as [number, number, number];
  const [hue, saturation] = rgbToHsl(normalized);
  const value = spectrumFromHs(hue, saturation);

  return {
    ...value,
    preview: normalized,
  };
}

function spectrumFromKelvin(kelvin: number): SpectrumValue {
  const ratio = clamp((kelvin - 1800) / (6500 - 1800), 0, 1);
  const mix = (warm: number, cool: number) => Math.round(warm + (cool - warm) * ratio);

  return {
    cursor: {
      x: CANDLELIGHT_SPECTRUM.cursor.x + (WHITE_SPECTRUM.cursor.x - CANDLELIGHT_SPECTRUM.cursor.x) * ratio,
      y: CANDLELIGHT_SPECTRUM.cursor.y + (WHITE_SPECTRUM.cursor.y - CANDLELIGHT_SPECTRUM.cursor.y) * ratio,
    },
    preview: [
      mix(CANDLELIGHT_SPECTRUM.preview[0], WHITE_SPECTRUM.preview[0]),
      mix(CANDLELIGHT_SPECTRUM.preview[1], WHITE_SPECTRUM.preview[1]),
      mix(CANDLELIGHT_SPECTRUM.preview[2], WHITE_SPECTRUM.preview[2]),
    ],
  };
}

function insetPixel(value: number, length: number, insetPx: number) {
  if (length <= 0) {
    return clamp(value, 0, 1) * length;
  }

  const inset = Math.min(insetPx, length / 2);
  return inset + clamp(value, 0, 1) * Math.max(0, length - inset * 2);
}

function insetPercent(value: number, length: number, insetPx: number) {
  return length > 0 ? (insetPixel(value, length, insetPx) / length) * 100 : clamp(value, 0, 1) * 100;
}

function spectrumDisplayPoint(cursor: SpectrumValue["cursor"], width: number, height: number) {
  const xPx = insetPixel(cursor.x, width, SPECTRUM_CURSOR_INSET_PX);
  const yPx = insetPixel(cursor.y, height, SPECTRUM_CURSOR_INSET_PX);

  return {
    xPx,
    yPx,
    xPct: width > 0 ? (xPx / width) * 100 : clamp(cursor.x, 0, 1) * 100,
    yPct: height > 0 ? (yPx / height) * 100 : clamp(cursor.y, 0, 1) * 100,
  };
}

function focusedSpectrumDotSize(
  dot: SpectrumDot,
  cursor: SpectrumValue["cursor"],
  displayPoint?: { xPx: number; yPx: number },
) {
  const dx = dot.xPx - (displayPoint?.xPx ?? cursor.x * dot.padWidth);
  const dy = dot.yPx - (displayPoint?.yPx ?? cursor.y * dot.padHeight);
  const distance = Math.hypot(dx, dy);
  const weight = clamp(1 - distance / SPECTRUM_DOT_INFLUENCE_RADIUS_PX, 0, 1);
  const eased = weight * weight * (3 - 2 * weight);

  return Math.round((1 + eased * 5) * 100) / 100;
}

function focusedLineDotSize(dotX: number, cursorX: number, width: number, displayX?: number) {
  const distance = Math.abs(dotX - (displayX ?? cursorX * width));
  const weight = clamp(1 - distance / SPECTRUM_DOT_INFLUENCE_RADIUS_PX, 0, 1);
  const eased = weight * weight * (3 - 2 * weight);

  return Math.round((1 + eased * 5) * 100) / 100;
}

function svgSpectrumDotRadius(scale: number) {
  return Math.round(SVG_SPECTRUM_DOT_RADIUS_PX * scale * 100) / 100;
}

function easeCursorTravel(value: number) {
  const smoothProgress = value * value * (3 - 2 * value);
  return 1 - Math.pow(1 - smoothProgress, 2.25);
}

function useRemoteEasedNumber(target: number) {
  const [displayValue, setDisplayValue] = useState(target);
  const displayValueRef = useRef(target);
  const localInteractionRef = useRef(false);
  const animationRef = useRef<number | null>(null);

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const setImmediate = useCallback(
    (next: number) => {
      cancelAnimation();
      displayValueRef.current = next;
      setDisplayValue(next);
    },
    [cancelAnimation],
  );

  const setLocalValue = useCallback(
    (next: number) => {
      localInteractionRef.current = true;
      setImmediate(next);
    },
    [setImmediate],
  );

  const releaseLocalValue = useCallback(
    (next: number) => {
      setImmediate(next);
      localInteractionRef.current = false;
    },
    [setImmediate],
  );

  useEffect(() => {
    if (localInteractionRef.current) {
      displayValueRef.current = target;
      setDisplayValue(target);
      return;
    }

    cancelAnimation();
    const start = displayValueRef.current;
    const distance = Math.abs(target - start);
    if (distance < 0.01) {
      displayValueRef.current = target;
      setDisplayValue(target);
      return;
    }

    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = clamp((now - startedAt) / REMOTE_CONTROL_EASE_MS, 0, 1);
      const eased = easeCursorTravel(progress);
      const next = start + (target - start) * eased;

      displayValueRef.current = next;
      setDisplayValue(next);

      if (progress < 1) {
        animationRef.current = window.requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
        displayValueRef.current = target;
        setDisplayValue(target);
      }
    };

    animationRef.current = window.requestAnimationFrame(animate);
  }, [cancelAnimation, target]);

  useEffect(() => cancelAnimation, [cancelAnimation]);

  return { displayValue, releaseLocalValue, setLocalValue };
}

function useThrottledCommand<T>(send: (value: T) => void, intervalMs: number) {
  const lastSentAt = useRef(0);
  const pending = useRef<{ value: T } | null>(null);
  const sendRef = useRef(send);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    clearTimer();
    const next = pending.current;
    if (!next) {
      return;
    }

    pending.current = null;
    lastSentAt.current = Date.now();
    sendRef.current(next.value);
  }, [clearTimer]);

  const queue = useCallback(
    (value: T) => {
      pending.current = { value };
      const remainingMs = intervalMs - (Date.now() - lastSentAt.current);

      if (remainingMs <= 0) {
        flush();
        return;
      }

      if (timer.current === null) {
        timer.current = window.setTimeout(flush, remainingMs);
      }
    },
    [flush, intervalMs],
  );

  useEffect(() => clearTimer, [clearTimer]);

  return { flush, queue };
}

function spectrumFromEntity(entity: DashboardEntity) {
  if (entity.domain !== "light") {
    return null;
  }

  const rgb = numberArray(entity.attributes.rgb_color, 3);
  if (rgb) {
    return spectrumFromRgb(rgb as [number, number, number]);
  }

  const hs = numberArray(entity.attributes.hs_color, 2);
  if (hs) {
    return spectrumFromHs(hs[0], hs[1]);
  }

  const kelvin = Number(entity.attributes.color_temp_kelvin);
  if (Number.isFinite(kelvin) && kelvin > 0) {
    return spectrumFromKelvin(kelvin);
  }

  const mired = Number(entity.attributes.color_temp);
  if (Number.isFinite(mired) && mired > 0) {
    return spectrumFromKelvin(Math.round(1_000_000 / mired));
  }

  return null;
}

function brightnessFromEntity(entity: DashboardEntity) {
  const brightness = Number(entity.attributes.brightness);
  if (Number.isFinite(brightness) && brightness > 0) {
    return clamp((brightness / 255) * 100, 0, 100);
  }

  return entity.state === "on" ? 100 : 0;
}

function spectrumGroupKey(value: SpectrumValue) {
  const hueBucket = Math.round(value.cursor.x * 24);
  const saturationBucket = Math.round((1 - value.cursor.y) * 8);

  return `${hueBucket}:${saturationBucket}`;
}

function spectrumFromZone(zone: DashboardZone) {
  const lights = zone.entities.filter((entity) => entity.domain === "light");
  const candidateLights = lights.some((entity) => entity.state === "on")
    ? lights.filter((entity) => entity.state === "on")
    : lights;

  const candidates = candidateLights.flatMap((entity) => {
    const spectrum = spectrumFromEntity(entity);
    if (!spectrum) {
      return [];
    }

    return [
      {
        spectrum,
        brightness: brightnessFromEntity(entity),
        groupKey: spectrumGroupKey(spectrum),
      },
    ];
  });

  if (!candidates.length) {
    return null;
  }

  const groups = new Map<string, { count: number; brightest: (typeof candidates)[number] }>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.groupKey);
    if (!group) {
      groups.set(candidate.groupKey, { count: 1, brightest: candidate });
      continue;
    }

    group.count += 1;
    if (candidate.brightness > group.brightest.brightness) {
      group.brightest = candidate;
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }

    return b.brightest.brightness - a.brightest.brightness;
  })[0].brightest.spectrum;
}

function spectrumWithCursor(value: SpectrumValue | null, cursor?: SpectrumCursor) {
  if (!value || !cursor) {
    return value;
  }

  return {
    ...value,
    cursor: {
      x: clamp(cursor.x, 0, 1),
      y: clamp(cursor.y, 0, 1),
    },
  };
}

function useDashboardState() {
  const [data, setData] = useState<DashboardState | null>(null);
  const [status, setStatus] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const pollingPausedUntil = useRef(0);
  const eventStreamConnected = useRef(false);
  const lastEventFallbackPollAt = useRef(0);

  const pausePolling = useCallback((durationMs: number) => {
    pollingPausedUntil.current = Math.max(pollingPausedUntil.current, Date.now() + durationMs);
  }, []);

  const refresh = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (!force && Date.now() < pollingPausedUntil.current) {
      return null;
    }
    if (force) {
      pollingPausedUntil.current = 0;
    }

    const requestStartedAt = Date.now();
    setStatus((current) => (current === "idle" ? "loading" : current));
    const payload = await fetchDashboardStateSnapshot();
    if (!force && pollingPausedUntil.current > requestStartedAt) {
      setStatus("idle");
      return null;
    }
    setData(payload);
    setError(null);
    setStatus("idle");
    return payload;
  }, []);

  useEffect(() => {
    let alive = true;

    async function load({ force = false, initial = false }: { force?: boolean; initial?: boolean } = {}) {
      if (!force && Date.now() < pollingPausedUntil.current) {
        return;
      }
      if (force) {
        pollingPausedUntil.current = 0;
      }

      try {
        if (initial) {
          setStatus("loading");
        }
        const requestStartedAt = Date.now();
        const payload = await fetchDashboardStateSnapshot();
        if (!force && pollingPausedUntil.current > requestStartedAt) {
          return;
        }
        if (alive) {
          setData(payload);
          setError(null);
          setStatus("idle");
        }
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : "Failed to load dashboard state");
          setStatus("error");
        }
      }
    }

    load({ force: true, initial: true });
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (eventStreamConnected.current && now - lastEventFallbackPollAt.current < 30_000) {
        return;
      }
      lastEventFallbackPollAt.current = now;
      load();
    }, 7000);
    const refreshVisibleState = () => {
      if (!document.hidden) {
        load({ force: true });
      }
    };

    window.addEventListener("focus", refreshVisibleState);
    window.addEventListener("online", refreshVisibleState);
    window.addEventListener("pageshow", refreshVisibleState);
    document.addEventListener("visibilitychange", refreshVisibleState);

    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisibleState);
      window.removeEventListener("online", refreshVisibleState);
      window.removeEventListener("pageshow", refreshVisibleState);
      document.removeEventListener("visibilitychange", refreshVisibleState);
    };
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      return;
    }

    const events = new EventSource("/api/events");

    const handleOpen = () => {
      eventStreamConnected.current = true;
    };
    const handleDisconnect = () => {
      eventStreamConnected.current = false;
    };
    const handleState = (event: MessageEvent) => {
      if (Date.now() < pollingPausedUntil.current) {
        return;
      }

      try {
        const payload = JSON.parse(event.data) as DashboardState;
        setData(payload);
        setError(null);
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to read dashboard event");
      }
    };

    events.addEventListener("open", handleOpen);
    events.addEventListener("error", handleDisconnect);
    events.addEventListener("state", handleState as EventListener);

    return () => {
      eventStreamConnected.current = false;
      events.removeEventListener("open", handleOpen);
      events.removeEventListener("error", handleDisconnect);
      events.removeEventListener("state", handleState as EventListener);
      events.close();
    };
  }, []);

  return { data, status, error, setData, refresh, pausePolling };
}

function useBuildReload() {
  const currentBuildId = useRef<string | null>(null);
  const checking = useRef(false);

  const applyStylesheetCacheBreaker = useCallback((buildId: string) => {
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href*="/_next/static/"][href*=".css"]');
    links.forEach((link) => {
      const url = new URL(link.href, window.location.href);
      if (url.searchParams.get("v") === buildId) {
        return;
      }

      url.searchParams.set("v", buildId);
      link.href = `${url.pathname}${url.search}${url.hash}`;
    });
  }, []);

  const checkBuild = useCallback(async () => {
    if (checking.current) {
      return;
    }

    checking.current = true;
    try {
      const response = await fetch("/api/version", { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { buildId?: string };
      const nextBuildId = payload.buildId;
      if (!nextBuildId) {
        return;
      }

      applyStylesheetCacheBreaker(nextBuildId);

      if (currentBuildId.current === null) {
        currentBuildId.current = nextBuildId;
      } else if (currentBuildId.current !== nextBuildId) {
        window.location.reload();
      }
    } finally {
      checking.current = false;
    }
  }, [applyStylesheetCacheBreaker]);

  useEffect(() => {
    checkBuild();
    const timer = window.setInterval(checkBuild, 60_000);
    const checkWhenVisible = () => {
      if (!document.hidden) {
        checkBuild();
      }
    };

    window.addEventListener("focus", checkWhenVisible);
    window.addEventListener("online", checkWhenVisible);
    window.addEventListener("pageshow", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", checkWhenVisible);
      window.removeEventListener("online", checkWhenVisible);
      window.removeEventListener("pageshow", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [checkBuild]);
}

function StatChip({ domain, count }: { domain: HaDomain; count: number }) {
  const Icon = domainIcons[domain];

  return (
    <div
      className={classNames(
        "flex h-11 min-w-0 items-center gap-2 border px-3 text-sm font-semibold uppercase",
        domainAccent[domain],
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{domain.replace("_", " ")}</span>
      <span className="ml-auto tabular-nums">{count}</span>
    </div>
  );
}

function countDomainsForZone(zone: DashboardZone): HaDomain[] {
  if (isNetworkZone(zone)) {
    return [];
  }

  if (isOutsideZone(zone)) {
    return ["light"];
  }

  if (isClimateZone(zone)) {
    return ["climate"];
  }

  return ["light", "switch"];
}

function ZoneButton({
  zone,
  selected,
  onClick,
  nested = false,
  hideCounts = false,
  domains,
  routerStatus,
}: {
  zone: DashboardZone;
  selected: boolean;
  onClick: () => void;
  nested?: boolean;
  hideCounts?: boolean;
  domains?: HaDomain[];
  routerStatus?: RouterStatus;
}) {
  const countDomains = domains ?? countDomainsForZone(zone);
  const networkStatus = isNetworkZone(zone)
    ? (routerStatus?.wanConnected ? "Connected" : "Disconnected")
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "zone-button group relative flex min-h-24 w-full flex-col justify-between overflow-hidden border bg-neutral-900/80 p-4 text-left outline-none transition",
        nested && "zone-button-child min-h-20 py-3 pl-6",
        selected && "zone-button-selected",
        selected
          ? "border-cyan-300 shadow-[0_0_0_1px_rgba(103,232,249,0.5),0_0_26px_rgba(103,232,249,0.16)]"
          : "border-neutral-700 hover:border-fuchsia-300/80",
      )}
    >
      <span className="pointer-events-none absolute right-0 top-0 h-5 w-16 border-b border-l border-cyan-300/20" />
      <span className="flex items-start justify-between gap-3">
        <span
          className="zone-title-bar min-w-0 flex-1 truncate text-lg font-black uppercase"
        >
          {zone.name}
        </span>
      </span>
      {networkStatus ? (
        <span
          className={classNames(
            "zone-counts zone-network-status mt-3 grid gap-2 text-xs font-semibold uppercase",
            routerStatus?.wanConnected ? "zone-network-status-connected" : "zone-network-status-disconnected",
          )}
        >
          <span>{networkStatus}</span>
        </span>
      ) : hideCounts || countDomains.length === 0 ? null : (
        <span
          className="zone-counts mt-3 grid gap-2 text-xs font-semibold text-neutral-400"
          style={{ gridTemplateColumns: `repeat(${countDomains.length}, minmax(0, 1fr))` }}
        >
          {countDomains.map((domain) => (
            <span key={domain}>
              {zone.counts[domain]} {domain === "light" ? "lights" : domain === "switch" ? "switches" : domain}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
  variant = "cyan",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "cyan" | "pink" | "yellow" | "white";
}) {
  const variants = {
    cyan: "border-cyan-300/60 bg-cyan-300/10 text-cyan-200 hover:bg-cyan-300/20",
    pink: "border-fuchsia-300/60 bg-fuchsia-300/10 text-fuchsia-200 hover:bg-fuchsia-300/20",
    yellow: "border-yellow-300/60 bg-yellow-300/10 text-yellow-100 hover:bg-yellow-300/20",
    white: "border-neutral-200/70 bg-neutral-100/10 text-neutral-100 hover:bg-neutral-100/20",
  };

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          onPointerDown={(event) => {
            if (event.pointerType === "mouse") {
              return;
            }
            event.preventDefault();
            if (!disabled) {
              onClick();
            }
          }}
          onClick={onClick}
          disabled={disabled}
          className={classNames(
            "flex h-16 min-w-16 touch-manipulation items-center justify-center border text-sm font-black uppercase outline-none transition disabled:cursor-not-allowed disabled:border-neutral-700 disabled:bg-neutral-900 disabled:text-neutral-600",
            variants[variant],
          )}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={8}
          className="border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-semibold text-neutral-200 shadow-xl"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function SpectrumPad({
  disabled,
  brightness,
  value,
  onValueChange,
  onPick,
}: {
  disabled: boolean;
  brightness: number;
  value: SpectrumValue;
  onValueChange: (value: SpectrumValue) => void;
  onPick: (rgb: [number, number, number], cursor: SpectrumCursor) => void;
}) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const cursorAnimation = useRef<number | null>(null);
  const draggingCursor = useRef(false);
  const cursorElement = useRef<SVGGElement | null>(null);
  const dotElements = useRef(new Map<string, SVGCircleElement>());
  const activeDotIds = useRef(new Set<string>());
  const dotsRef = useRef<SpectrumDot[]>([]);
  const disabledRef = useRef(disabled);
  const padSizeRef = useRef({ width: 0, height: 0 });
  const targetCursorRef = useRef(value.cursor);
  const [dots, setDots] = useState<SpectrumDot[]>([]);
  const [padSize, setPadSize] = useState({ width: 0, height: 0 });
  const displayCursorRef = useRef(value.cursor);
  const [isDragging, setIsDragging] = useState(false);
  const { flush: flushPickCommand, queue: queuePickCommand } = useThrottledCommand(
    ({ cursor, rgb }: { cursor: SpectrumCursor; rgb: [number, number, number] }) => onPick(rgb, cursor),
    LIGHT_DRAG_COMMAND_INTERVAL_MS,
  );

  const applyDisplayCursor = useCallback((cursor: SpectrumValue["cursor"]) => {
    displayCursorRef.current = cursor;

    if (cursorElement.current) {
      const point = spectrumDisplayPoint(cursor, padSizeRef.current.width, padSizeRef.current.height);
      cursorElement.current.setAttribute("transform", `translate(${point.xPx} ${point.yPx}) rotate(-105)`);
    }

    for (const dotId of activeDotIds.current) {
      const dotElement = dotElements.current.get(dotId);
      if (!dotElement) {
        continue;
      }

      dotElement.setAttribute("r", String(SVG_SPECTRUM_DOT_RADIUS_PX));
    }
    activeDotIds.current = new Set();

    if (disabledRef.current) {
      return;
    }

    const point = spectrumDisplayPoint(cursor, padSizeRef.current.width, padSizeRef.current.height);
    const nextActiveDotIds = new Set<string>();

    for (const dot of dotsRef.current) {
      const distance = Math.hypot(dot.xPx - point.xPx, dot.yPx - point.yPx);
      if (distance > SPECTRUM_DOT_INFLUENCE_RADIUS_PX) {
        continue;
      }

      const dotElement = dotElements.current.get(dot.id);
      if (!dotElement) {
        continue;
      }

      const size = focusedSpectrumDotSize(dot, cursor, point);
      dotElement.setAttribute("r", String(svgSpectrumDotRadius(size)));
      nextActiveDotIds.add(dot.id);
    }

    activeDotIds.current = nextActiveDotIds;
  }, []);

  useEffect(() => {
    return () => {
      if (cursorAnimation.current) {
        window.cancelAnimationFrame(cursorAnimation.current);
      }
    };
  }, []);

  useEffect(() => {
    const target = value.cursor;

    if (Math.hypot(target.x - targetCursorRef.current.x, target.y - targetCursorRef.current.y) < 0.001) {
      return;
    }
    targetCursorRef.current = target;

    if (cursorAnimation.current) {
      window.cancelAnimationFrame(cursorAnimation.current);
      cursorAnimation.current = null;
    }

    if (draggingCursor.current || disabledRef.current) {
      applyDisplayCursor(target);
      return;
    }

    const start = displayCursorRef.current;
    const distance = Math.hypot(target.x - start.x, target.y - start.y);
    if (distance < 0.001) {
      applyDisplayCursor(target);
      return;
    }

    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = clamp((now - startedAt) / SPECTRUM_PROGRAMMATIC_CURSOR_MS, 0, 1);
      const eased = easeCursorTravel(progress);
      const next = {
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
      };

      applyDisplayCursor(next);

      if (progress < 1) {
        cursorAnimation.current = window.requestAnimationFrame(animate);
      } else {
        cursorAnimation.current = null;
      }
    };

    cursorAnimation.current = window.requestAnimationFrame(animate);
  }, [applyDisplayCursor, value.cursor.x, value.cursor.y]);

  useEffect(() => {
    dotsRef.current = dots;
    applyDisplayCursor(displayCursorRef.current);
  }, [applyDisplayCursor, dots]);

  useEffect(() => {
    disabledRef.current = disabled;

    if (disabled) {
      draggingCursor.current = false;
      setIsDragging(false);
    }

    applyDisplayCursor(displayCursorRef.current);
  }, [applyDisplayCursor, disabled]);

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) {
      return;
    }

    const rebuild = () => {
      const rect = pad.getBoundingClientRect();
      const nextSize = { width: rect.width, height: rect.height };
      padSizeRef.current = nextSize;
      setPadSize(nextSize);
      setDots(buildSpectrumDots(rect.width, rect.height));
    };

    rebuild();
    const observer = new ResizeObserver(rebuild);
    observer.observe(pad);
    window.addEventListener("orientationchange", rebuild);

    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", rebuild);
    };
  }, []);

  const pick = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || !padRef.current) {
        return;
      }

      const rect = padRef.current.getBoundingClientRect();
      const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      const rgb = spectrumRgbAtPosition(x, y);
      const cursor = { x, y };

      if (cursorAnimation.current) {
        window.cancelAnimationFrame(cursorAnimation.current);
        cursorAnimation.current = null;
      }
      targetCursorRef.current = cursor;
      applyDisplayCursor(cursor);
      onValueChange({ cursor, preview: rgb });
      queuePickCommand({ cursor, rgb });
    },
    [disabled, onValueChange, queuePickCommand],
  );

  const stopDragging = useCallback(() => {
    draggingCursor.current = false;
    setIsDragging(false);
    flushPickCommand();
  }, [flushPickCommand]);

  return (
    <div className="relative">
      <div
        ref={padRef}
        role="slider"
        aria-label="Zone color spectrum"
        aria-disabled={disabled}
        aria-valuetext={`rgb ${value.preview.join(" ")}`}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={(event) => {
          if (disabled) {
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          draggingCursor.current = true;
          setIsDragging(true);
          pick(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) {
            pick(event);
          }
        }}
        onPointerUp={() => {
          stopDragging();
        }}
        onPointerCancel={() => {
          stopDragging();
        }}
        onLostPointerCapture={() => {
          stopDragging();
        }}
        className={classNames(
          "spectrum-pad relative h-60 w-full touch-none overflow-hidden outline-none",
          disabled && "spectrum-pad-disabled",
        )}
      >
        <div className="spectrum-pad-bg absolute inset-0 bg-neutral-950/80" />
        <svg
          className="spectrum-svg pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${Math.max(padSize.width, 1)} ${Math.max(padSize.height, 1)}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {dots.map((dot) => {
            return (
              <circle
                key={dot.id}
                ref={(node) => {
                  if (node) {
                    dotElements.current.set(dot.id, node);
                  } else {
                    dotElements.current.delete(dot.id);
                  }
                }}
                className="spectrum-svg-dot"
                cx={dot.xPx}
                cy={dot.yPx}
                r={SVG_SPECTRUM_DOT_RADIUS_PX}
                fill={disabled ? `rgb(${DISABLED_SPECTRUM_DOT_RGB})` : `rgb(${dot.rgb.join(" ")})`}
              />
            );
          })}
          {disabled ? null : (
            <g
              ref={cursorElement}
              className={classNames("spectrum-svg-cursor", isDragging && "spectrum-svg-cursor-dragging")}
              transform={`translate(${spectrumDisplayPoint(displayCursorRef.current, padSize.width, padSize.height).xPx} ${spectrumDisplayPoint(displayCursorRef.current, padSize.width, padSize.height).yPx}) rotate(-105)`}
            >
              <circle
                cx={0}
                cy={0}
                r={SVG_SPECTRUM_CURSOR_RADIUS_PX}
                strokeWidth={SVG_SPECTRUM_CURSOR_STROKE_PX}
                strokeDasharray="20 40"
              />
            </g>
          )}
        </svg>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-sm font-semibold text-neutral-300">
        <span className="uppercase text-fuchsia-200">Spectrum</span>
        <span className="tabular-nums text-neutral-400">brightness {brightness}%</span>
      </div>
    </div>
  );
}

function IntensityControl({
  brightness,
  color,
  disabled,
  onBrightnessChange,
  onBrightnessCommit,
}: {
  brightness: number;
  color: [number, number, number];
  disabled: boolean;
  onBrightnessChange: (value: number) => void;
  onBrightnessCommit: (value: number) => void;
}) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const commitValueRef = useRef(brightness);
  const draggingRef = useRef(false);
  const [dotCount, setDotCount] = useState(2);
  const [lineWidth, setLineWidth] = useState(0);
  const { displayValue, releaseLocalValue, setLocalValue } = useRemoteEasedNumber(brightness);
  const displayBrightness = clamp(displayValue, 0, 100);
  const displayPercent = displayBrightness / 100;
  const { flush: flushBrightnessCommand, queue: queueBrightnessCommand } = useThrottledCommand(
    onBrightnessCommit,
    LIGHT_DRAG_COMMAND_INTERVAL_MS,
  );

  useEffect(() => {
    commitValueRef.current = brightness;
  }, [brightness]);

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) {
      return;
    }

    const rebuild = () => {
      const rect = pad.getBoundingClientRect();
      setLineWidth(rect.width);
      setDotCount(Math.max(2, Math.round(rect.width / SPECTRUM_DOT_GAP_PX) + 1));
    };

    rebuild();
    const observer = new ResizeObserver(rebuild);
    observer.observe(pad);
    window.addEventListener("orientationchange", rebuild);

    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", rebuild);
    };
  }, []);

  const setBrightnessValue = useCallback(
    (value: number) => {
      const next = clamp(Math.round(value), 0, 100);
      commitValueRef.current = next;
      setLocalValue(next);
      onBrightnessChange(next);
      return next;
    },
    [onBrightnessChange, setLocalValue],
  );

  const pick = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || !padRef.current) {
        return;
      }

      const rect = padRef.current.getBoundingClientRect();
      const next = setBrightnessValue(((event.clientX - rect.left) / rect.width) * 100);
      queueBrightnessCommand(next);
    },
    [disabled, queueBrightnessCommand, setBrightnessValue],
  );

  const commit = useCallback(() => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    const value = commitValueRef.current;
    releaseLocalValue(value);
    flushBrightnessCommand();
  }, [flushBrightnessCommand, releaseLocalValue]);

  const keyStep = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, next: number) => {
      event.preventDefault();
      const value = clamp(Math.round(next), 0, 100);
      setBrightnessValue(value);
      releaseLocalValue(value);
      onBrightnessCommit(value);
    },
    [onBrightnessCommit, releaseLocalValue, setBrightnessValue],
  );

  const dots = Array.from({ length: dotCount }, (_, index) => {
    const amount = dotCount <= 1 ? 0 : index / (dotCount - 1);
    return {
      id: index,
      amount,
      opacity: amount * 0.96,
      rgb: color,
      xPx: amount * lineWidth,
    };
  });
  const displayLabel = Math.round(displayBrightness);
  const displayCursorX = insetPixel(displayPercent, lineWidth, LINE_CURSOR_INSET_PX);

  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_96px] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">Intensity</p>
        <div className="px-1">
          <div
            ref={padRef}
            role="slider"
            aria-label="Brightness"
            aria-disabled={disabled}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={displayLabel}
            tabIndex={disabled ? -1 : 0}
            onKeyDown={(event) => {
              if (disabled) {
                return;
              }
              if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                keyStep(event, commitValueRef.current - 1);
              } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                keyStep(event, commitValueRef.current + 1);
              } else if (event.key === "PageDown") {
                keyStep(event, commitValueRef.current - 10);
              } else if (event.key === "PageUp") {
                keyStep(event, commitValueRef.current + 10);
              } else if (event.key === "Home") {
                keyStep(event, 0);
              } else if (event.key === "End") {
                keyStep(event, 100);
              }
            }}
            onPointerDown={(event) => {
              if (disabled) {
                return;
              }
              event.currentTarget.setPointerCapture(event.pointerId);
              draggingRef.current = true;
              pick(event);
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1) {
                pick(event);
              }
            }}
            onPointerUp={commit}
            onPointerCancel={commit}
            onLostPointerCapture={commit}
            className={classNames(
              "intensity-dot-pad relative h-12 w-full touch-none overflow-hidden outline-none",
              disabled && "intensity-dot-pad-disabled",
            )}
          >
            <svg
              className="dot-line-svg pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${Math.max(lineWidth, 1)} ${SVG_LINE_HEIGHT_PX}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {dots.map((dot) => {
                const size = focusedLineDotSize(dot.xPx, displayPercent, lineWidth, displayCursorX);

                return (
                  <circle
                    key={dot.id}
                    className="dot-line-svg-dot"
                    cx={dot.xPx}
                    cy={SVG_LINE_CENTER_Y_PX}
                    r={svgSpectrumDotRadius(size)}
                    fill={`rgb(${dot.rgb.join(" ")})`}
                    opacity={dot.opacity}
                  />
                );
              })}
              <g className="dot-line-svg-cursor" transform={`translate(${displayCursorX} ${SVG_LINE_CENTER_Y_PX}) rotate(-120)`}>
                <circle
                  cx={0}
                  cy={0}
                  r={SVG_LINE_CURSOR_RADIUS_PX}
                  strokeWidth={SVG_LINE_CURSOR_STROKE_PX}
                  strokeDasharray="17.3 34.6"
                />
              </g>
            </svg>
          </div>
        </div>
        <p className="text-4xl font-black tabular-nums text-neutral-50 md:text-right">{displayLabel}%</p>
      </div>
    </div>
  );
}

function stringListAttribute(entity: DashboardEntity, name: string) {
  const value = entity.attributes[name];
  return Array.isArray(value) ? value.map(String) : [];
}

function numericClimateAttribute(entity: DashboardEntity, name: string) {
  const value = Number(entity.attributes[name]);
  return Number.isFinite(value) ? value : null;
}

function climateTargetTemperature(entity: DashboardEntity) {
  return numericClimateAttribute(entity, "temperature") ?? numericClimateAttribute(entity, "current_temperature");
}

function climateCurrentTemperature(entity: DashboardEntity) {
  return numericClimateAttribute(entity, "current_temperature");
}

function formatTemperature(value: number | null) {
  if (value === null) {
    return "--.-";
  }

  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function roundToStep(value: number, step: number) {
  return Number((Math.round(value / step) * step).toFixed(3));
}

function temperatureDelta(entity: DashboardEntity, delta: number, step: number, base?: number) {
  const current = base ?? climateTargetTemperature(entity) ?? 20;
  const min = numericClimateAttribute(entity, "min_temp") ?? 5;
  const max = numericClimateAttribute(entity, "max_temp") ?? 40;
  const increment = Math.abs(step) || 0.5;
  const ratio = current / increment;
  const aligned = Math.abs(ratio - Math.round(ratio)) < STEP_EPSILON;
  const stepped = aligned
    ? current + delta
    : delta > 0
      ? Math.ceil(ratio) * increment
      : Math.floor(ratio) * increment;

  return clamp(roundToStep(stepped, increment), min, max);
}

function isClimateEntityOn(entity: DashboardEntity) {
  return !["off", "unavailable", "unknown"].includes(entity.state);
}

function entityText(entity: DashboardEntity) {
  return `${entity.name} ${entity.entity_id}`.toLowerCase();
}

function matchesEntity(entity: DashboardEntity, words: string[]) {
  const text = entityText(entity);
  return words.some((word) => text.includes(word));
}

function dashboardEntityIsOn(entity: DashboardEntity) {
  if (["unavailable", "unknown"].includes(entity.state)) {
    return false;
  }
  if (entity.domain === "climate") {
    return entity.state !== "off";
  }
  return ["on", "open", "opening", "playing", "heat", "cool", "heat_cool"].includes(entity.state);
}

function zoneBrightnessPctFromEntities(entities: DashboardEntity[]) {
  const values = entities
    .filter((entity) => entity.domain === "light" && entity.state === "on")
    .map((entity) => Number(entity.attributes.brightness ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!values.length) {
    return 0;
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round((average / 255) * 100);
}

function withDashboardEntityUpdates(
  data: DashboardState,
  updateEntity: (entity: DashboardEntity) => DashboardEntity,
  preferences = data.preferences,
) {
  const nextEntities = data.entities.map(updateEntity);
  const entitiesChanged = nextEntities.some((entity, index) => entity !== data.entities[index]);
  const entityById = new Map(nextEntities.map((entity) => [entity.entity_id, entity]));
  const nextZones = data.zones.map((zone) => {
    const nextZoneEntities = zone.entities.map((entity) => entityById.get(entity.entity_id) ?? entity);
    const zoneChanged = nextZoneEntities.some((entity, index) => entity !== zone.entities[index]);

    if (!zoneChanged) {
      return zone;
    }

    return {
      ...zone,
      entities: nextZoneEntities,
      isOn: nextZoneEntities.some(dashboardEntityIsOn),
      brightnessPct: zoneBrightnessPctFromEntities(nextZoneEntities),
    };
  });
  const zonesChanged = nextZones.some((zone, index) => zone !== data.zones[index]);

  if (!entitiesChanged && !zonesChanged && preferences === data.preferences) {
    return data;
  }

  return {
    ...data,
    entities: entitiesChanged ? nextEntities : data.entities,
    zones: zonesChanged ? nextZones : data.zones,
    preferences,
  };
}

function optimisticClimateOnState(entity: DashboardEntity) {
  if (isClimateEntityOn(entity)) {
    return entity.state;
  }

  return stringListAttribute(entity, "hvac_modes").find((mode) => !["off", "unavailable", "unknown"].includes(mode)) ?? "heat";
}

function brightnessAttributeFromPct(value: unknown) {
  const brightnessPct = Number(value);
  if (!Number.isFinite(brightnessPct)) {
    return null;
  }

  return Math.round((clamp(brightnessPct, 0, 100) / 100) * 255);
}

function optimisticEntityForAction(entity: DashboardEntity, action: EntityActionInput) {
  if (entity.entity_id !== action.entityId || entity.domain !== action.domain) {
    return entity;
  }

  const data = action.data ?? {};
  let state = entity.state;
  let attributes = entity.attributes;
  const setAttributes = (updates: Record<string, unknown>) => {
    attributes = { ...attributes, ...updates };
  };

  if (action.domain === "climate") {
    if (action.service === "turn_off") {
      state = "off";
    } else if (action.service === "turn_on") {
      state = optimisticClimateOnState(entity);
    } else if (action.service === "toggle") {
      state = isClimateEntityOn(entity) ? "off" : optimisticClimateOnState(entity);
    } else if (action.service === "set_hvac_mode" && typeof data.hvac_mode === "string") {
      state = data.hvac_mode;
    } else if (action.service === "set_temperature") {
      const temperature = Number(data.temperature);
      if (Number.isFinite(temperature)) {
        setAttributes({ temperature });
      }
    } else if (action.service === "set_fan_mode" && typeof data.fan_mode === "string") {
      setAttributes({ fan_mode: data.fan_mode });
    } else if (action.service === "set_swing_mode" && typeof data.swing_mode === "string") {
      setAttributes({ swing_mode: data.swing_mode });
    } else if (action.service === "set_aircon_sweep") {
      setAttributes({ swing_mode: data.enabled ? "both" : "off" });
    }
  } else if (["light", "switch"].includes(action.domain)) {
    if (action.service === "turn_on") {
      state = "on";
    } else if (action.service === "turn_off") {
      state = "off";
    } else if (action.service === "toggle") {
      state = state === "on" ? "off" : "on";
    }

    if (action.domain === "light") {
      const brightness = brightnessAttributeFromPct(data.brightness_pct);
      if (brightness !== null) {
        setAttributes({ brightness });
      }
      const rgb = numberArray(data.rgb_color, 3);
      if (rgb) {
        setAttributes({ rgb_color: rgb.slice(0, 3).map((part) => clamp(Math.round(part), 0, 255)) });
      }
    }
  }

  return { ...entity, state, attributes };
}

function withoutUndefinedObject<T extends object>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function optimisticPreferences(current: DashboardPreferences, next: DashboardPreferences) {
  const merged: DashboardPreferences = {
    ...current,
    ...withoutUndefinedObject(next),
  };

  if (next.aircon) {
    merged.aircon = {
      ...(current.aircon ?? {}),
      ...withoutUndefinedObject(next.aircon),
      updatedAt: new Date().toISOString(),
    };
  }

  return merged;
}

function optimisticStateForEntityActions(data: DashboardState, actions: EntityActionInput[]) {
  return actions.reduce((state, action) => {
    const preferences = action.remember ? optimisticPreferences(state.preferences, action.remember) : state.preferences;
    return withDashboardEntityUpdates(state, (entity) => optimisticEntityForAction(entity, action), preferences);
  }, data);
}

function rgbFromBody(value: unknown) {
  const rgb = numberArray(value, 3);
  return rgb ? (rgb.slice(0, 3).map((part) => clamp(Math.round(part), 0, 255)) as [number, number, number]) : null;
}

function optimisticZoneEntity(
  entity: DashboardEntity,
  action: string,
  brightnessPct: number,
  rgb: [number, number, number] | null,
) {
  const brightness = Math.round((clamp(brightnessPct, 0, 100) / 100) * 255);
  const color = rgb ?? (action === "white" ? [255, 255, 255] : [255, 147, 41]);

  if (action === "off") {
    if (["light", "switch"].includes(entity.domain)) {
      return { ...entity, state: "off" };
    }
    if (entity.domain === "climate") {
      return { ...entity, state: "off" };
    }
    return entity;
  }

  if (action === "brightness") {
    if (entity.domain === "light") {
      return {
        ...entity,
        state: brightnessPct <= 0 ? "off" : "on",
        attributes: { ...entity.attributes, brightness },
      };
    }
    if (entity.domain === "switch" && entity.isIllumination) {
      return { ...entity, state: brightnessPct <= 0 ? "off" : "on" };
    }
    return entity;
  }

  if (action === "color") {
    if (entity.domain === "light") {
      return {
        ...entity,
        state: "on",
        attributes: { ...entity.attributes, brightness, rgb_color: color },
      };
    }
    if (entity.domain === "switch" && entity.isIllumination) {
      return { ...entity, state: "on" };
    }
    return entity;
  }

  if (["on", "candlelight", "white"].includes(action)) {
    if (entity.domain === "light") {
      return {
        ...entity,
        state: "on",
        attributes: { ...entity.attributes, brightness, rgb_color: color },
      };
    }
    if (entity.domain === "switch" && (entity.isIllumination || action === "on")) {
      return { ...entity, state: "on" };
    }
  }

  return entity;
}

function optimisticStateForZoneAction(
  data: DashboardState,
  zoneId: string,
  action: string,
  body: Record<string, unknown>,
) {
  const zone = data.zones.find((candidate) => candidate.id === zoneId);
  if (!zone) {
    return data;
  }

  const entityIds = new Set(zone.entities.map((entity) => entity.entity_id));
  const brightnessPct = clamp(Math.round(Number(body.brightnessPct ?? zone.brightnessPct ?? 100)), 0, 100);
  const rgb = rgbFromBody(body.rgb);

  return withDashboardEntityUpdates(data, (entity) =>
    entityIds.has(entity.entity_id) ? optimisticZoneEntity(entity, action, brightnessPct, rgb) : entity,
  );
}

function isLightZoneAction(action: string) {
  return ["on", "off", "brightness", "color", "candlelight", "white"].includes(action);
}

function entityActionsAffectLightPolling(actions: EntityActionInput[], data: DashboardState | null) {
  return actions.some((action) => {
    if (action.domain === "light") {
      return true;
    }

    if (action.domain !== "switch" || !data) {
      return false;
    }

    return data.entities.some((entity) => entity.entity_id === action.entityId && entity.isIllumination);
  });
}

async function callClimateActions(
  actions: EntityActionInput[],
  onEntityActions: (actions: EntityActionInput[], toast: string) => Promise<void>,
  toast: string,
) {
  await onEntityActions(actions, toast);
}

function ClimateCard({
  children,
  entity,
  kicker,
  title,
}: {
  children?: React.ReactNode;
  entity?: DashboardEntity;
  kicker: string;
  title: string;
}) {
  const unavailable = entity ? ["unknown", "unavailable"].includes(entity.state) : true;

  return (
    <section className="climate-card border border-neutral-700 bg-neutral-950/70 p-5">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase text-cyan-300">{kicker}</p>
          <h2 className="mt-1 truncate text-3xl font-black uppercase text-neutral-50">{title}</h2>
        </div>
        <div
          className={classNames(
            "border px-3 py-2 text-xs font-black uppercase",
            unavailable ? "border-red-400/50 text-red-400" : "border-cyan-300/50 text-cyan-200",
          )}
        >
          {entity?.state ?? "missing"}
        </div>
      </header>

      {entity ? children : <p className="text-sm font-black uppercase text-neutral-400">Entity missing</p>}
    </section>
  );
}

function TemperatureStepper({
  entity,
  label,
  onChange,
  step = 0.5,
}: {
  entity: DashboardEntity;
  label: string;
  onChange: (temperature: number) => Promise<void>;
  step?: number;
}) {
  const serverTarget = climateTargetTemperature(entity);
  const current = climateCurrentTemperature(entity);
  const [target, setTarget] = useState(serverTarget);

  useEffect(() => {
    setTarget(serverTarget);
  }, [entity.entity_id, serverTarget]);

  const nudge = (delta: number) => {
    const next = temperatureDelta(entity, delta, step, target ?? serverTarget ?? current ?? 20);
    setTarget(next);
    void onChange(next);
  };

  return (
    <div className="temperature-stepper border border-neutral-700 bg-neutral-950/70 p-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase text-cyan-300">{label}</p>
          <p className="climate-temp-readout mt-1 font-black tabular-nums text-neutral-50">
            {formatTemperature(target)}
            <span>&deg;</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-black uppercase text-neutral-400">Current</p>
          <p className="font-mono text-xl font-black tabular-nums text-neutral-100">
            {formatTemperature(current)}
            <span>&deg;</span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          className="climate-icon-button border"
          aria-label={`Lower ${label}`}
          onClick={() => nudge(-step)}
        >
          <Minus className="h-7 w-7" />
        </button>
        <button
          type="button"
          className="climate-icon-button border"
          aria-label={`Raise ${label}`}
          onClick={() => nudge(step)}
        >
          <Plus className="h-7 w-7" />
        </button>
      </div>
    </div>
  );
}

function LabeledSwitch({
  checked,
  disabled,
  icon,
  label,
  leftLabel,
  onChange,
  rightLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  label: string;
  leftLabel: string;
  onChange: () => void;
  rightLabel: string;
}) {
  return (
    <div className={classNames("climate-switch-row border", disabled && "climate-switch-row-disabled")}>
      <span className={classNames("climate-switch-label", !checked && "climate-switch-label-active")}>{leftLabel}</span>
      <button
        type="button"
        className={classNames("cyber-switch", checked && "cyber-switch-checked")}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
      >
        <span className="cyber-switch-thumb">{icon}</span>
      </button>
      <span className={classNames("climate-switch-label", checked && "climate-switch-label-active")}>{rightLabel}</span>
    </div>
  );
}

function PanelHeaterControl({
  entity,
  onEntityActions,
}: {
  entity?: DashboardEntity;
  onEntityActions: (actions: EntityActionInput[], toast: string) => Promise<void>;
}) {
  if (!entity) {
    return <ClimateCard kicker="Heating Unit" title="Panel Heater" />;
  }

  const isOn = isClimateEntityOn(entity);

  const setTemperature = (temperature: number) =>
    callClimateActions(
      [{ entityId: entity.entity_id, domain: "climate", service: "set_temperature", data: { temperature } }],
      onEntityActions,
      `Panel Heater ${temperature} degrees`,
    );

  const setPower = () =>
    callClimateActions(
      [
        isOn
          ? { entityId: entity.entity_id, domain: "climate", service: "turn_off" }
          : { entityId: entity.entity_id, domain: "climate", service: "turn_on" },
      ],
      onEntityActions,
      `Panel Heater ${isOn ? "off" : "on"}`,
    );

  return (
    <ClimateCard entity={entity} kicker="Heating Unit" title="Panel Heater">
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className={classNames("climate-toggle border", isOn && "climate-toggle-active")}
            role="switch"
            aria-checked={isOn}
            onClick={setPower}
          >
            <Power className="h-6 w-6" />
            <span>{isOn ? "On" : "Off"}</span>
          </button>
          <LabeledSwitch
            checked={false}
            disabled
            label="Panel heater single or double panel mode unavailable"
            leftLabel="I Slow"
            rightLabel="II Fast"
            onChange={() => undefined}
          />
        </div>

        <TemperatureStepper entity={entity} label="Temperature" step={0.5} onChange={setTemperature} />
      </div>
    </ClimateCard>
  );
}

const AIRCON_MODES = [
  { label: "Heating", mode: "heat", Icon: Flame },
  { label: "Cooling", mode: "cool", Icon: Snowflake },
  { label: "Fan", mode: "fan_only", Icon: Fan },
] as const;

const AIRCON_FAN_STEPS = ["quiet", "low", "medium low", "medium", "medium high", "high", "turbo"] as const;

type AirconFanStep = (typeof AIRCON_FAN_STEPS)[number];

function airconFanStep(entity: DashboardEntity, quietSwitch?: DashboardEntity, turboSwitch?: DashboardEntity): AirconFanStep {
  if (quietSwitch?.state === "on") {
    return "quiet";
  }
  if (turboSwitch?.state === "on") {
    return "turbo";
  }

  const mode = String(entity.attributes.fan_mode ?? "").toLowerCase();
  return AIRCON_FAN_STEPS.includes(mode as AirconFanStep) && mode !== "quiet" && mode !== "turbo"
    ? (mode as AirconFanStep)
    : "medium";
}

function AirConditionerControl({
  entity,
  preferences,
  quietSwitch,
  turboSwitch,
  onEntityActions,
}: {
  entity?: DashboardEntity;
  preferences?: AirconPreferences;
  quietSwitch?: DashboardEntity;
  turboSwitch?: DashboardEntity;
  onEntityActions: (actions: EntityActionInput[], toast: string) => Promise<void>;
}) {
  const currentFanIndex = entity ? AIRCON_FAN_STEPS.indexOf(airconFanStep(entity, quietSwitch, turboSwitch)) : 0;
  const fanPadRef = useRef<HTMLDivElement | null>(null);
  const fanCommitRef = useRef(currentFanIndex);
  const fanDraggingRef = useRef(false);
  const [fanDotCount, setFanDotCount] = useState(2);
  const [fanInteracting, setFanInteracting] = useState(false);
  const [fanLineWidth, setFanLineWidth] = useState(0);
  const {
    displayValue: fanDisplayValue,
    releaseLocalValue: releaseLocalFanValue,
    setLocalValue: setLocalFanValue,
  } = useRemoteEasedNumber(currentFanIndex);

  useEffect(() => {
    fanCommitRef.current = currentFanIndex;
  }, [currentFanIndex]);

  useEffect(() => {
    const pad = fanPadRef.current;
    if (!pad) {
      return;
    }

    const rebuild = () => {
      const rect = pad.getBoundingClientRect();
      setFanLineWidth(rect.width);
      setFanDotCount(Math.max(2, Math.round(rect.width / SPECTRUM_DOT_GAP_PX) + 1));
    };

    rebuild();
    const observer = new ResizeObserver(rebuild);
    observer.observe(pad);
    window.addEventListener("orientationchange", rebuild);

    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", rebuild);
    };
  }, [entity?.entity_id]);

  if (!entity) {
    return <ClimateCard kicker="Air Control" title="Air Conditioner" />;
  }

  const isOn = isClimateEntityOn(entity);
  const supportedModes = stringListAttribute(entity, "hvac_modes");
  const swingMode = String(entity.attributes.swing_mode ?? "off").toLowerCase();
  const sweepOn = swingMode === "both";

  const airconSettings = {
    hvacMode:
      preferences?.hvacMode ??
      (isOn && entity.state !== "off" && entity.state !== "unavailable" && entity.state !== "unknown" ? entity.state : undefined),
    temperature: preferences?.temperature ?? climateTargetTemperature(entity) ?? undefined,
    fanMode: preferences?.fanMode ?? String(entity.attributes.fan_mode ?? "medium"),
    quietMode: preferences?.quietMode ?? quietSwitch?.state === "on",
    turboMode: preferences?.turboMode ?? turboSwitch?.state === "on",
    swingMode: preferences?.swingMode ?? (sweepOn ? "both" : "off"),
  } satisfies AirconPreferences;

  const setPower = () => {
    const actions: EntityActionInput[] = [];

    if (isOn) {
      actions.push({ entityId: entity.entity_id, domain: "climate", service: "turn_off" });
    } else {
      actions.push({ entityId: entity.entity_id, domain: "climate", service: "turn_on" });
      if (airconSettings.hvacMode && supportedModes.includes(airconSettings.hvacMode)) {
        actions.push({
          entityId: entity.entity_id,
          domain: "climate",
          service: "set_hvac_mode",
          data: { hvac_mode: airconSettings.hvacMode },
        });
      }
      if (typeof airconSettings.temperature === "number") {
        actions.push({
          entityId: entity.entity_id,
          domain: "climate",
          service: "set_temperature",
          data: { temperature: airconSettings.temperature },
        });
      }
      if (quietSwitch && typeof airconSettings.quietMode === "boolean") {
        actions.push({
          entityId: quietSwitch.entity_id,
          domain: "switch",
          service: airconSettings.quietMode ? "turn_on" : "turn_off",
        });
      }
      if (turboSwitch && typeof airconSettings.turboMode === "boolean") {
        actions.push({
          entityId: turboSwitch.entity_id,
          domain: "switch",
          service: airconSettings.turboMode ? "turn_on" : "turn_off",
        });
      }
      if (airconSettings.fanMode) {
        actions.push({
          entityId: entity.entity_id,
          domain: "climate",
          service: "set_fan_mode",
          data: { fan_mode: airconSettings.fanMode },
        });
      }
      if (airconSettings.swingMode) {
        actions.push({
          entityId: entity.entity_id,
          domain: "climate",
          service: "set_aircon_sweep",
          data: { enabled: airconSettings.swingMode === "both" },
        });
      }
    }

    return callClimateActions(actions, onEntityActions, `Air Conditioner ${isOn ? "off" : "on"}`);
  };

  const setMode = (mode: string, label: string) =>
    callClimateActions(
      [
        {
          entityId: entity.entity_id,
          domain: "climate",
          service: "set_hvac_mode",
          data: { hvac_mode: mode },
          remember: { aircon: { hvacMode: mode } },
        },
      ],
      onEntityActions,
      `Air Conditioner ${label}`,
    );

  const setTemperature = (temperature: number) =>
    callClimateActions(
      [
        {
          entityId: entity.entity_id,
          domain: "climate",
          service: "set_temperature",
          data: { temperature },
          remember: { aircon: { temperature } },
        },
      ],
      onEntityActions,
      `Air Conditioner ${temperature} degrees`,
    );

  const setSweep = () =>
    callClimateActions(
      [
        {
          entityId: entity.entity_id,
          domain: "climate",
          service: "set_aircon_sweep",
          data: { enabled: !sweepOn },
          remember: { aircon: { swingMode: sweepOn ? "off" : "both" } },
        },
      ],
      onEntityActions,
      `Air Conditioner sweep ${sweepOn ? "off" : "on"}`,
    );

  const setFanStep = (step: AirconFanStep) => {
    const actions: EntityActionInput[] = [];

    if (quietSwitch) {
      actions.push({
        entityId: quietSwitch.entity_id,
        domain: "switch",
        service: step === "quiet" ? "turn_on" : "turn_off",
      });
    }
    if (turboSwitch) {
      actions.push({
        entityId: turboSwitch.entity_id,
        domain: "switch",
        service: step === "turbo" ? "turn_on" : "turn_off",
      });
    }

    actions.push({
      entityId: entity.entity_id,
      domain: "climate",
      service: "set_fan_mode",
      data: { fan_mode: step === "quiet" ? "low" : step === "turbo" ? "high" : step },
      remember: {
        aircon: {
          fanMode: step === "quiet" ? "low" : step === "turbo" ? "high" : step,
          quietMode: step === "quiet",
          turboMode: step === "turbo",
        },
      },
    });

    return callClimateActions(actions, onEntityActions, `Air Conditioner fan ${step}`);
  };

  const setFanIndexValue = (value: number) => {
    const next = clamp(Math.round(value), 0, AIRCON_FAN_STEPS.length - 1);
    fanCommitRef.current = next;
    setLocalFanValue(next);
  };
  const pickFanIndex = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!fanPadRef.current) {
      return;
    }

    const rect = fanPadRef.current.getBoundingClientRect();
    setFanIndexValue(((event.clientX - rect.left) / rect.width) * (AIRCON_FAN_STEPS.length - 1));
  };
  const commitFanIndex = () => {
    if (!fanDraggingRef.current) {
      return;
    }
    fanDraggingRef.current = false;
    setFanInteracting(false);
    const next = fanCommitRef.current;
    releaseLocalFanValue(next);
    void setFanStep(AIRCON_FAN_STEPS[next] ?? "medium");
  };
  const keyFanIndex = (event: React.KeyboardEvent<HTMLDivElement>, next: number) => {
    event.preventDefault();
    const value = clamp(Math.round(next), 0, AIRCON_FAN_STEPS.length - 1);
    setFanIndexValue(value);
    releaseLocalFanValue(value);
    void setFanStep(AIRCON_FAN_STEPS[value] ?? "medium");
  };

  const displayedFanIndex = clamp(fanDisplayValue, 0, AIRCON_FAN_STEPS.length - 1);
  const displayedFanStep = AIRCON_FAN_STEPS[Math.round(displayedFanIndex)] ?? "medium";
  const fanDisplayPercent = displayedFanIndex / (AIRCON_FAN_STEPS.length - 1);
  const fanDisplayCursorX = insetPixel(fanDisplayPercent, fanLineWidth, LINE_CURSOR_INSET_PX);
  const fanDotColor = fanInteracting ? HIGHLIGHT_DOT_RGB : ACCENT_DOT_RGB;
  const fanDots = Array.from({ length: fanDotCount }, (_, index) => {
    const amount = fanDotCount <= 1 ? 0 : index / (fanDotCount - 1);
    return {
      id: index,
      amount,
      opacity: amount * 0.96,
      rgb: fanDotColor,
      xPx: amount * fanLineWidth,
    };
  });

  return (
    <ClimateCard entity={entity} kicker="Air Control" title="Air Conditioner">
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className={classNames("climate-toggle border", isOn && "climate-toggle-active")}
            role="switch"
            aria-checked={isOn}
            onClick={setPower}
          >
            <Power className="h-6 w-6" />
            <span>{isOn ? "On" : "Off"}</span>
          </button>
          <LabeledSwitch
            checked={sweepOn}
            icon={<Waves className="h-4 w-4" />}
            label="Air conditioner sweep"
            leftLabel="Fixed"
            rightLabel="Sweep"
            onChange={setSweep}
          />
        </div>

        <div className="climate-mode-grid grid grid-cols-3 gap-3">
          {AIRCON_MODES.map(({ Icon, label, mode }) => {
            const active = entity.state === mode;
            return (
              <button
                key={mode}
                type="button"
                className={classNames("climate-mode-button border", active && "climate-mode-button-active")}
                disabled={supportedModes.length > 0 && !supportedModes.includes(mode)}
                onClick={() => setMode(mode, label)}
              >
                <Icon className="h-6 w-6" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <TemperatureStepper entity={entity} label="Temperature" step={1} onChange={setTemperature} />

        <div className="climate-fan-speed border border-neutral-700 bg-neutral-950/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-black uppercase text-cyan-300">Fan Speed</p>
            <p className="font-mono text-sm font-black uppercase text-neutral-100">{displayedFanStep}</p>
          </div>
          <div
            ref={fanPadRef}
            role="slider"
            aria-label="Air conditioner fan speed"
            aria-valuemin={0}
            aria-valuemax={AIRCON_FAN_STEPS.length - 1}
            aria-valuenow={Math.round(displayedFanIndex)}
            aria-valuetext={displayedFanStep}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                keyFanIndex(event, fanCommitRef.current - 1);
              } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                keyFanIndex(event, fanCommitRef.current + 1);
              } else if (event.key === "Home") {
                keyFanIndex(event, 0);
              } else if (event.key === "End") {
                keyFanIndex(event, AIRCON_FAN_STEPS.length - 1);
              }
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              fanDraggingRef.current = true;
              setFanInteracting(true);
              pickFanIndex(event);
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1) {
                pickFanIndex(event);
              }
            }}
            onPointerUp={commitFanIndex}
            onPointerCancel={commitFanIndex}
            onLostPointerCapture={commitFanIndex}
            className="intensity-dot-pad relative h-12 w-full touch-none overflow-hidden outline-none"
          >
            <svg
              className="dot-line-svg pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${Math.max(fanLineWidth, 1)} ${SVG_LINE_HEIGHT_PX}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {fanDots.map((dot) => {
                const size = focusedLineDotSize(dot.xPx, fanDisplayPercent, fanLineWidth, fanDisplayCursorX);

                return (
                  <circle
                    key={dot.id}
                    className="dot-line-svg-dot"
                    cx={dot.xPx}
                    cy={SVG_LINE_CENTER_Y_PX}
                    r={svgSpectrumDotRadius(size)}
                    fill={`rgb(${dot.rgb.join(" ")})`}
                    opacity={dot.opacity}
                  />
                );
              })}
              <g
                className={classNames("dot-line-svg-cursor", fanInteracting && "dot-line-svg-cursor-active")}
                transform={`translate(${fanDisplayCursorX} ${SVG_LINE_CENTER_Y_PX}) rotate(-120)`}
              >
                <circle
                  cx={0}
                  cy={0}
                  r={SVG_LINE_CURSOR_RADIUS_PX}
                  strokeWidth={SVG_LINE_CURSOR_STROKE_PX}
                  strokeDasharray="17.3 34.6"
                />
              </g>
            </svg>
          </div>
          <div className="dot-line-markers relative mt-2 h-4 text-xs font-black uppercase text-neutral-400">
            <span
              className={classNames("dot-line-marker", displayedFanStep === "quiet" && "dot-line-marker-active")}
              style={{ left: `${insetPercent(0, fanLineWidth, LINE_CURSOR_INSET_PX)}%` }}
            >
              Quiet
            </span>
            <span
              className={classNames("dot-line-marker", displayedFanStep === "turbo" && "dot-line-marker-active")}
              style={{ left: `${insetPercent(1, fanLineWidth, LINE_CURSOR_INSET_PX)}%` }}
            >
              Turbo
            </span>
          </div>
        </div>
      </div>
    </ClimateCard>
  );
}

function ClimateControls({
  onEntityActions,
  preferences,
  zone,
}: {
  onEntityActions: (actions: EntityActionInput[], toast: string) => Promise<void>;
  preferences?: DashboardPreferences;
  zone: DashboardZone;
}) {
  const climateEntities = zone.entities.filter((entity) => entity.domain === "climate");
  const heater =
    climateEntities.find((entity) => matchesEntity(entity, ["panel", "heater"])) ??
    climateEntities.find((entity) => entity.entity_id.includes("panel_heater"));
  const aircon =
    climateEntities.find((entity) => matchesEntity(entity, ["air conditioner", "air con", "c6780cad"])) ??
    climateEntities.find((entity) => entity.entity_id !== heater?.entity_id);
  const switches = zone.entities.filter((entity) => entity.domain === "switch");
  const quietSwitch = switches.find((entity) => matchesEntity(entity, ["quiet"]));
  const turboSwitch = switches.find((entity) => matchesEntity(entity, ["xtra", "turbo"]));

  return (
    <div className="climate-control-grid grid gap-5">
      <AirConditionerControl
        entity={aircon}
        preferences={preferences?.aircon}
        quietSwitch={quietSwitch}
        turboSwitch={turboSwitch}
        onEntityActions={onEntityActions}
      />
      <PanelHeaterControl entity={heater} onEntityActions={onEntityActions} />
    </div>
  );
}

function formatWeatherNumber(value: number | null, digits = 0) {
  if (value === null) {
    return "--";
  }

  return value.toFixed(digits);
}

function weatherLabel(condition: string) {
  return condition.replaceAll("_", " ");
}

function OutsideControls({
  onEntityActions,
  weather,
  zone,
}: {
  onEntityActions: (actions: EntityActionInput[], toast: string) => Promise<void>;
  weather: WeatherStatus | null;
  zone: DashboardZone;
}) {
  const outsideLight =
    zone.entities.find((entity) => entity.domain === "light") ?? zone.entities.find((entity) => entity.isIllumination);
  const isOn = outsideLight ? outsideLight.state === "on" : false;
  const unavailable = outsideLight ? ["unknown", "unavailable"].includes(outsideLight.state) : true;

  const setPower = () => {
    if (!outsideLight) {
      return;
    }

    void onEntityActions(
      [
        {
          entityId: outsideLight.entity_id,
          domain: outsideLight.domain,
          service: isOn ? "turn_off" : "turn_on",
        },
      ],
      `Outside light ${isOn ? "off" : "on"}`,
    );
  };

  return (
    <div className="outside-control-grid grid gap-5">
      <section className="outside-light-card border border-neutral-700 bg-neutral-950/70 p-5">
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase text-cyan-300">Exterior Circuit</p>
            <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">Outside Light</h2>
          </div>
          <div className="border border-cyan-300/50 px-3 py-2 text-xs font-black uppercase text-cyan-200">
            {outsideLight?.state ?? "missing"}
          </div>
        </header>

        <LabeledSwitch
          checked={isOn}
          disabled={unavailable}
          icon={<Power className="h-4 w-4" />}
          label="Outside light power"
          leftLabel="Off"
          rightLabel="On"
          onChange={setPower}
        />
      </section>

      <WeatherPanel weather={weather} />
    </div>
  );
}

function WeatherPanel({ weather }: { weather: WeatherStatus | null }) {
  if (!weather) {
    return (
      <section className="weather-panel border border-neutral-700 bg-neutral-950/70 p-5">
        <p className="text-sm font-black uppercase text-cyan-300">Weather Feed</p>
        <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">Unavailable</h2>
      </section>
    );
  }

  return (
    <section className="weather-panel border border-neutral-700 bg-neutral-950/70 p-5">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase text-cyan-300">Weather Feed</p>
          <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">{weatherLabel(weather.condition)}</h2>
        </div>
        <div className="text-right">
          <p className="text-sm font-black uppercase text-neutral-400">Feels Like</p>
          <p className="font-mono text-3xl font-black tabular-nums text-neutral-50">
            {formatWeatherNumber(weather.feelsLike, 1)}
            <span className="text-lg">&deg;</span>
          </p>
        </div>
      </header>

      <div className="weather-metric-grid grid gap-3">
        <WeatherMetric label="Now" value={`${formatWeatherNumber(weather.temperature, 1)} C`} />
        <WeatherMetric
          label="Min / Max"
          value={`${formatWeatherNumber(weather.low, 0)} / ${formatWeatherNumber(weather.high, 0)} C`}
        />
        <WeatherMetric label="Rain" value={formatWeatherNumber(weather.rainChancePct, 0)} suffix="%" />
        <WeatherMetric
          label="UV"
          value={`${formatWeatherNumber(weather.uvIndex, 1)} / ${formatWeatherNumber(weather.maxUvIndex, 1)}`}
        />
        <WeatherMetric
          label="Wind"
          value={formatWeatherNumber(weather.windSpeed, 0)}
          suffix={weather.windUnit || "km/h"}
        />
        <WeatherMetric label="Humidity" value={formatWeatherNumber(weather.humidity, 0)} suffix="%" />
      </div>
    </section>
  );
}

function WeatherMetric({ label, suffix, value }: { label: string; suffix?: string; value: string }) {
  return (
    <div className="weather-metric border border-neutral-700 bg-neutral-950/70 p-4">
      <p className="text-xs font-black uppercase text-neutral-400">{label}</p>
      <p className="mt-2 font-mono text-2xl font-black uppercase tabular-nums text-neutral-50">
        {value}
        {suffix ? <span className="ml-1 text-sm text-neutral-400">{suffix}</span> : null}
      </p>
    </div>
  );
}

function ZoneControls({
  zone,
  onEntityActions,
  onZoneAction,
  preferences,
  router,
  spectrumCursor,
  weather,
}: {
  zone: DashboardZone;
  onEntityActions: (actions: EntityActionInput[], toast: string) => Promise<void>;
  onZoneAction: (action: string, body?: Record<string, unknown>) => Promise<void>;
  preferences?: DashboardPreferences;
  router?: RouterStatus;
  spectrumCursor?: SpectrumCursor;
  weather?: WeatherStatus | null;
}) {
  const [brightness, setBrightness] = useState(zone.brightnessPct);
  const [spectrum, setSpectrum] = useState<SpectrumValue>(
    () => spectrumWithCursor(spectrumFromZone(zone), spectrumCursor) ?? CANDLELIGHT_SPECTRUM,
  );
  const spectrumByZone = useRef<Record<string, SpectrumValue>>({});
  const userSpectrumAtByZone = useRef<Record<string, number>>({});
  const lastZoneId = useRef<string | null>(null);
  const climateZone = isClimateZone(zone);
  const outsideZone = isOutsideZone(zone);
  const networkZone = isNetworkZone(zone);
  const lightingZone = !climateZone && !outsideZone && !networkZone;
  const lightEntities = useMemo(
    () => (lightingZone ? zone.entities.filter((entity) => entity.domain === "light") : []),
    [lightingZone, zone.entities],
  );
  const hasLightDevices = lightEntities.length > 0;
  const hasActiveLights = lightEntities.some(dashboardEntityIsOn);
  const statDomains = countDomainsForZone(zone);

  useEffect(() => {
    setBrightness(zone.brightnessPct);
  }, [zone.id, zone.brightnessPct]);

  useEffect(() => {
    const zoneChanged = lastZoneId.current !== zone.id;
    const haSpectrum = spectrumWithCursor(spectrumFromZone(zone), spectrumCursor);
    const recentlyTouched =
      !zoneChanged && Date.now() - (userSpectrumAtByZone.current[zone.id] ?? 0) < SPECTRUM_LOCAL_HOLD_MS;

    lastZoneId.current = zone.id;

    if (haSpectrum && !recentlyTouched) {
      spectrumByZone.current[zone.id] = haSpectrum;
      setSpectrum(haSpectrum);
      return;
    }

    if (zoneChanged) {
      setSpectrum(haSpectrum ?? spectrumByZone.current[zone.id] ?? CANDLELIGHT_SPECTRUM);
    }
  }, [spectrumCursor?.x, spectrumCursor?.y, zone]);

  const rememberSpectrum = useCallback(
    (value: SpectrumValue) => {
      userSpectrumAtByZone.current[zone.id] = Date.now();
      spectrumByZone.current[zone.id] = value;
      setSpectrum(value);
    },
    [zone.id],
  );

  const applyPresetAction = useCallback(
    (action: "on" | "candlelight" | "white") => {
      const nextSpectrum = action === "white" ? WHITE_SPECTRUM : CANDLELIGHT_SPECTRUM;
      const nextBrightness = action === "white" ? 100 : 86;
      setBrightness(nextBrightness);
      rememberSpectrum(nextSpectrum);
      onZoneAction(action, { brightnessPct: nextBrightness, cursor: nextSpectrum.cursor });
    },
    [onZoneAction, rememberSpectrum],
  );

  return (
    <section className="zone-panel relative min-h-[620px] border border-neutral-700 bg-neutral-950/70 p-5 shadow-2xl">
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase text-cyan-300">Zone Control</p>
          <h1 className="mt-1 text-4xl font-black uppercase text-neutral-50 sm:text-5xl">{zone.name}</h1>
          <div className="zone-stats mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {statDomains.map((domain) => (
              <StatChip key={domain} domain={domain} count={zone.counts[domain]} />
            ))}
          </div>
        </div>
        {lightingZone ? (
          <div className="zone-actions grid grid-cols-4 gap-3">
            <IconButton label="On: candlelight" disabled={!hasLightDevices} variant="yellow" onClick={() => applyPresetAction("on")}>
              <Power className="h-7 w-7" />
            </IconButton>
            <IconButton label="Off" disabled={!hasLightDevices && zone.counts.switch === 0} variant="pink" onClick={() => onZoneAction("off")}>
              <PowerOff className="h-7 w-7" />
            </IconButton>
            <IconButton
              label="Candlelight"
              disabled={!hasLightDevices}
              variant="yellow"
              onClick={() => applyPresetAction("candlelight")}
            >
              <Flame className="h-7 w-7" />
            </IconButton>
            <IconButton
              label="White"
              disabled={!hasLightDevices}
              variant="white"
              onClick={() => applyPresetAction("white")}
            >
              <Sun className="h-7 w-7" />
            </IconButton>
          </div>
        ) : null}
      </header>

      <div className="mt-8 grid gap-5">
        <div className="lighting-column grid gap-5">
          {networkZone ? (
            router ? <RouterPanel router={router} /> : null
          ) : climateZone ? (
            <ClimateControls zone={zone} preferences={preferences} onEntityActions={onEntityActions} />
          ) : outsideZone ? (
            <OutsideControls zone={zone} weather={weather ?? null} onEntityActions={onEntityActions} />
          ) : (
            <>
              <SpectrumPad
                disabled={!hasActiveLights}
                brightness={brightness}
                value={spectrum}
                onValueChange={rememberSpectrum}
                onPick={(rgb, cursor) => onZoneAction("color", { rgb, brightnessPct: brightness || 100, cursor })}
              />

              <IntensityControl
                brightness={brightness}
                color={spectrum.preview}
                disabled={!hasLightDevices}
                onBrightnessChange={setBrightness}
                onBrightnessCommit={(value) => onZoneAction("brightness", { brightnessPct: value })}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function RouterPanel({ router: initialRouter }: { router: RouterStatus }) {
  const [router, setRouter] = useState(initialRouter);
  const polling = useRef(false);

  useEffect(() => {
    setRouter(initialRouter);
  }, [initialRouter]);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      if (polling.current || document.hidden) {
        return;
      }

      polling.current = true;
      try {
        const response = await fetch("/api/router", { cache: "no-store" });
        const payload = await response.json();
        if (alive && response.ok) {
          setRouter(payload as RouterStatus);
        }
      } catch {
        // Keep the last known router reading if a single fast poll misses.
      } finally {
        polling.current = false;
      }
    };

    void load();
    const timer = window.setInterval(load, 333);
    const refreshVisibleState = () => {
      if (!document.hidden) {
        void load();
      }
    };

    window.addEventListener("focus", refreshVisibleState);
    window.addEventListener("online", refreshVisibleState);
    window.addEventListener("pageshow", refreshVisibleState);
    document.addEventListener("visibilitychange", refreshVisibleState);

    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisibleState);
      window.removeEventListener("online", refreshVisibleState);
      window.removeEventListener("pageshow", refreshVisibleState);
      document.removeEventListener("visibilitychange", refreshVisibleState);
    };
  }, []);

  const download = router.download.value ?? 0;
  const upload = router.upload.value ?? 0;
  const scaleMax = Math.max(0.25, Math.ceil(Math.max(download, upload) * 4) / 4);
  const downloadPct = clamp((download / scaleMax) * 100, 0, 100);
  const uploadPct = clamp((upload / scaleMax) * 100, 0, 100);
  const gaugeDeg = (downloadPct / 100) * 180;

  return (
    <section className="router-panel border border-neutral-700 bg-neutral-950/70 p-5">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase text-cyan-300">Network Interface</p>
          <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">{router.name}</h2>
        </div>
        <div className="border border-cyan-300/50 px-3 py-2 text-xs font-black uppercase text-cyan-200">
          WAN {router.wanState}
        </div>
      </header>

      <div className="router-grid grid gap-4">
        <div className="router-gauge-card border border-neutral-700 bg-neutral-950/70 p-5">
          <div
            className="router-gauge mx-auto"
            style={{ "--router-gauge-deg": `${gaugeDeg}deg` } as React.CSSProperties}
          >
            <div className="router-gauge-readout">
              <p className="text-5xl font-black tabular-nums text-neutral-50">{router.download.display}</p>
              <p className="mt-2 text-base font-black uppercase text-neutral-100">Download speed</p>
            </div>
          </div>
        </div>

        <div className="router-throughput-card border border-neutral-700 bg-neutral-950/70 p-5">
          <div className="router-throughput-track">
            <span className="router-throughput-down" style={{ width: `${downloadPct}%` }} />
            <span className="router-throughput-up" style={{ width: `${uploadPct}%` }} />
          </div>
          <div className="mt-4 grid gap-2">
            <div className="flex min-w-0 items-center gap-2 text-xs font-black text-neutral-100">
              <span className="h-3 w-3 shrink-0 bg-cyan-300" />
              <span className="truncate">Download</span>
              <span className="ml-auto shrink-0 tabular-nums text-neutral-400">{router.download.display}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2 text-xs font-black text-neutral-100">
              <span className="h-3 w-3 shrink-0 bg-yellow-300" />
              <span className="truncate">Upload</span>
              <span className="ml-auto shrink-0 tabular-nums text-neutral-400">{router.upload.display}</span>
            </div>
          </div>
        </div>

        <div className="router-status-card router-wan-card border border-neutral-700 bg-neutral-950/70 p-5">
          <p className="text-sm font-black uppercase text-cyan-300">WAN Status</p>
          <div className="mt-2 flex items-center gap-3">
            <span
              className={classNames(
                "h-4 w-4 border",
                router.wanConnected ? "border-emerald-300 bg-emerald-300" : "border-red-400 bg-red-400",
              )}
            />
            <p className="text-2xl font-black uppercase text-neutral-50">{router.wanState}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ClockPanel() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const update = () => setNow(new Date());

    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const clock = useMemo(() => {
    if (!now) {
      return {
        time: "--:--:--",
        date: "Syncing time",
        zone: "Auckland",
      };
    }

    return {
      time: new Intl.DateTimeFormat("en-NZ", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZone: CLOCK_TIME_ZONE,
      }).format(now),
      date: new Intl.DateTimeFormat("en-NZ", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        timeZone: CLOCK_TIME_ZONE,
      }).format(now),
      zone: "Auckland",
    };
  }, [now]);

  return (
    <section className="clock-panel border border-neutral-700 bg-neutral-950/70 p-5">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase text-cyan-300">System Time</p>
          <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">Nova</h2>
        </div>
        <div className="border border-cyan-300/50 px-3 py-2 text-xs font-black uppercase text-cyan-200">
          {clock.zone}
        </div>
      </header>

      <div className="clock-face border border-neutral-700 bg-neutral-950/70 p-5" aria-live="polite">
        <p className="clock-time font-black tabular-nums text-neutral-50">{clock.time}</p>
        <p className="clock-date mt-2 font-black uppercase text-neutral-100">{clock.date}</p>
      </div>
    </section>
  );
}

function isOutsideZone(zone: DashboardZone) {
  return zone.id === "outside" || zone.name.toLowerCase() === "outside";
}

function isClimateZone(zone: DashboardZone) {
  const name = zone.name.trim().toLowerCase();
  return zone.id === "climate" || zone.id === "heating" || name === "climate" || name === "heating";
}

function isNetworkZone(zone: DashboardZone) {
  return zone.id === "network" || zone.name.trim().toLowerCase() === "network";
}

function selectedZoneIdFromLocation() {
  if (typeof window === "undefined") {
    return "everything";
  }

  return new URLSearchParams(window.location.search).get("zone") ?? "everything";
}

function writeSelectedZoneToLocation(zoneId: string) {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("zone", zoneId);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function Dashboard() {
  useDeviceTheme();
  useBuildReload();

  const { data, error, pausePolling, refresh, setData } = useDashboardState();
  const [selectedZoneId, setSelectedZoneId] = useState(selectedZoneIdFromLocation);
  const [toast, setToast] = useState<string | null>(null);
  const entityActionSequence = useRef(0);
  const zoneActionSequence = useRef(0);
  const climatePollTimers = useRef<number[]>([]);
  const lightResumePollTimer = useRef<number | null>(null);

  const selectedZone = useMemo(() => {
    if (!data) {
      return null;
    }
    return data.zones.find((zone) => zone.id === selectedZoneId) ?? data.zones[0] ?? null;
  }, [data, selectedZoneId]);

  const zoneTree = useMemo(() => {
    const zones = data?.zones ?? [];
    const inside = zones.find((zone) => zone.id === "everything") ?? null;
    const climate = zones.find(isClimateZone) ?? null;
    const outside = zones.find(isOutsideZone) ?? null;

    return {
      inside,
      climate,
      indoor: zones.filter((zone) => zone.id !== inside?.id && zone.id !== climate?.id && zone.id !== outside?.id),
      outside,
    };
  }, [data]);

  useEffect(() => {
    if (data && !data.zones.some((zone) => zone.id === selectedZoneId)) {
      const fallbackZoneId = data.zones[0]?.id ?? "everything";
      setSelectedZoneId(fallbackZoneId);
      writeSelectedZoneToLocation(fallbackZoneId);
    }
  }, [data, selectedZoneId]);

  useEffect(() => {
    const syncSelectedZoneFromLocation = () => {
      setSelectedZoneId(selectedZoneIdFromLocation());
    };

    window.addEventListener("popstate", syncSelectedZoneFromLocation);
    window.addEventListener("pageshow", syncSelectedZoneFromLocation);

    return () => {
      window.removeEventListener("popstate", syncSelectedZoneFromLocation);
      window.removeEventListener("pageshow", syncSelectedZoneFromLocation);
    };
  }, []);

  const selectZone = useCallback((zoneId: string) => {
    setSelectedZoneId(zoneId);
    writeSelectedZoneToLocation(zoneId);
  }, []);

  useEffect(() => {
    writeSelectedZoneToLocation(selectedZoneId);
  }, [selectedZoneId]);

  useEffect(() => {
    return () => {
      climatePollTimers.current.forEach(window.clearTimeout);
      if (lightResumePollTimer.current !== null) {
        window.clearTimeout(lightResumePollTimer.current);
      }
    };
  }, []);

  const scheduleLightResumePoll = useCallback(() => {
    if (lightResumePollTimer.current !== null) {
      window.clearTimeout(lightResumePollTimer.current);
    }

    lightResumePollTimer.current = window.setTimeout(() => {
      lightResumePollTimer.current = null;
      void refresh().catch(() => undefined);
    }, LIGHT_COMMAND_POLL_HOLD_MS + 100);
  }, [refresh]);

  const scheduleClimateCommandPolls = useCallback(
    (sequence: number) => {
      climatePollTimers.current.forEach(window.clearTimeout);
      climatePollTimers.current = CLIMATE_COMMAND_POLL_DELAYS_MS.map((delay) =>
        window.setTimeout(async () => {
          try {
            const payload = await fetchDashboardStateSnapshot();
            if (sequence === entityActionSequence.current) {
              setData(payload);
            }
          } catch {
            // The regular dashboard poll will pick up the next readable state.
          }
        }, delay),
      );
    },
    [setData],
  );

  useEffect(() => {
    if (!selectedZone || !isClimateZone(selectedZone)) {
      return;
    }

    let alive = true;
    const load = () => {
      if (!alive || document.hidden) {
        return;
      }
      refresh().catch(() => undefined);
    };

    load();
    const timer = window.setInterval(load, 3000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refresh, selectedZone?.id]);

  const applyZoneAction = useCallback(
    async (action: string, body: Record<string, unknown> = {}) => {
      if (!selectedZone) {
        return;
      }

      const sequence = zoneActionSequence.current + 1;
      zoneActionSequence.current = sequence;
      const holdLightPolling = isLightZoneAction(action);

      if (holdLightPolling) {
        pausePolling(LIGHT_COMMAND_POLL_HOLD_MS);
        setData((current) =>
          current ? optimisticStateForZoneAction(current, selectedZone.id, action, body) : current,
        );
      }

      try {
        const response = await fetch("/api/zone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneId: selectedZone.id, action, ...body }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Zone action failed");
        }

        if (sequence !== zoneActionSequence.current) {
          return;
        }

        if (holdLightPolling) {
          pausePolling(LIGHT_COMMAND_POLL_HOLD_MS);
          scheduleLightResumePoll();
        } else {
          setData(payload);
        }

        setToast(`${selectedZone.name}: ${action}`);
      } catch (err) {
        if (sequence === zoneActionSequence.current) {
          setToast(err instanceof Error ? err.message : "Zone action failed");
          if (holdLightPolling) {
            void refresh({ force: true }).catch(() => undefined);
          }
        }
      }
    },
    [pausePolling, refresh, scheduleLightResumePoll, selectedZone, setData],
  );

  const applyEntityActions = useCallback(
    async (actions: EntityActionInput[], toastMessage: string) => {
      if (!actions.length) {
        return;
      }

      const sequence = entityActionSequence.current + 1;
      entityActionSequence.current = sequence;
      const holdLightPolling = entityActionsAffectLightPolling(actions, data);
      const hasClimateAction = actions.some((action) => action.domain === "climate");

      if (holdLightPolling) {
        pausePolling(LIGHT_COMMAND_POLL_HOLD_MS);
      }

      setData((current) => (current ? optimisticStateForEntityActions(current, actions) : current));

      try {
        let payload: DashboardState | null = null;

        for (const action of actions) {
          const response = await fetch("/api/entity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action),
          });
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body.error ?? "Entity action failed");
          }
          payload = body as DashboardState;
        }

        if (sequence !== entityActionSequence.current) {
          return;
        }

        if (holdLightPolling) {
          pausePolling(LIGHT_COMMAND_POLL_HOLD_MS);
          scheduleLightResumePoll();
        } else if (payload) {
          setData(payload);
        }

        if (hasClimateAction && !holdLightPolling) {
          scheduleClimateCommandPolls(sequence);
        }

        setToast(toastMessage);
      } catch (err) {
        if (sequence === entityActionSequence.current) {
          setToast(err instanceof Error ? err.message : "Entity action failed");
          void refresh({ force: true }).catch(() => undefined);
        }
      }
    },
    [data, pausePolling, refresh, scheduleClimateCommandPolls, scheduleLightResumePoll, setData],
  );

  const insideZone = zoneTree.inside;
  const climateZone = zoneTree.climate;
  const outsideZone = zoneTree.outside;

  return (
    <Tooltip.Provider delayDuration={250}>
      <main className="min-h-screen bg-neutral-950 text-neutral-100">
        <div className="dashboard-shell min-h-screen px-4 py-5 sm:px-6 lg:px-8">
          <header className="top-banner p-0">
            {data?.warnings.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {data?.warnings.map((warning) => (
                <span
                  key={warning}
                  className="border border-yellow-300/50 bg-yellow-300/10 px-3 py-2 text-xs font-black uppercase text-yellow-100"
                >
                  {warning}
                </span>
              ))}
            </div>
            ) : null}
          </header>

          {error ? (
            <div className="border border-red-400/60 bg-red-500/10 p-6 text-lg font-black uppercase text-red-100">
              {error}
            </div>
          ) : null}

          <div className="dashboard-layout grid gap-5 lg:grid-cols-[320px_1fr]">
            <ClockPanel />

            <aside className="zones-panel border border-neutral-700 bg-neutral-950/70 p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-black uppercase text-neutral-100">Zones</h2>
                <Zap className="h-5 w-5 text-yellow-300" />
              </div>
              <div className="grid gap-3">
                {insideZone ? (
                  <div className={classNames("zone-tree", zoneTree.indoor.length > 0 && "zone-parent-widget")}>
                    <ZoneButton
                      zone={insideZone}
                      selected={selectedZone?.id === insideZone.id}
                      onClick={() => selectZone(insideZone.id)}
                      hideCounts={zoneTree.indoor.length > 0}
                    />

                    {zoneTree.indoor.length ? (
                      <div className="zone-children mt-3 grid gap-3">
                        {zoneTree.indoor.map((zone) => (
                          <ZoneButton
                            key={zone.id}
                            zone={zone}
                            nested
                            selected={selectedZone?.id === zone.id}
                            onClick={() => selectZone(zone.id)}
                            routerStatus={data?.router}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  zoneTree.indoor.map((zone) => (
                    <ZoneButton
                      key={zone.id}
                      zone={zone}
                      selected={selectedZone?.id === zone.id}
                      onClick={() => selectZone(zone.id)}
                      routerStatus={data?.router}
                    />
                  ))
                )}

                {climateZone ? (
                  <ZoneButton
                    zone={climateZone}
                    selected={selectedZone?.id === climateZone.id}
                    onClick={() => selectZone(climateZone.id)}
                  />
                ) : null}

                {outsideZone ? (
                  <ZoneButton
                    zone={outsideZone}
                    selected={selectedZone?.id === outsideZone.id}
                    onClick={() => selectZone(outsideZone.id)}
                    domains={["light"]}
                  />
                ) : null}
              </div>
            </aside>

            <div className="control-stage grid gap-5">
              {selectedZone ? (
                <ZoneControls
                  zone={selectedZone}
                  onEntityActions={applyEntityActions}
                  onZoneAction={applyZoneAction}
                  preferences={data?.preferences}
                  router={data?.router}
                  spectrumCursor={data?.spectrumCursors?.[selectedZone.id]}
                  weather={data?.weather}
                />
              ) : (
                <div className="min-h-96 border border-neutral-700 bg-neutral-950/70 p-8 text-neutral-400">
                  Loading zone controls
                </div>
              )}
            </div>
          </div>

          <section className="dashboard-bottom-actions mt-5 border border-neutral-700 bg-neutral-950/70 p-3">
            <a className="dashboard-action-button" href="/config" aria-label="Configuration">
              <Settings className="h-6 w-6" />
            </a>
          </section>

          {toast ? (
            <div className="fixed bottom-5 right-5 max-w-sm border border-cyan-300/60 bg-neutral-950 px-4 py-3 text-sm font-black uppercase text-cyan-100 shadow-2xl">
              {toast}
            </div>
          ) : null}
        </div>
      </main>
    </Tooltip.Provider>
  );
}
