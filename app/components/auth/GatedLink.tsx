"use client";

import Link from "next/link";
import { useCallback } from "react";
import { fetchAuthState } from "./useAuthSession";
import { useLogin } from "./LoginProvider";

/**
 * A link to a forward-auth gated route that asks for a sign-in first.
 *
 * Without this, clicking Config while signed out is a navigation into Caddy's
 * 302 — the browser leaves the dashboard, lands on authentik, and comes back
 * only if the visitor completes the flow there. That works, and it stays the
 * documented fallback, but the modal is what Adeline asked for: the dashboard
 * stays on screen behind a blocking overlay, and dismissing it cancels the
 * navigation rather than stranding her somewhere else.
 *
 * The auth state is checked at click time, not held in state: a dashboard tab
 * can sit open for days, and a session read at mount says nothing about whether
 * one exists now.
 *
 * **`preventDefault` happens synchronously**, before the auth probe is awaited.
 * Calling it after an `await` is too late — the browser has already begun the
 * navigation by then — which is why this deliberately cancels first and
 * navigates itself afterwards rather than deciding and then cancelling.
 *
 * The navigation it performs is a full one rather than a router push, because
 * the destination is behind the forward-auth gate: the outpost's silent OAuth
 * round trip has to happen at the network level, and a client-side router fetch
 * would meet the same cross-origin 302 that reads as an opaque CORS error.
 *
 * On a LAN origin the probe answers 403 — there is no login path there at all —
 * and the modal says so, which beats the flat 403 page the navigation would
 * otherwise land on.
 *
 * See `specs/login-surface.md`.
 */
export function GatedLink({
  children,
  className,
  href,
  ...rest
}: React.ComponentProps<typeof Link> & { href: string }) {
  const { requestLogin } = useLogin();

  const decide = useCallback(async () => {
    if (process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true") {
      const base = (process.env.NEXT_PUBLIC_NOVA_DEMO_BASE_PATH ?? "").replace(/\/$/, "");
      window.location.assign(href.startsWith("/") ? `${base}${href}` : href);
      return;
    }
    const state = await fetchAuthState();
    if (state.status === "authed" || state.status === "unknown") {
      // Signed in, or the probe could not answer. A network blip must not
      // become a login prompt, so go where the link points.
      window.location.assign(href);
      return;
    }
    if (await requestLogin()) {
      window.location.assign(href);
    }
    // Dismissed: the navigation is cancelled, which is the point.
  }, [href, requestLogin]);

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Never swallow a modified click: ctrl/cmd/shift/middle means "new tab or
      // window", and that tab can handle its own redirect.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      void decide();
    },
    [decide],
  );

  return (
    <Link {...rest} href={href} prefetch={process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true" ? false : undefined} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
