/**
 * While the tour is open, nothing under the mask can be pressed
 * (specs/tutorial-mode.md, "The mask"). A `window` capture-phase listener runs
 * before React's root listener and before every control's own, and stops
 * trusted presses aimed outside the tour. Touch scrolling and the wheel are
 * never touched.
 */

export type GuardStrength = "strict" | "scroll-friendly";

/** Events the strict guard stops. Never `wheel`, `touchmove` or `scroll`. */
export const STRICT_EVENTS = [
  "pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick",
  "touchstart", "touchend", "contextmenu", "keydown",
] as const;

/** On the demo these are stopped only when they land on a control. */
const PRESS_STARTS = new Set(["pointerdown", "mousedown", "touchstart"]);
/** On the demo these are always stopped. */
const ALWAYS_STOPPED = new Set(["click", "dblclick", "keydown", "contextmenu"]);

export const CONTROL_SELECTOR = [
  "button", "a[href]", "input", "select", "textarea", "[role=slider]", "[role=switch]",
  "[role=button]", ".rotary-encoder", ".nova-avatar-host",
].join(",");

/** Marks the tour's own elements, and the copy's portalled ring layer. */
export const TOUR_SELECTOR = "[data-tutorial-ui], [data-portal-tag='tutorial']";

type GuardEvent = Pick<Event, "type" | "isTrusted"> & { target: EventTarget | null };

function asElement(target: EventTarget | null): Element | null {
  if (!target || typeof (target as Node).nodeType !== "number") return null;
  const node = target as Node;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

/** The decision, separated from the listener so it is tested on its own. */
export function shouldBlock(event: GuardEvent, strength: GuardStrength): boolean {
  if (!event.isTrusted) return false;
  const element = asElement(event.target);
  if (element?.closest(TOUR_SELECTOR)) return false;
  if (strength === "strict") return (STRICT_EVENTS as readonly string[]).includes(event.type);
  if (ALWAYS_STOPPED.has(event.type)) return true;
  if (PRESS_STARTS.has(event.type)) return Boolean(element?.closest(CONTROL_SELECTOR));
  return false;
}

/** True for a tap that reached the dimmed area (the close box flashes). */
export function isMaskTap(event: GuardEvent): boolean {
  return event.isTrusted && event.type === "click" && !asElement(event.target)?.closest(TOUR_SELECTOR);
}

export function installInputGuard(
  strength: GuardStrength,
  onMaskTap: () => void,
  /** The tour's own keys (Back/Next/Esc), seen before anything is stopped. */
  onKey: (event: KeyboardEvent) => void,
): () => void {
  const listener = (event: Event) => {
    if (event.type === "keydown") onKey(event as KeyboardEvent);
    if (isMaskTap(event)) onMaskTap();
    if (!shouldBlock(event, strength)) return;
    event.stopImmediatePropagation();
    event.stopPropagation();
    // A stopped click must not follow a link or submit a form either; touch
    // events are left to scroll natively.
    if (event.type === "click" || event.type === "dblclick" || event.type === "keydown" || event.type === "contextmenu") {
      event.preventDefault();
    }
  };
  for (const type of STRICT_EVENTS) window.addEventListener(type, listener, { capture: true });
  return () => {
    for (const type of STRICT_EVENTS) window.removeEventListener(type, listener, { capture: true });
  };
}
