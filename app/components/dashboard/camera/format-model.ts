import { DEMO_MODE } from "./constants";
import type { CameraEvent, CameraStatus } from "./types";

export function formatClock(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function formatOffset(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `-${mins}m ${String(secs).padStart(2, "0")}s`;
}

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(mins).padStart(2, "0")}m`;
  }
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, "0")}s`;
  }
  return `${secs}s`;
}

export function formatBytes(bytes: number) {
  if (bytes >= 1e9) {
    return `${(bytes / 1e9).toFixed(1)} GB`;
  }
  if (bytes >= 1e6) {
    return `${Math.round(bytes / 1e6)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export function formatCreated(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function sourceLabel(status: CameraStatus | null) {
  if (DEMO_MODE) {
    return "Demo";
  }
  if (!status) {
    return "—";
  }
  if (status.source === "device") {
    return "Live Feed";
  }
  return "Placeholder";
}

export function when(value: string) {
  const date = new Date(value);
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function statusLabel(status: CameraEvent["status"]) {
  if (status === "collecting") return "Recording";
  if (status === "queued") return "Detail queued";
  if (status === "analysing") return "Analysing";
  if (status === "analysis_failed") return "Detail failed";
  return "Analysed";
}
