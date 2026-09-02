import { proxyFaceAuthUpload } from "../../../../lib/face-auth-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The login itself: multipart `clip` + `nonce` + `challenge`, answering with a
 * WebAuthn assertion the browser hands back to authentik.
 *
 * Deliberately ungated — this is the path by which a session is obtained, so it
 * cannot require one. The browser drives authentik's flow exactly as it would
 * for a hardware key; this service only signs, and the face is the release
 * condition on that signature, never a bearer credential of its own.
 *
 * Present here because `app/api/face/*` is one proxy surface and the key
 * injection is the same. The login *UI* is not part of the enrolment work and
 * lives elsewhere.
 */
export async function POST(request: Request) {
  return proxyFaceAuthUpload("/assert", request);
}
