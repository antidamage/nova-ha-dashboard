"""The smooth pipeline's decisions, with no I/O. specs/camera-smooth-delivery.md."""

import re

SOURCE_FPS = 30
FRAME_BUDGET_SECONDS = 1 / SOURCE_FPS
# How far over budget the pipeline may run before it stops generating frames. Small
# enough to catch a real shortfall, large enough to ignore a few slow frames.
MAX_DEBT_SECONDS = 1.0
IDLE_STOP_SECONDS = 20
MIN_FREE_GPU_MIB = 2000
# A running pipeline writes a playlist every second. This long without one is a stall.
STALL_SECONDS = 15
RESTART_BACKOFF_SECONDS = 5
# Output is confined to one flat directory, so only these names are ever served.
SERVED_NAME = re.compile(r"index\.m3u8|seg_\d{1,9}\.ts")


class FrameBudget:
    """Whether to generate the next frame or repeat one to stay in real time.

    Counts only the time spent working, never time spent waiting for the source: the
    source arrives as whole segments, so a full queue says nothing about keeping up.
    """

    def __init__(self):
        self.debt = 0.0

    def should_generate(self):
        return self.debt <= MAX_DEBT_SECONDS

    def record(self, busy_seconds):
        self.debt = max(0.0, self.debt + busy_seconds - FRAME_BUDGET_SECONDS)


def is_served_name(name):
    return bool(SERVED_NAME.fullmatch(name))


def idle_expired(now, last_demand):
    return last_demand is None or now - last_demand >= IDLE_STOP_SECONDS


def enough_gpu_memory(free_mib):
    """An unreadable figure counts as not enough: voice comes first on this card."""
    return free_mib is not None and free_mib >= MIN_FREE_GPU_MIB


def has_stalled(now, started_at, last_output):
    return now - (last_output if last_output is not None else started_at) >= STALL_SECONDS
