"use client";

import { KeyRound, Loader2, LogIn, ScanFace } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import {
  FACE_REASON_MESSAGES,
  faceReasonDetail,
  readJsonBody,
  useFaceCapture,
} from "../face/faceCapture";
import {
  FLOW_DEFAULT,
  FLOW_FACE,
  FLOW_PASSKEY,
  FlowTransportError,
  assertionToPayload,
  beginFlow,
  challengeError,
  faceAssertionToPayload,
  fieldError,
  isTerminal,
  safeNext,
  submitFlow,
  toCredentialRequestOptions,
  webauthnChallenge,
  webauthnChallengeValue,
  type FlowChallenge,
} from "../../../lib/authentik-flow";
import { fetchAuthState } from "./useAuthSession";

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

type Mode = "password" | "passkey" | "face";

const MODE_FLOW: Record<Mode, string> = {
  password: FLOW_DEFAULT,
  passkey: FLOW_PASSKEY,
  face: FLOW_FACE,
};

/**
 * Components this surface knows how to render. Anything else is a flow change
 * nobody told the UI about — see `unsupported` below, which links out rather
 * than showing a blank card.
 */
const RENDERABLE = new Set([
  "ak-stage-identification",
  "ak-stage-password",
  "ak-stage-authenticator-validate",
  "ak-stage-access-denied",
]);

