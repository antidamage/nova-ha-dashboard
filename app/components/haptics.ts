import { playControlSound } from "./dashboard/controlSound";

const BUTTON_HAPTIC_MS = 12;
const SLIDER_HAPTIC_MS = 9;
const SLIDER_MIN_INTERVAL_MS = 80;
const SLIDER_SLOW_DISTANCE = 0.05;
const SLIDER_FAST_DISTANCE = 0.008;
const SLIDER_SLOW_SPEED = 0.05;
const SLIDER_FAST_SPEED = 1.2;
const SLIDER_ROUND_VALUE_MAX_SPEED = 0.18;
const IOS_HAPTIC_INPUT_ID = "nova-ios-haptic-switch";

type NovaHapticStyle = "button" | "selection";

type HapticWindow = Window & {
  NovaHaptics?: {
    impact?: (style: "medium") => void;
    selectionChanged?: () => void;
  };
  webkit?: {
    messageHandlers?: {
      novaHaptics?: {
        postMessage: (message: { style: NovaHapticStyle }) => void;
      };
    };
  };
};

let iosHapticLabel: HTMLLabelElement | null = null;

function ensureIosHapticSwitch() {
  if (iosHapticLabel?.isConnected) return iosHapticLabel;
  if (typeof document === "undefined" || !document.body) return null;

  const input = document.createElement("input");
  input.id = IOS_HAPTIC_INPUT_ID;
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.setAttribute("aria-hidden", "true");
  input.setAttribute("data-nova-ios-haptic", "");
  input.tabIndex = -1;

  const label = document.createElement("label");
  label.htmlFor = IOS_HAPTIC_INPUT_ID;
  label.setAttribute("aria-hidden", "true");
  label.setAttribute("data-nova-ios-haptic", "");

  // Keep the genuine WebKit switch rendered but entirely outside interaction,
  // layout, focus, pointer hit-testing, and the accessibility tree.
  const hiddenStyle = "position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;opacity:0;pointer-events:none;overflow:hidden;";
  input.style.cssText = hiddenStyle;
  label.style.cssText = hiddenStyle;
  document.body.append(input, label);
  iosHapticLabel = label;
  return label;
}

function triggerIosSwitchHaptic() {
  const label = ensureIosHapticSwitch();
  if (!label) return false;
  label.click();
  return true;
}

/**
 * Best-effort tactile feedback. A native Nova WKWebView can register the
 * `novaHaptics` script message handler (or expose `NovaHaptics`) to drive
 * UIImpactFeedbackGenerator/UISelectionFeedbackGenerator on iOS. Browsers
 * with the Vibration API use a deliberately tiny pulse; unsupported browsers
 * remain silent.
 */
export function triggerHaptic(style: NovaHapticStyle) {
  if (typeof window === "undefined") return false;

  const hapticWindow = window as HapticWindow;
  try {
    const handler = hapticWindow.webkit?.messageHandlers?.novaHaptics;
    if (handler) {
      handler.postMessage({ style });
      return true;
    }

    if (style === "selection" && hapticWindow.NovaHaptics?.selectionChanged) {
      hapticWindow.NovaHaptics.selectionChanged();
      return true;
    }
    if (style === "button" && hapticWindow.NovaHaptics?.impact) {
      hapticWindow.NovaHaptics.impact("medium");
      return true;
    }

    if (typeof navigator.vibrate === "function") {
      const vibrated = navigator.vibrate(style === "button" ? BUTTON_HAPTIC_MS : SLIDER_HAPTIC_MS);
      if (vibrated) return true;
    }

    // Safari 18+ supplies a native Taptic tick for its switch control but no
    // Vibration API. Programmatically clicking the associated label works on
    // releases before WebKit began requiring a trusted switch event in 2026.
    return triggerIosSwitchHaptic();
  } catch {
    // Haptics are enhancement-only and must never interrupt an interaction.
  }

  return false;
}

export function buttonHaptic() {
  playControlSound();
  return triggerHaptic("button");
}

export function selectionHaptic() {
  playControlSound();
  return triggerHaptic("selection");
}

/**
 * Returns a human-readable 0/5 interval at the scale of a slider step.
 * Examples: 0.01 -> 0.05, 0.1 -> 0.5, 1 -> 5, 10 -> 10.
 */
