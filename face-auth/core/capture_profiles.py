"""Per-surface capture profiles, and the streamed-still hold they back.

Which gates run is a property of the surface that asked for the sign-in, not
of the service — see `specs/login-surface.md` § Capture profiles. `FrameHold`
is the in-memory buffer `quick` streams stills into.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .constants import FRAME_STREAM_MAX_FRAMES, QUICK_IDLE_TIMEOUT_SECONDS, STREAM_GOOD_FRAMES


@dataclass(frozen=True)
class CaptureProfile:
    """One row of the profile table.

    `clip_min_seconds`/`clip_max_seconds` of None mean "use the service's
    configured bounds", which is how `standard` picks up the FACE_CLIP_*
    environment overrides without restating them.
    """

    name: str
    liveness: bool
    antispoof: bool
    single_image: bool = False
    # Stills posted one at a time to /frame, held against the nonce as
    # embeddings, and judged by /assert with no upload of its own. There is no
    # clip, so the clip bounds never apply. The frames themselves are not kept,
    # which is why a streamed profile can never run liveness or anti-spoof —
    # both need pixels or a landmark track across a clip.
    frame_stream: bool = False
    clip_min_seconds: float | None = None
    clip_max_seconds: float | None = None
    idle_timeout_seconds: int | None = None
    # None means "the service's configured value". Only `image` overrides these,
    # and only because one frame is all it has: a single still cannot clear a
    # 15-frame floor or win a 12-of-25 vote, and those two numbers are the whole
    # reason a still would otherwise be refused rather than judged.
    min_frames: int | None = None
    min_agreeing: int | None = None


CAPTURE_PROFILES: dict[str, CaptureProfile] = {
    "standard": CaptureProfile(name="standard", liveness=True, antispoof=True),
    # Two good stills, then stop (Adeline, 2026-09-11). Replaced a 1 s clip that
    # a low-frame-rate webcam could not deliver: it was refused clip_too_short /
    # clip_low_fps before a face was ever looked at. Either good frame may carry
    # the match.
    "quick": CaptureProfile(
        name="quick", liveness=False, antispoof=False, frame_stream=True,
        idle_timeout_seconds=QUICK_IDLE_TIMEOUT_SECONDS,
        min_frames=STREAM_GOOD_FRAMES, min_agreeing=1,
    ),
    "image": CaptureProfile(
        name="image", liveness=False, antispoof=False, single_image=True,
        idle_timeout_seconds=QUICK_IDLE_TIMEOUT_SECONDS,
        min_frames=1, min_agreeing=1,
    ),
}

DEFAULT_CAPTURE_PROFILE = "standard"


def capture_profile(name: str | None) -> CaptureProfile:
    """Resolve a submitted profile name, refusing anything unknown.

    An unknown name is not silently downgraded to `standard`: a caller asking
    for a profile this service does not have is a caller whose expectations do
    not match what would actually run, and guessing on its behalf is how a
    surface ends up believing it relaxed a gate that stayed on, or the reverse.
    """

    resolved = (name or DEFAULT_CAPTURE_PROFILE).strip().lower()
    profile = CAPTURE_PROFILES.get(resolved)
    if profile is None:
        raise ValueError(f"unknown capture profile: {resolved!r}")
    return profile


@dataclass
class HeldStream:
    """What /frame has gathered for one nonce: good detections and skip reasons."""

    started: float
    good: list = field(default_factory=list)
    rejections: list[str] = field(default_factory=list)
    analysed: int = 0


class FrameHold:
    """Per-nonce buffer for streamed stills, in memory only.

    Holds detections (box, landmarks, embedding), never pixels. Entries are
    dropped when /assert takes them, or by the sweep once they are older than
    `ttl_seconds` — the nonce they belong to has expired by then, so nothing can
    ever claim them.

    Not thread-safe on its own; the service calls it from the event loop only.
    """

    def __init__(
        self,
        *,
        good_needed: int = STREAM_GOOD_FRAMES,
        max_frames: int = FRAME_STREAM_MAX_FRAMES,
        ttl_seconds: float = 20.0,
    ) -> None:
        self.good_needed = good_needed
        self.max_frames = max_frames
        self.ttl_seconds = ttl_seconds
        self._held: dict[str, HeldStream] = {}

    def _sweep(self, now: float) -> None:
        stale = [nonce for nonce, held in self._held.items() if now - held.started > self.ttl_seconds]
        for nonce in stale:
            del self._held[nonce]

    def get(self, nonce: str, now: float) -> HeldStream:
        self._sweep(now)
        held = self._held.get(nonce)
        if held is None:
            held = self._held[nonce] = HeldStream(started=now)
        return held

    def complete(self, held: HeldStream) -> bool:
        return len(held.good) >= self.good_needed

    def exhausted(self, held: HeldStream) -> bool:
        return held.analysed >= self.max_frames

    def record(self, held: HeldStream, good: list, rejections: list[str]) -> None:
        """Fold one analysed still in. Only the first `good_needed` good frames are kept."""

        held.analysed += 1
        held.rejections.extend(rejections)
        room = self.good_needed - len(held.good)
        if room > 0:
            held.good.extend(good[:room])

    def take(self, nonce: str) -> HeldStream | None:
        return self._held.pop(nonce, None)
