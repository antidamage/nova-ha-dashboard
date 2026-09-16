import { readFile } from "fs/promises";
import path from "node:path";

export async function tlsIdentity() {
  const root = path.join(process.cwd(), "data", "nova-voice-tls");
  const [ca, cert, key] = await Promise.all([
    readFile(path.join(root, "ca.crt")),
    readFile(path.join(root, "client.crt")),
    readFile(path.join(root, "client.key")),
  ]);
  return { ca, cert, key };
}

/** The mTLS client identity used to reach voice host (ca/cert/key buffers). */
export async function readVoiceTlsIdentity() {
  return tlsIdentity();
}