export function roundHapticInterval(step: number) {
  const positiveStep = Math.abs(step);
  if (!Number.isFinite(positiveStep) || positiveStep <= 0) return null;
  const text = positiveStep.toString().toLowerCase();
  const [coefficient, exponentText] = text.split("e");
  const exponent = exponentText ? Number(exponentText) : 0;
  const coefficientDecimals = coefficient.split(".")[1]?.length ?? 0;
  const precision = Math.max(0, coefficientDecimals - exponent);
  const scale = 10 ** precision;
  const stepUnits = Math.max(1, Math.round(positiveStep * scale));
  const greatestCommonDivisor = (left: number, right: number): number => (
    right === 0 ? left : greatestCommonDivisor(right, left % right)
  );
  const intervalUnits = Math.abs(stepUnits * 5) / greatestCommonDivisor(stepUnits, 5);
  return intervalUnits / scale;
}

function crossedRoundBoundary(previous: number, current: number, interval: number) {
  if (current === previous) return false;
  const epsilon = interval * 1e-7;
  return current > previous
    ? Math.floor((current + epsilon) / interval) > Math.floor((previous + epsilon) / interval)
    : Math.ceil((current - epsilon) / interval) < Math.ceil((previous - epsilon) / interval);
}

type SliderHapticStart = {
  now?: number;
  step?: number;
  value?: number;
};

type SliderHapticMove = {
  now?: number;
  value?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Converts slider travel into a bounded tactile cadence. Slow numeric movement
 * ticks when it crosses a round 0/5 landmark at the control's step scale;
 * faster movement becomes distance-based, while an 80ms rate limit prevents a
 * vibration buzz. Callers pass effective travel, so Nova's vertical precision
 * drag naturally slows the cadence while fine tuning.
 */
export class SliderHapticController {
  private accumulatedDistance = 0;
  private lastMoveAt = 0;
  private lastPulseAt = 0;
  private lastValue: number | null = null;
  private roundInterval: number | null = null;

  start({ now = performance.now(), step, value }: SliderHapticStart = {}) {
    this.accumulatedDistance = 0;
    this.lastMoveAt = now;
    this.lastPulseAt = now;
    this.lastValue = typeof value === "number" && Number.isFinite(value) ? value : null;
    this.roundInterval = typeof step === "number" ? roundHapticInterval(step) : null;
    selectionHaptic();
  }

  move(normalizedDistance: number, { now = performance.now(), value }: SliderHapticMove = {}) {
    const distance = Math.abs(normalizedDistance);
    if (!Number.isFinite(distance) || distance <= 0) return false;

    const elapsedMs = Math.max(1, now - this.lastMoveAt);
    const speed = distance / (elapsedMs / 1000);
    const previousValue = this.lastValue;
    const currentValue = typeof value === "number" && Number.isFinite(value) ? value : null;
    this.lastValue = currentValue;
    this.lastMoveAt = now;

    // Fine movement feels most legible when its ticks correspond to memorable
    // displayed values rather than an arbitrary percentage of track travel.
    // Crossings are used instead of exact equality so sparse pointer samples do
    // not miss a 0/5 boundary.
    if (
      speed <= SLIDER_ROUND_VALUE_MAX_SPEED
      && previousValue !== null
      && currentValue !== null
      && this.roundInterval !== null
    ) {
      this.accumulatedDistance = 0;
      if (
        !crossedRoundBoundary(previousValue, currentValue, this.roundInterval)
        || now - this.lastPulseAt < SLIDER_MIN_INTERVAL_MS
      ) {
        return false;
      }
      this.lastPulseAt = now;
      selectionHaptic();
      return true;
    }

    const speedProgress = clamp(
      (speed - SLIDER_SLOW_SPEED) / (SLIDER_FAST_SPEED - SLIDER_SLOW_SPEED),
      0,
      1,
    );
    const pulseDistance = SLIDER_SLOW_DISTANCE
      + (SLIDER_FAST_DISTANCE - SLIDER_SLOW_DISTANCE) * speedProgress;

    this.accumulatedDistance = Math.min(
      this.accumulatedDistance + distance,
      pulseDistance * 2,
    );

    if (
      this.accumulatedDistance < pulseDistance
      || now - this.lastPulseAt < SLIDER_MIN_INTERVAL_MS
    ) {
      return false;
    }

    this.accumulatedDistance %= pulseDistance;
    this.lastPulseAt = now;
    selectionHaptic();
    return true;
  }

  stop() {
    this.accumulatedDistance = 0;
    this.lastValue = null;
    this.roundInterval = null;
  }
}
