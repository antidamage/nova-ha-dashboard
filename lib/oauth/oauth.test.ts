import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashSecret as hashSecretMjs, runCli } from "../../scripts/oauth-client.mjs";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "nova-oauth-"));
  process.env.NOVA_OAUTH_DIR = path.join(dir, "oauth");
  process.env.NOVA_UPDATE_DIR = path.join(dir, "update");
  delete process.env.NOVA_OAUTH_SIGNING_KEY;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.NOVA_OAUTH_DIR;
  delete process.env.NOVA_UPDATE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function register(args: string[]) {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  runCli([...args, "--dir", dir]);
  const printed = log.mock.calls.at(-1)?.[0] as string | undefined;
  log.mockRestore();
  return printed ?? "";
}

function tokenRequest(body: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request("http://nova.test/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body).toString(),
  });
}

async function getToken(id: string, secret: string, scope?: string) {
  const { POST } = await import("../../app/api/oauth/token/route");
  const response = await POST(
    tokenRequest({ grant_type: "client_credentials", client_id: id, client_secret: secret, ...(scope ? { scope } : {}) }),
  );
  return { response, body: await response.json() };
}

function force(token?: string) {
  return new Request("http://nova.test/api/update/force", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("secret hash", () => {
  it("is the same format in the CLI and the app", async () => {
    const { verifySecret } = await import("./secret-hash");
    expect(verifySecret("s3cret", hashSecretMjs("s3cret"))).toBe(true);
    expect(verifySecret("other", hashSecretMjs("s3cret"))).toBe(false);
    expect(verifySecret("s3cret", "not-a-hash")).toBe(false);
  });
});

describe("token endpoint", () => {
  it("issues a bearer token for valid credentials, with the registered scope by default", async () => {
    const secret = register(["add", "--id", "agent-a", "--scope", "update:force"]);
    const { response, body } = await getToken("agent-a", secret);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 600, scope: "update:force" });
  });

  it("accepts HTTP Basic credentials", async () => {
    const secret = register(["add", "--id", "agent-a", "--scope", "update:force"]);
    const { POST } = await import("../../app/api/oauth/token/route");
    const basic = Buffer.from(`agent-a:${secret}`).toString("base64");
    const response = await POST(tokenRequest({ grant_type: "client_credentials" }, { Authorization: `Basic ${basic}` }));
    expect(response.status).toBe(200);
  });

  it("rejects a wrong secret, an unknown client, other grants and unregistered scopes", async () => {
    const secret = register(["add", "--id", "agent-a", "--scope", "update:force"]);
    expect((await getToken("agent-a", "wrong")).response.status).toBe(401);
    expect((await getToken("nobody", secret)).response.status).toBe(401);
    expect((await getToken("agent-a", secret, "admin")).body.error).toBe("invalid_scope");
    const { POST } = await import("../../app/api/oauth/token/route");
    const response = await POST(tokenRequest({ grant_type: "password" }));
    expect((await response.json()).error).toBe("unsupported_grant_type");
  });

  it("throttles after 8 failed attempts for one client, even with the right secret", async () => {
    const secret = register(["add", "--id", "agent-a", "--scope", "update:force"]);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await getToken("agent-a", "wrong")).response.status).toBe(401);
    }
    const blocked = await getToken("agent-a", secret);
    expect(blocked.response.status).toBe(429);
    expect(Number(blocked.response.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("creates nothing on a fresh install until a token is issued, then only the 0600 signing key", async () => {
    await getToken("nobody", "x");
    expect(() => readdirSync(path.join(dir, "oauth"))).toThrow();
    const secret = register(["add", "--id", "agent-a", "--scope", "update:force"]);
    await getToken("agent-a", secret);
    expect(readdirSync(path.join(dir, "oauth")).sort()).toEqual(["clients.json", "signing-key"]);
    if (process.platform !== "win32") {
      expect(statSync(path.join(dir, "oauth", "signing-key")).mode & 0o777).toBe(0o600);
    }
  });
});

describe("force endpoint", () => {
  it("answers 401 with no token, and on a fresh install with no clients", async () => {
    const { POST } = await import("../../app/api/update/force/route");
    expect((await POST(force())).status).toBe(401);
    expect((await POST(force("garbage.token"))).status).toBe(401);
  });

  it("queues exactly one apply request for a token with update:force", async () => {
    const secret = register(["add", "--id", "agent-a", "--scope", "update:force"]);
    const { body } = await getToken("agent-a", secret);
    const { POST } = await import("../../app/api/update/force/route");
    const response = await POST(force(body.access_token));
    expect(response.status).toBe(202);
    expect((await response.json()).queued.requestedBy).toBe("oauth:agent-a");
    const controlDir = path.join(dir, "update", "control");
    const files = readdirSync(controlDir);
    expect(files).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(controlDir, files[0]), "utf8")).action).toBe("apply");
  });

  it("answers 403 to a valid token without the scope", async () => {
    const secret = register(["add", "--id", "reader", "--scope", "update:read"]);
    const { body } = await getToken("reader", secret);
    const { POST } = await import("../../app/api/update/force/route");
    expect((await POST(force(body.access_token))).status).toBe(403);
  });

  it("rejects an expired token, a tampered token and a revoked client", async () => {
    const secret = register(["add", "--id", "agent-a", "--scope", "update:force"]);
    const { issueToken } = await import("./tokens");
    const { POST } = await import("../../app/api/update/force/route");

    const expired = await issueToken("agent-a", ["update:force"], "v", Date.now() - 11 * 60 * 1000);
    expect((await POST(force(expired.token))).status).toBe(401);

    const { body } = await getToken("agent-a", secret);
    expect((await POST(force(body.access_token))).status).toBe(202);
    // Same registered client, same signature, later expiry: only the signature check can reject this.
    const [payload, signature] = body.access_token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const extended = Buffer.from(JSON.stringify({ ...claims, exp: claims.exp + 3600 })).toString("base64url");
    expect((await POST(force(`${extended}.${signature}`))).status).toBe(401);

    register(["revoke", "--id", "agent-a"]);
    expect((await POST(force(body.access_token))).status).toBe(401);
  });

  it("rotating a client rejects its old secret and the tokens already issued", async () => {
    const first = register(["add", "--id", "agent-a", "--scope", "update:force"]);
    const { body } = await getToken("agent-a", first);
    const { POST } = await import("../../app/api/update/force/route");
    expect((await POST(force(body.access_token))).status).toBe(202);
    const second = register(["rotate", "--id", "agent-a"]);
    expect((await getToken("agent-a", first)).response.status).toBe(401);
    expect((await POST(force(body.access_token))).status).toBe(401);
    expect((await getToken("agent-a", second)).response.status).toBe(200);
  });

  it("does not reinstate a revoked client by rotating it", () => {
    register(["add", "--id", "agent-a", "--scope", "update:force"]);
    register(["revoke", "--id", "agent-a"]);
    expect(() => register(["rotate", "--id", "agent-a"])).toThrow(/revoked/);
  });

  it("refuses a signing key that is too short", async () => {
    process.env.NOVA_OAUTH_SIGNING_KEY = "short";
    const secret = register(["add", "--id", "agent-a", "--scope", "update:force"]);
    expect((await getToken("agent-a", secret)).response.status).toBe(503);
    delete process.env.NOVA_OAUTH_SIGNING_KEY;
  });
});
