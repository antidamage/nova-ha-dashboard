/**
 * The HTTPS client: one honest request, and redirect following.
 *
 * Moved verbatim from `scripts/verify-signin.mjs`, which stays the entry
 * point (`npm run verify:signin`).
 */

import https from "node:https";
import { URL } from "node:url";

/* ------------------------------------------------------------------ plumbing */

/**
 * One HTTPS request. The cookie jar is applied on the way out and any
 * `Set-Cookie` merged back in on the way home. Nothing is followed here:
 * redirects are handled by the caller, because a stage POST answers 302 and
 * both the cookies it sets and the Location it names are evidence this harness
 * has to look at rather than let a client library resolve away.
 */
export function request(url, { method = "GET", headers = {}, body, jar, insecure = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const cookieHeader = jar && jar.size
      ? [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
      : undefined;
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        rejectUnauthorized: !insecure,
        servername: u.hostname,
        headers: {
          Accept: "application/json, text/html;q=0.5",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          ...(body
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
            : {}),
          ...headers,
        },
        timeout: 20000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (jar) {
            for (const raw of res.headers["set-cookie"] || []) {
              const [pair] = raw.split(";");
              const idx = pair.indexOf("=");
              if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
            }
          }
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not JSON; that is data too */
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            contentType: res.headers["content-type"] || "",
            location: res.headers.location || null,
            text,
            json,
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("ETIMEDOUT")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export const isRedirect = (status) => [301, 302, 303, 307, 308].includes(status);

/**
 * `request`, following up to 5 redirects exactly as a browser would, and
 * keeping every hop's cookies. No path rewriting: this is the honest client.
 */
export async function follow(url, opts = {}) {
  let current = url;
  let options = opts;
  let res = null;
  for (let hop = 0; hop < 6; hop += 1) {
    res = await request(current, options);
    if (!isRedirect(res.status) || !res.location) return { ...res, finalUrl: current };
    current = new URL(res.location, current).toString();
    // A 302/303 answer to a POST is re-read with GET, per the executor contract.
    const keepMethod = res.status === 307 || res.status === 308;
    options = { ...options, method: keepMethod ? options.method : "GET", body: undefined };
  }
  return { ...res, finalUrl: current };
}
