"""Serves the smooth stream, and runs the pipeline only while someone is asking for it.

Holds no GPU resources itself. specs/camera-smooth-delivery.md.
"""

import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from core import RESTART_BACKOFF_SECONDS, enough_gpu_memory, has_stalled, idle_expired, is_served_name

HERE = Path(__file__).resolve().parent
PORT = int(os.environ.get("NOVA_CAMERA_SMOOTH_PORT", "8095"))
SOURCE = os.environ.get("NOVA_CAMERA_SMOOTH_SOURCE", "http://127.0.0.1:3001/api/camera-proxy/outside/index.m3u8")
MODELS = Path(os.environ.get("NOVA_CAMERA_SMOOTH_MODELS", "/opt/nova-camera-smooth/models"))
MODEL = os.environ.get("NOVA_CAMERA_SMOOTH_MODEL", "rife-v4.26")
OUTPUT = Path(os.environ.get("NOVA_CAMERA_SMOOTH_OUTPUT", "/dev/shm/nova-camera-smooth"))
CONTENT_TYPES = {".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t"}


def free_gpu_mib():
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5, check=True,
        )
        return int(result.stdout.split()[0])
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None


def kill_group(pid):
    # Its ffmpeg children go with it: they share its process group.
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


class Supervisor:
    """Starts the pipeline on demand, and stops it on idle, on a stall or when it exits."""

    def __init__(self):
        self.lock = threading.Lock()
        self.process = None
        self.started_at = 0.0
        self.last_demand = None
        self.next_start = 0.0
        self.last_refusal = None

    def note_demand(self):
        with self.lock:
            self.last_demand = time.monotonic()

    def _stop(self):
        if self.process is not None:
            kill_group(self.process.pid)
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                print("pipeline did not exit after SIGKILL", file=sys.stderr, flush=True)
            self.process = None
        shutil.rmtree(OUTPUT, ignore_errors=True)

    def _start(self, now):
        free = free_gpu_mib()
        if not enough_gpu_memory(free):
            self.last_refusal = f"not enough free GPU memory: {free} MiB"
            print(self.last_refusal, file=sys.stderr, flush=True)
            self.next_start = now + RESTART_BACKOFF_SECONDS
            return
        self.last_refusal = None
        shutil.rmtree(OUTPUT, ignore_errors=True)
        OUTPUT.mkdir(parents=True)
        self.process = subprocess.Popen(
            [sys.executable, str(HERE / "pipeline.py"), "--source", SOURCE, "--out", str(OUTPUT), "--model", str(MODELS / MODEL)],
            start_new_session=True,
        )
        self.started_at = now

    def _last_output(self, now):
        """When the playlist was last written, on the same clock as `now`."""
        try:
            return now - (time.time() - (OUTPUT / "index.m3u8").stat().st_mtime)
        except OSError:
            return None

    def tick(self):
        with self.lock:
            now = time.monotonic()
            if idle_expired(now, self.last_demand):
                self._stop()
            elif self.process is None:
                if now >= self.next_start:
                    self._start(now)
            elif self.process.poll() is not None or has_stalled(now, self.started_at, self._last_output(now)):
                print(f"pipeline ended or stalled, exit {self.process.poll()}", file=sys.stderr, flush=True)
                self._stop()
                self.next_start = now + RESTART_BACKOFF_SECONDS

    def status(self):
        with self.lock:
            return {
                "running": self.process is not None and self.process.poll() is None,
                "model": MODEL,
                "lastRefusal": self.last_refusal,
            }

    def kill_from_signal(self):
        """Takes no lock and waits on nothing: a signal handler can interrupt either."""
        process = self.process
        if process is not None:
            kill_group(process.pid)
        shutil.rmtree(OUTPUT, ignore_errors=True)


supervisor = Supervisor()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def _send(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _unavailable(self):
        self._send(503, b'{"error":"not ready"}', "application/json")

    def do_GET(self):
        name = self.path.split("?", 1)[0].lstrip("/")
        if name == "status":
            self._send(200, json.dumps(supervisor.status()).encode(), "application/json")
            return
        if not is_served_name(name):
            self._send(404, b'{"error":"not found"}', "application/json")
            return
        supervisor.note_demand()
        target = OUTPUT / name
        try:
            body = target.read_bytes()
        except OSError:
            self._unavailable()
            return
        self._send(200, body, CONTENT_TYPES[target.suffix])

    do_HEAD = do_GET


def supervise():
    while True:
        try:
            supervisor.tick()
        except Exception:  # noqa: BLE001 - this loop dying would leave the pipeline unmanaged
            traceback.print_exc()
        time.sleep(1)


def main():
    threading.Thread(target=supervise, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)

    def stop(*_args):
        supervisor.kill_from_signal()
        os._exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    server.serve_forever()


if __name__ == "__main__":
    main()
