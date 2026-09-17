"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FACE_REASON_MESSAGES,
  faceReasonDetail,
  readJsonBody,
  useFaceCapture,
} from "../../face/faceCapture";
import type { CaptureSpec } from "../../face/faceCapture";
import {
  FLOW_FACE,
  FLOW_PASSKEY,
  FlowTransportError,
  assertionToPayload,
  beginFlow,
  cancelFlow,
  challengeError,
  faceAssertionToPayload,
  isTerminal,
  safeNext,
  submitFlow,
  toCredentialRequestOptions,
  webauthnChallenge,
  webauthnChallengeValue,
  type FlowChallenge,
} from "../../../../lib/authentik-flow";
import { fetchAuthState } from "../useAuthSession";
import { MODE_FLOW } from "./constants";
import type { Mode } from "./types";

/**
 * The sign-in flow behind `LoginPanel`: every piece of its state and every
 * step of the password, passkey and face paths, moved here verbatim so the
 * component file holds only what it renders. `LoginPanel` calls this once, in
 * the place its own state and callbacks were declared.
 */
export function useLoginFlow({
  onSuccess,
  onNativePrompt,
  captureSpec,
}: {
  onSuccess: (next: string) => void;
  onNativePrompt?: (active: boolean) => void;
  captureSpec: CaptureSpec;
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
  // Where sign-in works, when it is not here. Empty until the config answers.
  const [signInBaseUrl, setSignInBaseUrl] = useState("");

  const capture = useFaceCapture(captureSpec);
  const { openCamera, recordClip, secureContext, stopStream, streamFrames, videoRef } = capture;
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
    // Fetched unconditionally, so the "not here" branch already has somewhere
    // to point rather than fetching only once it is needed.
    void fetch("/api/config/client", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!liveRef.current) return;
        const url = typeof body?.signInBaseUrl === "string" ? body.signInBaseUrl : "";
        setSignInBaseUrl(url);
      })
      .catch(() => undefined);
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

  // Open the password flow once the origin is known to have a login path.
  //
  // NOT on mount. `/authentik/*` is proxied on the tailnet vhost only, because
  // the LAN vhosts answer a flat 403 with no way to satisfy an authentik gate.
  // Starting the flow regardless meant the LAN origin got Next.js's redirect
  // instead of a challenge, which the client reported as "the sign-in service
  // is not responding" -- alarming, wrong, and the opposite of the actual
  // situation, which is that this address simply cannot sign anybody in.
  useEffect(() => {
    if (loginPossible !== true) return;
    void start("password");
  }, [loginPossible, start]);

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
      // Name what actually threw. "That passkey could not be used" was a
      // catch-all covering a dismissed prompt, an origin the credential cannot
      // be used from, and a failed submit -- three different problems with
      // three different fixes, reported identically.
      if (failure instanceof FlowTransportError) {
        fail(failure.message, "flow_unreachable");
      } else if (failure instanceof Error && failure.name === "NotAllowedError") {
        // Covers "dismissed", "timed out" AND "no credential matched", which
        // the browser deliberately does not distinguish.
        fail("The passkey prompt was dismissed, timed out, or found no matching passkey.", "webauthn_not_allowed");
      } else if (failure instanceof Error && failure.name === "SecurityError") {
        // The relying-party id is not usable from this origin -- almost always
        // the wrong address rather than a bad credential.
        fail("This passkey cannot be used from this address. Use the HTTPS address.", "webauthn_security");
      } else {
        const name = failure instanceof Error && failure.name ? failure.name : "unknown";
        fail("That passkey could not be used.", `webauthn_${name}`);
      }
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

      // Nonce immediately before capture: it has a 20 s TTL, and a standard
      // clip spends four seconds of that, a streamed capture up to five.
      const challengeResponse = await fetch("/api/face/challenge", { method: "POST" });
      const challengeBody = await readJsonBody(challengeResponse);
      const nonce = typeof challengeBody?.nonce === "string" ? challengeBody.nonce : "";
      if (!challengeResponse.ok || !nonce) {
        const detail = faceReasonDetail(challengeBody?.reason, FACE_REASON_MESSAGES.service_unavailable);
        fail(detail.message, detail.code);
        return;
      }

      // Tell them what to DO — but only where it is true. On `standard` the
      // liveness test measures ordinary movement, and someone told only
      // "Recording…" holds still for the camera, which is the one thing that
      // makes a real face look rigid. On the short profiles that gate is off,
      // so asking for a blink would be asking for something nothing measures,
      // in a window too small to contain it.
      setNote(
        captureSpec.profile === "standard"
          ? "Recording — blink and move naturally…"
          : "Look at the camera…",
      );
      const form = new FormData();
      if (captureSpec.streamGiveUpMs) {
        // Streamed: stills go one at a time until the service holds two it can
        // use, then the camera is released and `/assert` judges what it held.
        // A give-up posts `/assert` anyway — the service names which frames it
        // got and why the rest were skipped, and records the attempt.
        const streamed = await streamFrames(nonce);
        if (!liveRef.current) return;
        stopStream();
        if (streamed.reason) {
          const detail = faceReasonDetail(streamed.reason, "That did not sign you in.");
          fail(detail.message, detail.code);
          return;
        }
      } else {
        const { blob, field } = await recordClip();
        if (!liveRef.current) return;
        form.set(field, blob, field === "image" ? "frame.jpg" : "clip.webm");
      }
      setNote("Checking…");

      form.set("nonce", nonce);
      form.set("challenge", webauthnValue);
      form.set("profile", captureSpec.profile);
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
  }, [
    applyChallenge,
    captureSpec.profile,
    captureSpec.streamGiveUpMs,
    fail,
    openCamera,
    recordClip,
    start,
    stopStream,
    streamFrames,
  ]);

  const backToPassword = useCallback(() => {
    stopStream();
    void start("password");
  }, [start, stopStream]);

  /**
   * Abandon whatever the flow is part-way through and begin again.
   *
   * authentik resumes a flow from the session, so a half-finished attempt
   * reappears on the next open -- which is how a password screen turns into a
   * bare "Authentication code" with no way back to it.
   */
  const startOver = useCallback(async () => {
    stopStream();
    setUsername("");
    setPassword("");
    setCode("");
    await cancelFlow();
    await start("password");
  }, [start, stopStream]);

  return {
    mode,
    challenge,
    username,
    setUsername,
    password,
    setPassword,
    code,
    setCode,
    busy,
    error,
    errorCode,
    note,
    loginPossible,
    signInBaseUrl,
    capture,
    videoRef,
    secureContext,
    submitPassword,
    useThePasskey,
    useTheFace,
    backToPassword,
    startOver,
  };
}
