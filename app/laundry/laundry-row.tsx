"use client";

import { useRouter } from "next/navigation";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

/**
 * One wash's row, as a link to that wash's own sheet (specs/power-meters.md §5.3).
 *
 * **The whole row is the target.** On a phone the row is what a finger goes for,
 * and a bare date inside six columns is a hit area the width of two words. What
 * is *not* a target is the claim field in the last cell: a tap that lands on a
 * control, or inside the date's own link, is left alone, so naming a wash never
 * opens its sheet by accident.
 *
 * The date still carries a real `<a>`, because a click handler on a table row is
 * nothing to a keyboard or to a screen reader — the link is what makes the row
 * reachable without a pointer, and the row's own click is the convenience on top
 * of it. A page whose rows navigate should also work with JavaScript off, and
 * that link is what does.
 *
 * A row is not a control, but it does act on a tap, so it carries
 * `data-tap-action`: `TouchClickGuard` suppresses the click a platform can
 * synthesize after a touch scroll gesture for an element marked that way, so a
 * finger that scrolls the bill and lifts over a row scrolls it rather than
 * opening the wash under the finger.
 */
export function WashRow({
  children,
  className,
  href,
  style,
}: {
  children: ReactNode;
  className: string;
  href: string;
  /** The claimer's colour, painted on the row (§5.3). */
  style: CSSProperties;
}) {
  const router = useRouter();

  const open = (event: MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest("a, button, input, label, option, select")) {
      return;
    }
    router.push(href);
  };

  return (
    <tr className={className} data-tap-action="true" onClick={open} style={style}>
      {children}
    </tr>
  );
}
