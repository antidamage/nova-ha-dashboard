"use client";

import { KeyRound, Loader2, LogIn, ScanFace } from "lucide-react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { FACE_REASON_MESSAGES, DEFAULT_CAPTURE } from "../../face/faceCapture";
import { FacePreview } from "../../face/FacePreview";
import { fieldError, isTerminal } from "../../../../lib/authentik-flow";
import { RENDERABLE } from "./constants";
import { Shell } from "./Shell";
import type { LoginPanelProps } from "./types";
import { useLoginFlow } from "./useLoginFlow";

/** The Nova sign-in body. See ../LoginPanel.tsx and `specs/login-surface.md`. */
export function LoginPanel({
  onSuccess,
  onCancel,
  onNativePrompt,
  compact = false,
  capture: captureSpec = DEFAULT_CAPTURE,
}: LoginPanelProps) {
  const {
    mode, challenge, username, setUsername, password, setPassword, code, setCode, busy, error,
    errorCode, note, loginPossible, signInBaseUrl, capture, videoRef, secureContext,
    submitPassword, useThePasskey, useTheFace, backToPassword, startOver,
  } = useLoginFlow({ onSuccess, onNativePrompt, captureSpec });

  /* ---------------------------------------------------------------- */

  if (loginPossible === false) {
    // The LAN addresses are HTTPS as well, so "use the HTTPS address" told
    // somebody already on HTTPS to do what they were doing. They answer a flat
    // 403 with no login path, and /config stays refused there whatever session
    // you hold — so the only useful thing is the address that does work.
    const elsewhere = signInBaseUrl
      && typeof window !== "undefined"
      && !window.location.href.startsWith(`${signInBaseUrl}/`);
    const target = elsewhere
      ? `${signInBaseUrl}${typeof window === "undefined" ? "/" : window.location.pathname}`
      : null;
    return (
      <Shell compact={compact} onCancel={onCancel} title="Sign in">
        <p className="text-sm text-neutral-300">
          This address cannot sign you in. Nova&rsquo;s configuration is only reachable on its
          tailnet address.
        </p>
        {target ? (
          <a className="config-page-button justify-self-start" href={target}>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Continue on {new URL(signInBaseUrl).host}
          </a>
        ) : null}
        {typeof window !== "undefined" ? (
          <p className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
            {window.location.host}
          </p>
        ) : null}
      </Shell>
    );
  }

  const component = challenge?.component ?? "";
  const unsupported = Boolean(challenge) && !RENDERABLE.has(component) && !isTerminal(challenge!);
  const showIdentity = component === "ak-stage-identification";
  const showPasswordOnly = component === "ak-stage-password";
  const validate = component === "ak-stage-authenticator-validate";
  const showCode = validate && mode === "password";
  const canOfferPasskey =
    typeof navigator !== "undefined" && typeof navigator.credentials?.get === "function";

  return (
    <Shell compact={compact} onCancel={onCancel} title="Sign in">
      {unsupported ? (
        <div className="grid gap-2">
          <p className="text-sm text-neutral-300">
            {challenge?.flow_info?.title ?? "Sign in"} — this step is not supported here.
          </p>
          <a className="text-sm text-cyan-300 underline" href="/authentik/if/flow/default-authentication-flow/">
            Continue on the authentik page
          </a>
        </div>
      ) : null}

      {showIdentity || showPasswordOnly ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submitPassword();
          }}
        >
          {showIdentity ? (
            <label className="grid gap-1 text-xs uppercase tracking-widest text-neutral-400">
              Username
              <input
                className="border border-neutral-700 bg-black/40 px-2 py-2 text-sm text-neutral-100"
                value={username}
                autoComplete="username"
                autoFocus
                disabled={busy}
                onChange={(event) => setUsername(event.target.value)}
              />
              {fieldError(challenge!, "uid_field") ? (
                <span className="text-xs normal-case tracking-normal text-red-300">
                  {fieldError(challenge!, "uid_field")}
                </span>
              ) : null}
            </label>
          ) : null}

          {showPasswordOnly || challenge?.password_fields ? (
            <label className="grid gap-1 text-xs uppercase tracking-widest text-neutral-400">
              Password
              <input
                type="password"
                className="border border-neutral-700 bg-black/40 px-2 py-2 text-sm text-neutral-100"
                value={password}
                autoComplete="current-password"
                autoFocus={showPasswordOnly}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
              {fieldError(challenge!, "password") ? (
                <span className="text-xs normal-case tracking-normal text-red-300">
                  {fieldError(challenge!, "password")}
                </span>
              ) : null}
            </label>
          ) : null}

          <MomentaryFeedbackButton type="submit" className="config-page-button" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogIn className="h-4 w-4" aria-hidden="true" />}
            {challenge?.primary_action ?? "Log in"}
          </MomentaryFeedbackButton>
        </form>
      ) : null}

      {showCode ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submitPassword();
          }}
        >
          <label className="grid gap-1 text-xs uppercase tracking-widest text-neutral-400">
            Authentication code
            <input
              className="border border-neutral-700 bg-black/40 px-2 py-2 text-sm tracking-[0.3em] text-neutral-100"
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              disabled={busy}
              onChange={(event) => setCode(event.target.value)}
            />
            {fieldError(challenge!, "code") ? (
              <span className="text-xs normal-case tracking-normal text-red-300">
                {fieldError(challenge!, "code")}
              </span>
            ) : null}
          </label>
          <MomentaryFeedbackButton type="submit" className="config-page-button" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Continue
          </MomentaryFeedbackButton>
        </form>
      ) : null}

      {mode === "face" ? (
        <FacePreview
          ariaLabel="Face sign-in camera preview"
          label={capture.devices.find((device) => device.deviceId === capture.deviceId)?.label}
          previewing={capture.previewing}
          videoRef={videoRef}
        />
      ) : null}

      {note ? <p className="text-xs text-cyan-200">{note}</p> : null}
      {error ? (
        <div role="alert" className="grid gap-1">
          <p className="text-sm text-red-300">{error}</p>
          {/* The stable reason string, when it is one worth naming. It is not
              decoration: it is what makes a failure reportable and searchable
              instead of "it didn't work". Withheld for the liveness, match and
              switched-off reasons -- see UNNAMED_REASONS. */}
          {errorCode ? (
            <p className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
              {errorCode}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2 border-t border-neutral-800 pt-3">
        {canOfferPasskey ? (
          <MomentaryFeedbackButton
            type="button"
            className="config-page-button"
            disabled={busy}
            onClick={() => void useThePasskey()}
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Use Passkey
          </MomentaryFeedbackButton>
        ) : null}

        <MomentaryFeedbackButton
          type="button"
          className="config-page-button"
          disabled={busy || secureContext === false}
          onClick={() => void useTheFace()}
          title={secureContext === false ? FACE_REASON_MESSAGES.insecure_context : undefined}
        >
          <ScanFace className="h-4 w-4" aria-hidden="true" />
          Use Face
        </MomentaryFeedbackButton>

        {secureContext === false ? (
          <p className="text-xs text-neutral-500">{FACE_REASON_MESSAGES.insecure_context}</p>
        ) : null}

        {mode !== "password" ? (
          <button type="button" className="text-xs text-neutral-400 underline" onClick={backToPassword}>
            Back to password
          </button>
        ) : null}

        <button
          type="button"
          className="text-xs text-neutral-400 underline justify-self-start"
          disabled={busy}
          onClick={() => void startOver()}
        >
          Start over
        </button>
      </div>
    </Shell>
  );
}
