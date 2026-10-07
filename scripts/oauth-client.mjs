#!/usr/bin/env node
// Manage the OAuth client registry (data/oauth/clients.json) on the host that
// owns the data directory. Spec: specs/update-force-endpoint.md.
//
//   node scripts/oauth-client.mjs add --id <id> --scope <scope> [--scope ...] [--label <text>]
//   node scripts/oauth-client.mjs list
//   node scripts/oauth-client.mjs revoke --id <id>
//   node scripts/oauth-client.mjs rotate --id <id>
//   --dir <path>   data directory holding oauth/ (default: $NOVA_OAUTH_DIR, else ./data/oauth)
//
// A new secret is printed once and never stored; only its scrypt hash is.
import { randomBytes, scryptSync } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Must match lib/oauth/secret-hash.ts.
export function hashSecret(secret) {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function parseArgs(argv) {
  const out = { _: [], scope: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value`);
      if (key === "scope") out.scope.push(value);
      else out[key] = value;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function load(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { clients: [] };
    throw error;
  }
}

function save(file, registry) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // Best effort on filesystems without modes.
  }
}

export function runCli(argv) {
  const args = parseArgs(argv);
  const [command] = args._;
  const oauthDir = args.dir ? path.join(args.dir, "oauth") : process.env.NOVA_OAUTH_DIR ?? path.join(process.cwd(), "data", "oauth");
  const file = path.join(oauthDir, "clients.json");
  const registry = load(file);
  const find = () => registry.clients.find((client) => client.id === args.id);

  if (command === "list") {
    for (const client of registry.clients) {
      console.log(`${client.id}\t${client.scopes.join(" ")}\t${client.revokedAt ? "revoked" : "active"}\t${client.label ?? ""}`);
    }
    return;
  }
  if (!args.id) throw new Error("--id is required");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(args.id)) throw new Error("--id may use letters, digits, . _ - (max 64)");

  if (command === "add") {
    if (!args.scope.length) throw new Error("at least one --scope is required");
    if (find()) throw new Error(`client ${args.id} already exists (use rotate)`);
    const secret = randomBytes(32).toString("base64url");
    registry.clients.push({
      id: args.id,
      label: args.label,
      secretHash: hashSecret(secret),
      scopes: args.scope,
      createdAt: new Date().toISOString(),
    });
    save(file, registry);
    console.log(secret);
    return;
  }
  const client = find();
  if (!client) throw new Error(`no client ${args.id}`);
  if (command === "revoke") {
    client.revokedAt = new Date().toISOString();
    save(file, registry);
    return;
  }
  if (command === "rotate") {
    if (client.revokedAt) throw new Error(`client ${args.id} is revoked; add a new client instead`);
    const secret = randomBytes(32).toString("base64url");
    client.secretHash = hashSecret(secret);
    save(file, registry);
    console.log(secret);
    return;
  }
  throw new Error("usage: oauth-client.mjs add|list|revoke|rotate --id <id> [--scope <s>] [--label <t>] [--dir <data>]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