export function LoginPanel({
  onSuccess,
  onCancel,
  onNativePrompt,
  compact = false,
}: {
  /** Called with a validated same-origin path once a flow completes. */
  onSuccess: (next: string) => void;
  /** Rendered as a Cancel button when supplied (the modal supplies it). */
  onCancel?: () => void;
  /**
   * Raised while a BROWSER-OWNED prompt is on screen (the passkey picker).
   * The modal suspends its focus trap for the duration -- without that, the
   * trap pulls focus back out of the picker and Chromium never paints it.
   */
  onNativePrompt?: (active: boolean) => void;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("password");
  const [challenge, setChallenge] = useState<FlowChallenge | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The stable reason string behind `error`, when it is one worth naming. Shown
  // small, beside the sentence, so a failure can be reported and searched for
  // rather than described as "it didn't work".
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loginPossible, setLoginPossible] = useState<boolean | null>(null);

  const capture = useFaceCapture();
  const { openCamera, recordClip, secureContext, stopStream, videoRef } = capture;
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  // Whether this origin has a login path at all. A LAN vhost answers 403 with
  // no way to satisfy the gate, and offering a sign-in there would be offering
  // something that cannot succeed.
  useEffect(() => {
    void fetchAuthState().then((state) => {
      if (!liveRef.current) return;
      setLoginPossible(state.status !== "no-login");
    });
  }, []);

  const fail = useCallback((message: string | null, code: string | null = null) => {
    setError(message);
    setErrorCode(code);
  }, []);

  const applyChallenge = useCallback(
    (next: FlowChallenge): boolean => {
      if (isTerminal(next)) {
        onSuccess(safeNext(typeof next.to === "string" ? next.to : null));
        return true;
      }
      setChallenge(next);
      fail(challengeError(next));
      return false;
    },
    [fail, onSuccess],
  );

  const start = useCallback(async (target: Mode) => {
    setBusy(true);
    fail(null);
    setNote(null);
    try {
      const next = await beginFlow(MODE_FLOW[target]);
      if (!liveRef.current) return null;
      setMode(target);
      setChallenge(next);
      return next;
    } catch (failure) {
      if (liveRef.current) {
        fail(failure instanceof FlowTransportError
          ? failure.message
          : "The sign-in service could not be reached.");
      }
      return null;
    } finally {
      if (liveRef.current) setBusy(false);
    }
  }, [fail]);

  // Open the password flow on mount so the fields are live immediately.
  useEffect(() => {
    void start("password");
  }, [start]);

  const answer = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!challenge) return;
      setBusy(true);
      fail(null);
      try {
        const next = await submitFlow(MODE_FLOW[mode], { component: challenge.component, ...payload });
        if (!liveRef.current) return;
        const done = applyChallenge(next);
        if (done) return;
        // A fresh identification challenge after a submit means the credentials
        // were refused: authentik restarts the stage rather than saying so.
        if (next.component === challenge.component && !challengeError(next)) {
          fail("That did not sign you in. Check the details and try again.");
        }
      } catch (failure) {
        if (liveRef.current) {
          fail(failure instanceof FlowTransportError
            ? failure.message
            : "The sign-in service could not be reached.");
        }
      } finally {
        if (liveRef.current) setBusy(false);
        setPassword("");
        setCode("");
      }
    },
    [applyChallenge, challenge, fail, mode],
  );

  const submitPassword = useCallback(() => {
    if (!challenge) return;
    if (challenge.component === "ak-stage-identification") {
      // `password` is accepted on the identification stage only when
      // `password_stage` is configured; otherwise authentik advances to a
      // separate ak-stage-password and the field below carries it instead.
      void answer(
        challenge.password_fields
          ? { uid_field: username, password }
          : { uid_field: username },
      );
      return;
    }
    if (challenge.component === "ak-stage-password") {
      void answer({ password });
      return;
    }
    if (challenge.component === "ak-stage-authenticator-validate") {
      void answer({ code });
    }
  }, [answer, challenge, code, password, username]);

  const useThePasskey = useCallback(async () => {
    const opened = await start("passkey");
    if (!opened) return;
    const device = webauthnChallenge(opened);
    if (!device) {
      fail("No passkey is registered on this account.", "no_passkey");
      return;
    }
    setBusy(true);
    // The picker is browser UI. Stand the focus trap down before asking for it,
    // and only bring it back once the promise settles -- see ModalOverlay's
    // suspendFocusTrap.
    onNativePrompt?.(true);
    try {
      const credential = (await navigator.credentials.get({
        publicKey: toCredentialRequestOptions(device),
      })) as PublicKeyCredential | null;
      if (!credential) {
        fail("No passkey was chosen.");
        return;
      }
      const next = await submitFlow(FLOW_PASSKEY, {
        component: "ak-stage-authenticator-validate",
        webauthn: assertionToPayload(credential),
      });
      if (!liveRef.current) return;
      if (!applyChallenge(next)) {
        fail(challengeError(next) ?? FACE_REASON_MESSAGES.assertion_rejected, "assertion_rejected");
      }
    } catch (failure) {
      if (!liveRef.current) return;
      // NotAllowedError covers both "user cancelled" and "timed out", and the
      // browser deliberately does not distinguish them.
      fail(failure instanceof Error && failure.name === "NotAllowedError"
        ? "The passkey prompt was dismissed or timed out."
        : "That passkey could not be used.");
    } finally {
      onNativePrompt?.(false);
      if (liveRef.current) setBusy(false);
    }
  }, [applyChallenge, fail, onNativePrompt, start]);

  const useTheFace = useCallback(async () => {
    const opened = await start("face");
    if (!opened) return;
    const device = webauthnChallenge(opened);
    const webauthnValue = device ? webauthnChallengeValue(device) : null;
    if (!webauthnValue) {
      fail("Face sign-in is not configured on this account.", "face_not_configured");
      return;
    }

    setBusy(true);
    try {
      const failure = await openCamera();
      if (!liveRef.current) return;
      if (failure) {
        fail(failure);
        return;
      }

      // Nonce immediately before recording: it has a 20 s TTL, and the clip
      // takes four seconds of that.
      const challengeResponse = await fetch("/api/face/challenge", { method: "POST" });
      const challengeBody = await readJsonBody(challengeResponse);
      const nonce = typeof challengeBody?.nonce === "string" ? challengeBody.nonce : "";
      if (!challengeResponse.ok || !nonce) {
        const detail = faceReasonDetail(challengeBody?.reason, FACE_REASON_MESSAGES.service_unavailable);
        fail(detail.message, detail.code);
        return;
      }

      // Tell them what to DO. The liveness test measures ordinary movement, and
      // someone told only "Recording…" holds still for the camera — the one
      // thing that makes a real face look rigid.
      setNote("Recording — blink and move naturally…");
      const clip = await recordClip();
      if (!liveRef.current) return;
      setNote("Checking…");

      const form = new FormData();
      form.set("clip", clip, "clip.webm");
      form.set("nonce", nonce);
      form.set("challenge", webauthnValue);
      const assertResponse = await fetch("/api/face/assert", { method: "POST", body: form });
      const assertBody = await readJsonBody(assertResponse);
      if (!liveRef.current) return;
      if (!assertResponse.ok || typeof assertBody?.signature !== "string") {
        // The service names its refusal; render that rather than a generic
        // line, because "recognised but not released", "not recognised" and
        // "no credential registered" call for completely different next steps.
        //
        // The fallback is deliberately neutral. An earlier version guessed
        // no_veto_channel for any 403, which was wrong for the case that
        // actually happens most -- no_credential -- and a confidently wrong
        // message is worse than an unspecific one. The reason code carries the
        // truth when the wording cannot.
        const detail = faceReasonDetail(assertBody?.reason, "That did not sign you in.");
        fail(detail.message, detail.code);
        return;
      }

      const next = await submitFlow(FLOW_FACE, {
        component: "ak-stage-authenticator-validate",
        webauthn: faceAssertionToPayload({
          credentialId: String(assertBody.credentialId ?? ""),
          clientDataJSON: String(assertBody.clientDataJSON ?? ""),
          authenticatorData: String(assertBody.authenticatorData ?? ""),
          signature: String(assertBody.signature),
          userHandle: typeof assertBody.userHandle === "string" ? assertBody.userHandle : null,
        }),
      });
      if (!liveRef.current) return;
      if (!applyChallenge(next)) {
        fail(challengeError(next) ?? FACE_REASON_MESSAGES.assertion_rejected, "assertion_rejected");
      }
    } catch (failure) {
      // Distinguish "the request never got there" from "something in this
      // component threw": the first is worth retrying, the second is a bug.
      if (liveRef.current) {
        fail(
          failure instanceof FlowTransportError
            ? failure.message
            : "Face sign-in could not be completed.",
          failure instanceof FlowTransportError ? "flow_unreachable" : "unexpected_error",
        );
      }
    } finally {
      // Release the camera whatever happened. A camera light left on in
      // someone's house is a real bug.
      stopStream();
      if (liveRef.current) {
        setBusy(false);
        setNote(null);
      }
    }
  }, [applyChallenge, fail, openCamera, recordClip, start, stopStream]);

  const backToPassword = useCallback(() => {
    stopStream();
    void start("password");
  }, [start, stopStream]);

  /* ---------------------------------------------------------------- */

  if (loginPossible === false) {
    return (
      <Shell compact={compact} onCancel={onCancel} title="Sign in">
        <p className="text-sm text-neutral-300">
          There is no sign-in on this address. Open the dashboard on its HTTPS address to sign in.
        </p>
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
        <div className="relative border border-neutral-800 bg-black/40">
          <video
            ref={videoRef}
            className="aspect-video w-full bg-black object-cover"
            muted
            playsInline
            aria-label="Face sign-in camera preview"
          />
          {!capture.previewing ? (
            <p className="absolute inset-0 flex items-center justify-center text-xs uppercase tracking-widest text-neutral-500">
              Camera off
            </p>
          ) : null}
        </div>
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
      </div>
    </Shell>
  );
}

/**
 * The striped card. Same `.system-confirm-card` plus paired `.system-stripe`
 * spans that `ConfirmDialog`, `SystemBlocker` and the system-power buttons use,
 * so sign-in reads as the same class of thing as the other guarded actions.
 *
 * The stripes are child spans rather than pseudo-elements deliberately: the
 * dashboard shell applies an `::after` press flash to every
 * `MomentaryFeedbackButton` and they would collide.
 */
function Shell({
  children,
  compact,
  onCancel,
  title,
}: {
  children: React.ReactNode;
  compact: boolean;
  onCancel?: () => void;
  title: string;
}) {
  return (
    <>
      <span className="system-stripe system-stripe-top" aria-hidden="true" />
      <span className="system-stripe system-stripe-bottom" aria-hidden="true" />
      <div className={compact ? "grid gap-3 py-3" : "grid gap-4 py-4"}>
        <h2 className="system-confirm-title">{title}</h2>
        {children}
        {onCancel ? (
          <button type="button" className="system-confirm-cancel justify-self-start" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </>
  );
}
