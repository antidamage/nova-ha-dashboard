"use client";

/**
 * The Nova sign-in body: username and password on one screen, Use Passkey
 * beneath, Use Face beneath that.
 *
 * One component, rendered two ways — inside `LoginModal` over the dashboard,
 * and full-screen at `/login`. `specs/login-surface.md` owns the design.
 *
 * It drives authentik's own flow executor through the same-origin `/authentik/*`
 * proxy, so this is not a re-implementation of authentication: authentik still
 * decides everything, and the surface only renders the challenges and collects
 * the answers.
 */

/*
 * Facade. The body lives in auth/login-panel/ (specs/agent-token-footprint.md §3.3).
 *
 *   login-panel/constants.ts      Mode, the flow per mode, renderable stages
 *   login-panel/useLoginFlow.ts   all state; password, passkey and face steps
 *   login-panel/LoginPanel.tsx    the rendered surface
 *   login-panel/Shell.tsx         the striped card
 */
export { LoginPanel } from "./login-panel/LoginPanel";
