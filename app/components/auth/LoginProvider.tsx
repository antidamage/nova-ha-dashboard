"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { ModalOverlay } from "../ModalOverlay";
import { CAPTURE_PROFILES } from "../face/faceCapture";
import { LoginPanel } from "./LoginPanel";
import { useActivityHeartbeat } from "./useActivityHeartbeat";

/**
 * The login modal, mounted once for the whole app.
 *
 * Shaped after `ModuleHost`'s `askConfirm`/`settleConfirm` pair: one dialog,
 * driven by whichever caller is asking, resolving a promise so the caller can
 * simply `await requestLogin()` and act on the answer.
 *
 * `ModalOverlay` supplies the behaviour the brief asked for — a backdrop that
 * blocks the dashboard, tap-outside and Escape to dismiss, a focus trap, `inert`
 * on the background, and scroll lock. **Tapping outside resolves `false`**, so
 * dismissing the modal cancels whatever navigation or action asked for it,
 * rather than letting it proceed unauthenticated.
 *
 * See `specs/login-surface.md`.
 */

type LoginContextValue = {
  /** Resolves true when a session was obtained, false when dismissed. */
  requestLogin: () => Promise<boolean>;
};

const LoginContext = createContext<LoginContextValue | null>(null);

export function useLogin(): LoginContextValue {
  const value = useContext(LoginContext);
  // A no-op fallback rather than a throw: a component that asks for login on a
  // surface that has no provider (the stream inspector, a test harness) should
  // degrade to "not signed in", not crash the page.
  return value ?? { requestLogin: async () => false };
}

export function LoginProvider({ children }: { children: React.ReactNode }) {
  // Mounted once for the whole app, which is why the quick-session heartbeat
  // lives here: it has to run wherever the dashboard is being used, not only
  // while this modal is open.
  useActivityHeartbeat();
  const [open, setOpen] = useState(false);
  // True while a browser-owned prompt (the passkey picker) is on screen.
  const [nativePrompt, setNativePrompt] = useState(false);
  const pending = useRef<((granted: boolean) => void) | null>(null);

  const settle = useCallback((granted: boolean) => {
    setNativePrompt(false);
    setOpen(false);
    const resolve = pending.current;
    pending.current = null;
    resolve?.(granted);
  }, []);

  const requestLogin = useCallback(() => {
    // A second request while the modal is open joins the one already in flight
    // rather than opening a second dialog or orphaning the first promise.
    if (pending.current) {
      const existing = pending.current;
      return new Promise<boolean>((resolve) => {
        pending.current = (granted) => {
          existing(granted);
          resolve(granted);
        };
      });
    }
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
    });
  }, []);

  const value = useMemo(() => ({ requestLogin }), [requestLogin]);

  return (
    <LoginContext.Provider value={value}>
      {children}
      <ModalOverlay
        open={open}
        onClose={() => settle(false)}
        ariaLabel="Sign in"
        className="system-confirm-card"
        suspendFocusTrap={nativePrompt}
      >
        <LoginPanel
          compact
          // The modal is the config-page gate, and it captures for one second.
          // Adeline, 2026-09-09. The service runs no liveness and no anti-spoof
          // on this profile — a photograph gets in — and what bounds that is
          // the 15-minute idle timeout the release carries, not the capture.
          // The standalone /login page is where other sites land and stays
          // `standard`. See `specs/login-surface.md` § Capture profiles.
          capture={CAPTURE_PROFILES.quick}
          onCancel={() => settle(false)}
          onSuccess={() => settle(true)}
          onNativePrompt={setNativePrompt}
        />
      </ModalOverlay>
    </LoginContext.Provider>
  );
}
