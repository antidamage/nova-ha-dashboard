// SSH client: host-key pinning, connecting, running a command, SFTP upload.
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { Client, type ConnectConfig } from "ssh2";
import { assertSafeRemoteFileName, remotePrepareCommand } from "./remote-commands";
import type { CommandResult, ManagedComputer } from "./types";

export function destination(computer: ManagedComputer) {
  if (!computer.address || !computer.username) {
    throw new Error(`${computer.name} is missing an address or username`);
  }
}

export function hostFingerprint(key: Buffer) {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

export function knownHostsKeyBlob(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  const keyPart = parts.find((part) => /^[A-Za-z0-9+/]+={0,2}$/.test(part) && part.length > 40);
  return keyPart ? Buffer.from(keyPart, "base64") : null;
}

export function hostKeyMatches(expected: string, key: Buffer) {
  const expectedLines = expected
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const actualFingerprint = hostFingerprint(key);

  return expectedLines.some((line) => {
    if (line.startsWith("SHA256:")) {
      return line.replace(/=+$/, "") === actualFingerprint;
    }
    const keyBlob = knownHostsKeyBlob(line);
    return Boolean(keyBlob && keyBlob.equals(key));
  });
}

export async function connectManagedComputer(computer: ManagedComputer): Promise<Client> {
  if (!computer.enabled) {
    throw new Error(`${computer.name} is disabled`);
  }
  if (!computer.hostKey) {
    throw new Error(`${computer.name} is missing an SSH host-key pin`);
  }
  destination(computer);
  const privateKey = await readFile(computer.sshKeyPath, "utf8");
  const client = new Client();
  const config: ConnectConfig = {
    host: computer.address,
    hostVerifier: (key: Buffer) => Buffer.isBuffer(key) && hostKeyMatches(computer.hostKey, key),
    keepaliveInterval: Math.max(5_000, Math.min(computer.commandTimeoutMs, 20_000)),
    port: computer.port ?? 22,
    privateKey,
    readyTimeout: computer.commandTimeoutMs,
    username: computer.username,
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.end();
      reject(new Error(`${computer.name} SSH connection timed out after ${computer.commandTimeoutMs}ms`));
    }, computer.commandTimeoutMs);
    client
      .once("ready", () => {
        clearTimeout(timer);
        resolve(client);
      })
      .once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      })
      .connect(config);
  });
}

export async function runManagedComputerSsh(computer: ManagedComputer, remoteCommand: string) {
  const client = await connectManagedComputer(computer);
  return new Promise<CommandResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.end();
      reject(new Error(`${computer.name} command timed out after ${computer.commandTimeoutMs}ms`));
    }, computer.commandTimeoutMs);

    client.exec(remoteCommand, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        client.end();
        reject(error);
        return;
      }

      let stdout = "";
      let stderr = "";
      stream
        .on("close", (code: number | null) => {
          clearTimeout(timer);
          client.end();
          if (code === 0) {
            resolve({ stdout, stderr });
            return;
          }
          reject(new Error(`${computer.name} command exited with code ${code}: ${stderr || stdout}`));
        })
        .on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
      stream.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
    });
  });
}

export async function copyFileToManagedComputer(computer: ManagedComputer, localFilePath: string, remoteFileName: string) {
  assertSafeRemoteFileName(remoteFileName);
  await runManagedComputerSsh(computer, remotePrepareCommand(computer.platform));
  const client = await connectManagedComputer(computer);
  return new Promise<CommandResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.end();
      reject(new Error(`${computer.name} SFTP upload timed out after ${computer.commandTimeoutMs}ms`));
    }, computer.commandTimeoutMs);

    client.sftp((error, sftp) => {
      if (error) {
        clearTimeout(timer);
        client.end();
        reject(error);
        return;
      }

      sftp.fastPut(localFilePath, `NovaManagedDesktop/${remoteFileName}`, (uploadError) => {
        clearTimeout(timer);
        client.end();
        if (uploadError) {
          reject(uploadError);
          return;
        }
        resolve({ stdout: "", stderr: "" });
      });
    });
  });
}
