/**
 * Targets, origins and the throwaway credential for one run.
 *
 * Moved verbatim from `scripts/verify-signin.mjs`, which stays the entry
 * point (`npm run verify:signin`).
 */

import { randomBytes } from "node:crypto";

export const TAILNET = "https://nova.tuatara-dory.ts.net";
export const EXECUTOR = (origin, slug) =>
  `${origin}/authentik/api/v3/flows/executor/${slug}/?query=`;
export const RP_ID = "nova.tuatara-dory.ts.net";
export const LAN_ORIGINS = ["https://nova.local", "https://192.168.8.20"];

export const IRIDIUM = "antidamage@192.168.8.20";
const SSH_KEY = `${process.env.USERPROFILE || process.env.HOME}/.ssh/id_ed25519_nova_ha`;
export const SSH_OPTS = [
  "-o", "BatchMode=yes",
  "-o", "IdentitiesOnly=yes",
  "-o", "StrictHostKeyChecking=no",
  "-o", "UserKnownHostsFile=/dev/null",
  "-o", "LogLevel=ERROR",
  "-i", SSH_KEY,
];

export const TMP_USER = "nova-verify-throwaway";
export const TMP_PASSWORD = `verify-${randomBytes(12).toString("hex")}`;
