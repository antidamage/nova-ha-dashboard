/**
 * Running commands on iridium, in authentik's shell, and on the LAN.
 *
 * Moved verbatim from `scripts/verify-signin.mjs`, which stays the entry
 * point (`npm run verify:signin`).
 */

import { spawnSync } from "node:child_process";
import { IRIDIUM, LAN_ORIGINS, SSH_OPTS } from "./config.mjs";
import { follow } from "./http.mjs";

function ssh(command) {
  const out = spawnSync("ssh", [...SSH_OPTS, IRIDIUM, `bash -c ${JSON.stringify(command)}`], {
    encoding: "utf8",
    timeout: 180000,
  });
  return { code: out.status, stdout: out.stdout || "", stderr: out.stderr || "" };
}

/**
 * Run Python inside authentik's own shell. The source is base64'd so it
 * survives three layers of quoting (local shell, iridium's fish login shell,
 * `docker exec`), and stdin comes from /dev/null because `docker exec -i`
 * otherwise swallows the parent's.
 */
export function akShell(python) {
  const b64 = Buffer.from(python, "utf8").toString("base64");
  const inner = `exec(__import__('base64').b64decode('${b64}').decode())`;
  return ssh(
    `docker exec -i authentik-server-1 ak shell -c ${JSON.stringify(inner)} < /dev/null 2>/dev/null`,
  );
}

/**
 * The LAN vhosts are not reachable from every workstation (AP isolation, a
 * different segment). Try them directly first; fall back to running the same
 * probe from iridium, which is on the LAN by definition.
 */
export async function lanProbe(path) {
  for (const origin of LAN_ORIGINS) {
    try {
      const res = await follow(`${origin}${path}`, { insecure: true });
      return {
        via: origin,
        status: res.status,
        contentType: res.contentType,
        json: res.json,
        text: res.text,
      };
    } catch {
      /* try the next name, then SSH */
    }
  }
  const url = `${LAN_ORIGINS[0]}${path}`;
  const r = ssh(
    `curl -skL --max-time 15 -o /tmp/nova-verify-lan.out -w '%{http_code} %{content_type}' ${JSON.stringify(url)}; echo; cat /tmp/nova-verify-lan.out; rm -f /tmp/nova-verify-lan.out`,
  );
  const [head, ...rest] = r.stdout.split("\n");
  const [status, contentType = ""] = head.trim().split(" ");
  const text = rest.join("\n");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* fine */
  }
  return { via: `${LAN_ORIGINS[0]} (via iridium)`, status: Number(status), contentType, json, text };
}
