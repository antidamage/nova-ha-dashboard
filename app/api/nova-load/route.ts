import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

type CpuStat = { idle: number; total: number };
type NetStat = { rx: number; tx: number; ts: number };

let lastCpu: CpuStat | null = null;
let lastNet: NetStat | null = null;

const NET_SATURATION_BPS = 12.5 * 1024 * 1024; // ~100 Mbps

async function readCpu(): Promise<number> {
  try {
    const data = await fs.readFile("/proc/stat", "utf8");
    const line = data.split("\n", 1)[0];
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    if (parts.length < 4) return 0;
    const idle = parts[3] + (parts[4] || 0);
    const total = parts.reduce((a, b) => a + b, 0);
    let pct = 0;
    if (lastCpu) {
      const idleDelta = idle - lastCpu.idle;
      const totalDelta = total - lastCpu.total;
      if (totalDelta > 0) pct = 1 - idleDelta / totalDelta;
    }
    lastCpu = { idle, total };
    return Math.max(0, Math.min(1, pct));
  } catch {
    return 0;
  }
}

async function readNet(): Promise<number> {
  try {
    const data = await fs.readFile("/proc/net/dev", "utf8");
    let rx = 0;
    let tx = 0;
    for (const raw of data.split("\n").slice(2)) {
      const line = raw.trim();
      if (!line) continue;
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const iface = line.slice(0, colon);
      if (iface === "lo" || iface.startsWith("docker") || iface.startsWith("veth") || iface.startsWith("br-")) continue;
      const fields = line.slice(colon + 1).trim().split(/\s+/).map(Number);
      rx += fields[0] || 0;
      tx += fields[8] || 0;
    }
    const now = Date.now();
    let pct = 0;
    if (lastNet) {
      const dt = (now - lastNet.ts) / 1000;
      if (dt > 0) {
        const bps = (rx - lastNet.rx + tx - lastNet.tx) / dt;
        pct = Math.max(0, Math.min(1, bps / NET_SATURATION_BPS));
      }
    }
    lastNet = { rx, tx, ts: now };
    return pct;
  } catch {
    return 0;
  }
}

async function readGpu(): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
      { timeout: 1500 },
    );
    const v = parseInt(stdout.trim().split("\n")[0], 10);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v / 100));
  } catch {
    return 0;
  }
}

async function readListening(): Promise<boolean> {
  const url = process.env.HA_URL || "http://127.0.0.1:8123";
  const token = process.env.HA_TOKEN;
  if (!token) return false;
  const entity =
    process.env.NOVA_ASSIST_SAT_ENTITY || "assist_satellite.iridium_assist_satellite";
  try {
    const r = await fetch(`${url}/api/states/${entity}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return false;
    const data = (await r.json()) as { state?: string };
    if (!data.state) return false;
    return data.state !== "idle" && data.state !== "unavailable" && data.state !== "unknown";
  } catch {
    return false;
  }
}

export async function GET() {
  const [cpu, net, gpu, listening] = await Promise.all([
    readCpu(),
    readNet(),
    readGpu(),
    readListening(),
  ]);
  const load = Math.max(cpu, net, gpu, listening ? 1 : 0);
  return Response.json(
    { cpu, net, gpu, listening, load, ts: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
