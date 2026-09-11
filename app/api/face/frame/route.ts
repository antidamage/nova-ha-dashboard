import { proxyFaceAuthUpload } from "../../../../lib/face-auth-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One still of a `quick` sign-in: multipart `image` + `nonce`. The service holds
 * good frames against the nonce and `/api/face/assert` judges them
 * (`specs/login-surface.md` § Capture profiles).
 *
 * Ungated for the same reason as `assert`: it is part of obtaining a session.
 */
export async function POST(request: Request) {
  return proxyFaceAuthUpload("/frame", request);
}
