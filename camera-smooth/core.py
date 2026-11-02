"""The smooth pipeline's decisions, with no I/O. specs/camera-smooth-delivery.md."""

import re
from dataclasses import dataclass

SOURCE_FPS = 30
OUTPUT_FPS = 60
FRAME_BUDGET_SECONDS = 1 / SOURCE_FPS
# How far over budget the pipeline may run before it stops generating frames. Small
# enough to catch a real shortfall, large enough to ignore a few slow frames.
MAX_DEBT_SECONDS = 1.0
IDLE_STOP_SECONDS = 20
MIN_FREE_GPU_MIB = 2000
# A running pipeline writes a playlist every second. This long without one is a stall.
STALL_SECONDS = 15
RESTART_BACKOFF_SECONDS = 5
# A live viewer waits this long after the last request for a position stream before
# taking the pipeline back. The card has room for one, and asking for a position is the
# more deliberate act.
POSITION_HOLD_SECONDS = 3
# Output is confined to one flat directory, so only these names are ever served.
SERVED_NAME = re.compile(r"index\.m3u8|seg_\d{1,9}\.ts")
STREAM_PATH = re.compile(r"at/(recording|range_\d{1,16})/(\d{1,16})/(0\.5|1)/(index\.m3u8|seg_\d{1,9}\.ts)")
RENDER_PATH = re.compile(r"render/(range_\d{1,16})\.mp4")


@dataclass(frozen=True)
class RateProfile:
    """What one playback rate asks of the pipeline, at 60 fps output in real time."""

    width: int
    height: int
    # Output frames per source frame: this many minus one are generated.
    frames_per_source: int


# 720p cannot hold three generated frames per source frame: measured 43 fps on the RTX
# 2080 Ti. 960x540 measured 67 fps.
RATE_PROFILES = {
    "1": RateProfile(1280, 720, 2),
    "0.5": RateProfile(960, 540, 4),
}


class FrameBudget:
    """Whether to generate the next frames or repeat one to stay in real time.

    Counts only the time spent working, never time spent waiting for the source: the
    source arrives as whole segments, so a full queue says nothing about keeping up.
    `seconds_per_source_frame` is how much real time one source frame gets.
    """

    def __init__(self, seconds_per_source_frame=FRAME_BUDGET_SECONDS):
        self.debt = 0.0
        self.allowance = seconds_per_source_frame

    def should_generate(self):
        return self.debt <= MAX_DEBT_SECONDS

    def record(self, busy_seconds):
        self.debt = max(0.0, self.debt + busy_seconds - self.allowance)


def source_frame_seconds(rate):
    return 1 / (SOURCE_FPS * float(rate))


@dataclass(frozen=True)
class Job:
    """One thing the pipeline can be doing. Equal jobs share a run."""

    source: str = "live"
    start: int = 0
    rate: str = "1"

    @property
    def is_live(self):
        return self.source == "live"


LIVE = Job()


def parse_stream_path(path):
    """A request's job and the flat file name it wants, or None if it is not one of ours."""
    if SERVED_NAME.fullmatch(path):
        return LIVE, path
    match = STREAM_PATH.fullmatch(path)
    if match is None:
        return None
    return Job(match.group(1), int(match.group(2)), match.group(3)), match.group(4)


def parse_render_path(path):
    match = RENDER_PATH.fullmatch(path)
    return match.group(1) if match else None


def source_args(job, base_url, camera="outside"):
    """Where a job reads from, as (url, ffmpeg input options). Ids here are already validated."""
    api = f"{base_url}/api"
    if job.is_live:
        return f"{api}/camera-proxy/{camera}/index.m3u8", ["-live_start_index", "-2"]
    pace = ["-readrate", job.rate]
    if job.source == "recording":
        # `start` is the wall-clock time of a segment; the route's playlist begins there.
        return f"{api}/camera-proxy/{camera}/index.m3u8?start={job.start}", ["-live_start_index", "0", *pace]
    # `start` is milliseconds into a saved range.
    return f"{api}/camera/{camera}/saved/{job.source}/index.m3u8", ["-ss", f"{job.start / 1000:.3f}", *pace]


def render_source_args(range_id, base_url, camera="outside"):
    """A download runs as fast as the card can go, so it has no pacing."""
    return f"{base_url}/api/camera/{camera}/saved/{range_id}/index.m3u8", []


def takes_over(current, wanted, seconds_since_demand):
    """Whether a request for `wanted` may replace `current` on the card."""
    if current is None or current == wanted:
        return True
    if wanted.is_live and not current.is_live:
        return seconds_since_demand >= POSITION_HOLD_SECONDS
    return True


def idle_expired(now, last_demand):
    return last_demand is None or now - last_demand >= IDLE_STOP_SECONDS


def enough_gpu_memory(free_mib):
    """An unreadable figure counts as not enough: voice comes first on this card."""
    return free_mib is not None and free_mib >= MIN_FREE_GPU_MIB


def has_stalled(now, started_at, last_output):
    return now - (last_output if last_output is not None else started_at) >= STALL_SECONDS
