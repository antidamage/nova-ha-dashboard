"use client";

import { useCallback } from "react";
import { LoginPanel } from "../components/auth/LoginPanel";
import { safeNext } from "../../lib/authentik-flow";

/**
 * The standalone sign-in page.
 *
 * The same `LoginPanel` the modal renders, full screen. It exists so a link can
 * be sent, so a bookmark works, and so there is somewhere to land that is not a
 * modal over a dashboard the visitor may not have loaded.
 *
 * `?next=` is read here rather than in the panel because only this route has a
 * URL to read it from, and it is validated as a same-origin path before use —
 * an open redirect on a login page is the standard way to turn a themed sign-in
 * into a phishing primitive.
 *
 * See `specs/login-surface.md`.
 */
export default function LoginPage() {
  const onSuccess = useCallback((flowNext: string) => {
    // The flow's own `to` is usually "/". An explicit ?next= wins, because the
    // visitor was sent here from somewhere specific.
    const requested = typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("next");
    const target = safeNext(requested, safeNext(flowNext));
    // A full navigation, not a router push: the destination is usually behind
    // the forward-auth gate, and the outpost's silent OAuth round trip has to
    // happen at the network level rather than inside the client router.
    window.location.assign(target);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="system-confirm-card relative w-full max-w-sm px-5">
        <LoginPanel onSuccess={onSuccess} />
      </div>
    </main>
  );
}
