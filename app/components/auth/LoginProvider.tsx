"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { ModalOverlay } from "../ModalOverlay";
import { LoginPanel } from "./LoginPanel";

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
  const [open, setOpen] = useState(false);
  const pending = useRef<((granted: boolean) => void) | null>(null);

  const settle = useCallback((granted: boolean) => {
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
      >
        <LoginPanel compact onCancel={() => settle(false)} onSuccess={() => settle(true)} />
      </ModalOverlay>
    </LoginContext.Provider>
  );
}
