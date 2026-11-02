import { useEffect, useRef, useState, type RefObject } from "react";
import { OFF_SCREEN_GRACE_MS, ON_SCREEN_MARGIN_PX } from "./constants";

/**
 * Whether anyone could be looking at this element: it is within reach of the viewport
 * and the page is visible. Coming into view counts at once, and a margin wakes it just
 * before it is seen. Leaving waits out a grace period, so scrolling past does not
 * restart the streams. False until first measured, so nothing starts off-screen.
 */
export function useOnScreen(elementRef: RefObject<Element | null>): boolean {
  const [onScreen, setOnScreen] = useState(false);
  const inViewRef = useRef(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    let leaving = 0;
    const update = () => {
      window.clearTimeout(leaving);
      if (inViewRef.current && document.visibilityState === "visible") {
        setOnScreen(true);
      } else {
        leaving = window.setTimeout(() => setOnScreen(false), OFF_SCREEN_GRACE_MS);
      }
    };
    const observer = new IntersectionObserver((entries) => {
      inViewRef.current = entries[entries.length - 1].isIntersecting;
      update();
    }, { rootMargin: `${ON_SCREEN_MARGIN_PX}px` });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      window.clearTimeout(leaving);
    };
  }, [elementRef]);

  return onScreen;
}
