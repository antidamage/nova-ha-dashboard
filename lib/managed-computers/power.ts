// Power actions: sleep over SSH, wake over Wake-on-LAN.
import { createSocket } from "dgram";
import { clearComputerSleeping, markComputerSleeping } from "../sleeping-computers";
import { remoteSleepCommand } from "./remote-commands";
import { connectManagedComputer } from "./ssh";
import { getManagedComputer } from "./store";
import type { ManagedComputer } from "./types";

/**
 * Dispatch the suspend command and return as soon as it is on the wire. A
 * machine tears down its own SSH session as it powers off, so a clean exit is
 * the exception, not the rule: the close/reset that follows is the expected
 * sign it is going to sleep, never a reason to wait around or retry (a retry
 * would just wake it). We only surface a failure to *connect* - that means
 * nothing was sent and the box never slept.
 */
async function dispatchSleepCommand(computer: ManagedComputer, remoteCommand: string) {
  const client = await connectManagedComputer(computer);
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      client.end();
      resolve();
    };
    // Resolve once the command has had a moment to land, regardless of whether
    // the channel ever closes cleanly.
    const timer = setTimeout(finish, 2_500);
    client.once("error", () => {
      clearTimeout(timer);
      finish();
    });
    client.exec(remoteCommand, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        finish();
        return;
      }
      stream
        .on("close", () => {
          clearTimeout(timer);
          finish();
        })
        .on("data", () => undefined);
      stream.stderr.on("data", () => undefined);
    });
  });
}

export async function sleepManagedComputer(id: string) {
  const computer = await getManagedComputer(id);
  if (!computer.capabilities.sleep) {
    throw new Error(`${computer.name} is not configured for sleep`);
  }
  // Mark it sleeping up-front so any wallpaper sync racing this request stands
  // down instead of waking the machine back up.
  markComputerSleeping(computer.id);
  try {
    await dispatchSleepCommand(computer, remoteSleepCommand(computer.platform));
  } catch (error) {
    // The connection itself failed: nothing was sent, so it never slept. Drop
    // the suppression and report the failure to the caller.
    clearComputerSleeping(computer.id);
    throw error;
  }
  return { action: "sleep" as const, id: computer.id, name: computer.name };
}

// Where the dashboard broadcasts the wake packet. A sleeping machine answers no
// SSH, so wake is Wake-on-LAN: a magic packet broadcast on the LAN. The
// dashboard container runs with host networking, so the limited broadcast
// reaches the local segment.
const WOL_BROADCAST_ADDRESS = process.env.NOVA_WOL_BROADCAST ?? "255.255.255.255";
const WOL_PORTS = [9, 7];

/**
 * Build a Wake-on-LAN magic packet: 6 bytes of 0xFF followed by the 6-byte MAC
 * repeated 16 times (102 bytes total). Exported for unit testing.
 */
export function buildWakeOnLanPacket(macAddress: string): Buffer {
  const hex = macAddress.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12) {
    throw new Error(`Invalid MAC address: ${macAddress}`);
  }
  const mac = Buffer.from(hex, "hex");
  const packet = Buffer.alloc(102, 0xff);
  for (let repeat = 0; repeat < 16; repeat += 1) {
    mac.copy(packet, 6 + repeat * 6);
  }
  return packet;
}

async function sendWakeOnLan(macAddress: string) {
  const packet = buildWakeOnLanPacket(macAddress);
  await new Promise<void>((resolve, reject) => {
    const socket = createSocket("udp4");
    let settled = false;
    const done = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.close();
      } catch {
        // Socket may already be closing; nothing else to do.
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    socket.once("error", (error) => done(error));
    socket.bind(() => {
      socket.setBroadcast(true);
      let remaining = WOL_PORTS.length;
      for (const port of WOL_PORTS) {
        socket.send(packet, 0, packet.length, port, WOL_BROADCAST_ADDRESS, (error) => {
          if (error) {
            done(error);
            return;
          }
          remaining -= 1;
          if (remaining === 0) {
            done();
          }
        });
      }
    });
  });
}

export async function wakeManagedComputer(id: string) {
  const computer = await getManagedComputer(id);
  if (!computer.capabilities.wake) {
    throw new Error(`${computer.name} is not configured for wake-on-LAN`);
  }
  if (!computer.macAddress) {
    throw new Error(`${computer.name} has no MAC address configured`);
  }
  await sendWakeOnLan(computer.macAddress);
  // It is on its way up: lift the sleep suppression so wallpaper sync and other
  // SSH paths can reach it again.
  clearComputerSleeping(computer.id);
  return { action: "wake" as const, id: computer.id, name: computer.name };
}
