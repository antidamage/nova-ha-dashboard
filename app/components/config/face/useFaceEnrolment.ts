"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FACE_REASON_MESSAGES,
  faceReasonMessage,
  readJsonBody,
  useFaceCapture,
} from "../../face/faceCapture";
import { DEFAULT_CLIPS_NEEDED, NEW_SUBJECT } from "./enrolment-model";
import type { EnrolProgress, FaceSubject, Tone } from "./types";

/**
 * The face enrolment section's state and its calls to the same-origin
 * `/api/face/*` proxy: the subject list, the camera, clip capture and removal.
 * Split out of `FaceEnrolmentConfig.tsx` (specs/agent-token-footprint.md §4).
 */
export function useFaceEnrolment() {
  const {
    videoRef,
    devices,
    deviceId,
    previewing,
    secureContext,
    openCamera,
    recordClip,
    stopStream,
  } = useFaceCapture();
  const [subjects, setSubjects] = useState<FaceSubject[]>([]);
  const [subjectId, setSubjectId] = useState<string>(NEW_SUBJECT);
  const [newName, setNewName] = useState("");
  const [progress, setProgress] = useState<EnrolProgress | null>(null);
  const [status, setStatus] = useState<{ tone: Tone; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FaceSubject | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadSubjects = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/face/subjects", { cache: "no-store" });
      const payload = await readJsonBody(response);
      if (!response.ok) {
        setStatus({
          tone: "error",
          text: response.status === 403
            ? "Face enrolment needs a signed-in session on the HTTPS address."
            : faceReasonMessage(payload?.reason, "The face service is not responding."),
        });
        return;
      }
      const list = Array.isArray(payload) ? (payload as unknown as FaceSubject[]) : [];
      setSubjects(list);
    } catch {
      setStatus({ tone: "error", text: FACE_REASON_MESSAGES.service_unavailable });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  // `useFaceCapture` returns the failure rather than presenting it, because the
  // login modal shows the same failures in a different place. This is where it
  // becomes a toned status line.
  const startCamera = useCallback(async (requestedId?: string) => {
    const failure = await openCamera(requestedId);
    setStatus(failure ? { tone: "error", text: failure } : null);
  }, [openCamera]);

  const subjectTarget = subjectId === NEW_SUBJECT ? newName.trim() : subjectId;
  const activeSubject = subjects.find((subject) => subject.id === subjectId) ?? null;
  const needed = progress?.needed ?? DEFAULT_CLIPS_NEEDED;
  const clipsSoFar = progress?.clipsSoFar ?? activeSubject?.clips ?? 0;
  const remaining = progress?.remaining ?? Math.max(0, needed - clipsSoFar);

  const captureClip = useCallback(async () => {
    if (!subjectTarget || busy) return;
    setBusy(true);
    try {
      // Nonce first: it has a 20 s TTL, so it is fetched immediately before the
      // recording rather than held across the whole session.
      const challenge = await fetch("/api/face/challenge", { method: "POST" });
      const challengePayload = await readJsonBody(challenge);
      const nonce = typeof challengePayload?.nonce === "string" ? challengePayload.nonce : "";
      if (!challenge.ok || !nonce) {
        setStatus({
          tone: "error",
          text: faceReasonMessage(challengePayload?.reason, FACE_REASON_MESSAGES.service_unavailable),
        });
        return;
      }

      // Say what to DO, not just that it is recording. The liveness test wants
      // ordinary movement and a person told only "Recording…" holds still for
      // the camera, which is the one thing that makes a real face look rigid.
      setStatus({ tone: "info", text: "Recording — blink and move naturally…" });
      // Enrolment is `standard` and stays there, so this is always a clip.
      // A photograph enrolled into the gallery authenticates every later
      // sign-in, including the ones that did keep their gates, which is why the
      // short profiles are a login-surface choice and never an enrolment one.
      const { blob } = await recordClip();

      const form = new FormData();
      form.set("clip", blob, "clip.webm");
      form.set("nonce", nonce);
      const response = await fetch(`/api/face/enrol/${encodeURIComponent(subjectTarget)}`, {
        method: "POST",
        body: form,
      });
      const payload = await readJsonBody(response);

      // Progress comes from the response, never from a client-side counter — a
      // rejected clip must not advance the count.
      if (typeof payload?.clipsSoFar === "number") {
        setProgress({
          clipsSoFar: payload.clipsSoFar,
          needed: typeof payload.needed === "number" ? payload.needed : DEFAULT_CLIPS_NEEDED,
          remaining: typeof payload.remaining === "number"
            ? payload.remaining
            : Math.max(0, (typeof payload.needed === "number" ? payload.needed : DEFAULT_CLIPS_NEEDED) - payload.clipsSoFar),
        });
      }

      if (!response.ok || payload?.accepted !== true) {
        setStatus({ tone: "error", text: faceReasonMessage(payload?.reason) });
        return;
      }

      const left = typeof payload.remaining === "number" ? payload.remaining : null;
      setStatus({
        tone: "ok",
        text: left === 0 ? "Clip accepted. Enrolment complete." : "Clip accepted.",
      });
      await loadSubjects();
      if (left === 0) {
        // Enrolment is finished; nothing further needs the camera.
        stopStream();
      }
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : FACE_REASON_MESSAGES.service_unavailable,
      });
    } finally {
      setBusy(false);
    }
  }, [busy, loadSubjects, recordClip, stopStream, subjectTarget]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/face/subjects/${encodeURIComponent(pendingDelete.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await readJsonBody(response);
        setStatus({ tone: "error", text: faceReasonMessage(payload?.reason, "That person could not be removed.") });
        return;
      }
      setStatus({ tone: "ok", text: `${pendingDelete.name} removed.` });
      if (subjectId === pendingDelete.id) {
        setSubjectId(NEW_SUBJECT);
        setProgress(null);
      }
      await loadSubjects();
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }, [loadSubjects, pendingDelete, subjectId]);

  return {
    videoRef, devices, deviceId, previewing, secureContext, stopStream,
    subjects, subjectId, setSubjectId, newName, setNewName, setProgress,
    status, setStatus, busy, loading, pendingDelete, setPendingDelete, deleting,
    loadSubjects, startCamera, subjectTarget, needed, clipsSoFar, remaining,
    captureClip, confirmDelete,
  };
}
