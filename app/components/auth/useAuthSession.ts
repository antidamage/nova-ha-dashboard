"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Whether anyone is signed in, from the dashboard's point of view.
 *
 * Three states, and they are genuinely different things:
 *
 *   - `authed`   — a session exists; `username` is set.
 *   - `anon`     — no session, and signing in from here is possible (401).
 *   - `no-login` — no session and no way to get one from this origin (403).
 *
 * The last one is not a variant of the second. Both LAN vhosts answer
 * `config_gate_denied`, a flat 403 with no login path, by design — offering a
 * sign-in there would be offering something that cannot succeed. The modal says
 * "use the HTTPS address" instead.
 *
 * See `specs/login-surface.md`.
 */
export type AuthState =
  | { status: "loading" }
  | { status: "authed"; username: string; email: string | null; groups: string[] }
  | { status: "anon" }
  | { status: "no-login" }
  | { status: "unknown" };

export const WHOAMI_PATH = "/api/auth/whoami";

export async function fetchAuthState(signal?: AbortSignal): Promise<AuthState> {
  let response: Response;
  try {
    response = await fetch(WHOAMI_PATH, { cache: "no-store", credentials: "same-origin", signal });
  } catch {
    // A network failure is not a signed-out user. Saying "anon" here would pop
    // a login modal every time the dashboard briefly loses its backend.
    return { status: "unknown" };
  }

  if (response.status === 401) return { status: "anon" };
  if (response.status === 403) return { status: "no-login" };
  if (!response.ok) return { status: "unknown" };

  try {
    const body = (await response.json()) as {
      authenticated?: boolean;
      username?: string | null;
      email?: string | null;
      groups?: string[];
    };
    if (body.authenticated && body.username) {
      return {
        status: "authed",
        username: body.username,
        email: body.email ?? null,
        groups: Array.isArray(body.groups) ? body.groups : [],
      };
    }
    // 200 with `authenticated: false` means the route was reached without the
    // gate having run — a LAN vhost or a local dev server. Not a session.
    return { status: "no-login" };
  } catch {
    return { status: "unknown" };
  }
}

export function useAuthSession(): { state: AuthState; refresh: () => void } {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void fetchAuthState(controller.signal).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  return { state, refresh };
}
