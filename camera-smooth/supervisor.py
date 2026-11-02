"""Runs one pipeline job at a time. specs/camera-smooth-delivery.md."""

import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from core import (
    RESTART_BACKOFF_SECONDS,
    enough_gpu_memory,
    has_stalled,
    idle_expired,
    render_source_args,
    source_args,
    takes_over,
)

HERE = Path(__file__).resolve().parent
DASHBOARD = os.environ.get("NOVA_CAMERA_SMOOTH_DASHBOARD", "http://127.0.0.1:3001")
MODELS = Path(os.environ.get("NOVA_CAMERA_SMOOTH_MODELS", "/opt/nova-camera-smooth/models"))
MODEL = os.environ.get("NOVA_CAMERA_SMOOTH_MODEL", "rife-v4.26")
OUTPUT = Path(os.environ.get("NOVA_CAMERA_SMOOTH_OUTPUT", "/dev/shm/nova-camera-smooth"))
# A position stream starts ahead of the viewer, and is held until the viewer's position
# reaches its start, so it keeps more than a live one.
POSITION_SEGMENTS_KEPT = 20
LIVE_SEGMENTS_KEPT = 6


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
    """Runs one job at a time, on demand, and stops it on idle, on a stall or when it exits."""

    def __init__(self):
        self.lock = threading.Lock()
        self.process = None
        self.job = None
        self.wanted = None
        self.finished = False
        self.render = None
        self.started_at = 0.0
        self.last_demand = None
        self.next_start = 0.0
        self.last_refusal = None

    def note_demand(self, job, may_claim):
        """Whether `job` is, or may become, what the card is doing."""
        with self.lock:
            now = time.monotonic()
            if self.render is not None:
                return False
            if self.wanted == job:
                self.last_demand = now
                return True
            since = now - self.last_demand if self.last_demand is not None else float("inf")
            # Only a playlist can claim the card: a late segment request from a viewer
            # who has moved on must not bring the old job back.
            if not may_claim or not takes_over(self.wanted, job, since):
                return False
            self.wanted = job
            self.last_demand = now
            return True

    def is_running(self, job):
        """Whether the output directory holds this job's files, rather than the last one's."""
        with self.lock:
            return self.job == job

    def _stop(self):
        if self.process is not None:
            kill_group(self.process.pid)
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                print("pipeline did not exit after SIGKILL", file=sys.stderr, flush=True)
            self.process = None
        self.job = None
        self.finished = False
        shutil.rmtree(OUTPUT, ignore_errors=True)

    def _refused_for_memory(self, now):
        free = free_gpu_mib()
        if enough_gpu_memory(free):
            self.last_refusal = None
            return False
        self.last_refusal = f"not enough free GPU memory: {free} MiB"
        print(self.last_refusal, file=sys.stderr, flush=True)
        self.next_start = now + RESTART_BACKOFF_SECONDS
        return True

    def _start(self, job, now):
        if self._refused_for_memory(now):
            return
        shutil.rmtree(OUTPUT, ignore_errors=True)
        OUTPUT.mkdir(parents=True)
        source, options = source_args(job, DASHBOARD)
        self.process = subprocess.Popen(
            [
                sys.executable, str(HERE / "pipeline.py"), "--source", source, "--input-options", json.dumps(options),
                "--out", str(OUTPUT), "--model", str(MODELS / MODEL), "--rate", job.rate,
                "--segments-kept", str(LIVE_SEGMENTS_KEPT if job.is_live else POSITION_SEGMENTS_KEPT),
            ],
            start_new_session=True,
        )
        self.job = job
        self.finished = False
        self.started_at = now

    def _last_output(self, now):
        """When the playlist was last written, on the same clock as `now`."""
        try:
            return now - (time.time() - (OUTPUT / "index.m3u8").stat().st_mtime)
        except OSError:
            return None

    def tick(self):
        with self.lock:
            if self.render is not None:
                return
            now = time.monotonic()
            if idle_expired(now, self.last_demand):
                self._stop()
                self.wanted = None
            elif self.job != self.wanted:
                self._stop()
                if now >= self.next_start:
                    self._start(self.wanted, now)
            elif self.finished:
                return
            elif self.process.poll() is not None:
                if self.job.is_live:
                    print(f"pipeline ended, exit {self.process.poll()}", file=sys.stderr, flush=True)
                    self._stop()
                    self.next_start = now + RESTART_BACKOFF_SECONDS
                else:
                    # A position stream reaching the end of its footage is done. Its last
                    # segments stay until nobody is asking.
                    self.process = None
                    self.finished = True
            elif has_stalled(now, self.started_at, self._last_output(now)):
                print("pipeline stalled", file=sys.stderr, flush=True)
                self._stop()
                self.next_start = now + RESTART_BACKOFF_SECONDS

    def start_render(self, range_id):
        """Takes the card for a download. The process's stdout is the MP4."""
        with self.lock:
            if self.render is not None:
                return None
            self._stop()
            self.wanted = None
            self.last_demand = None
            if self._refused_for_memory(time.monotonic()):
                return None
            source, options = render_source_args(range_id, DASHBOARD)
            self.render = subprocess.Popen(
                [
                    sys.executable, str(HERE / "pipeline.py"), "--source", source, "--input-options", json.dumps(options),
                    "--model", str(MODELS / MODEL), "--rate", "1",
                ],
                stdout=subprocess.PIPE, start_new_session=True,
            )
            return self.render

    def finish_render(self, process):
        with self.lock:
            kill_group(process.pid)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                print("render did not exit after SIGKILL", file=sys.stderr, flush=True)
            self.render = None

    def status(self):
        with self.lock:
            return {
                "running": self.process is not None and self.process.poll() is None,
                "rendering": self.render is not None,
                "job": self.job.source if self.job else None,
                "rate": self.job.rate if self.job else None,
                "model": MODEL,
                "lastRefusal": self.last_refusal,
            }

    def kill_from_signal(self):
        """Takes no lock and waits on nothing: a signal handler can interrupt either."""
        for process in (self.process, self.render):
            if process is not None:
                kill_group(process.pid)
        shutil.rmtree(OUTPUT, ignore_errors=True)
