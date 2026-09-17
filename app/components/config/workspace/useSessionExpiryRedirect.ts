"use client";

import { useEffect } from "react";
import { fetchAuthState } from "../../auth/useAuthSession";

export function useSessionExpiryRedirect() {
  // Reaching this page at all required a valid session — Caddy's forward-auth
  // gate ran before Next.js ever served it. But the session can end while the
  // tab stays open (the quick/image profile's 15-minute idle sweep, or
  // authentik's own session lifetime), and nothing forces a fresh navigation
  // at that moment. Left alone, the person's next reload is a top-level hit on
  // the gate, which lands them on authentik's bare hosted login screen —
  // technically correct, but a jarring place to end up from a page that looks
  // like it's still open. Poll the same probe GatedLink uses (`/api/auth/
  // whoami`, which answers a bare 401 rather than a redirect, so it's safe to
  // call from a fetch) and leave for the front page the moment it says the
  // session is gone — before a later reload ever reaches the gate.
  useEffect(() => {
    let live = true;
    const checkSession = async () => {
      const state = await fetchAuthState();
      if (live && state.status === "anon") {
        window.location.href = "/";
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkSession();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void checkSession(), 60_000);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
