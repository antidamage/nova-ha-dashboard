"""The decision loop: detect change locally, ask DeepSeek which way is up.

The local ORB match answers one question only — has the view moved since the
frame we last acted on? It is not allowed to decide orientation on its own,
because that is what failed overnight 2026-09-19/20: a spurious *confident*
`0.0 deg` reading in a dark room rotated the panel out of `right` and left it
wrong all morning, with readings of 268 and 275 either side of it.

So a rotation now needs either DeepSeek's answer, or — when DeepSeek cannot be
reached (Adeline, 2026-09-20) — a confident local match. DeepSeek is also
asked hourly regardless, so a matcher that has quietly gone blind gets
corrected rather than simply staying silent.

See specs/kiosk-display-rotation.md.
"""

from __future__ import annotations

import threading
import time

from .config import (
    LOG,
    POLL_SECONDS,
    SETTLE_INTERVAL,
    SETTLE_SECONDS,
    SQUARE_DEGREES,
    VLM_INTERVAL_SECONDS,
)
from .orientation import ask_cardinal
from .people import person_in
from .vision import grab_frame, load_retained, read_once, save_retained
from . import runtime
from .runtime import Browser, apply, last_cardinal, retained_cardinal, vlm_asked_at


def turn_from_retained(reading: dict) -> float | None:
    """How far the view has turned since the retained frame, 0-180."""
    angle = reading.get("angle")
    if angle is None:
        return None
    return abs((angle + 180) % 360 - 180)


def settle(retained, reading: dict):
    """Re-read until two consecutive readings agree, so we do not spend an API
    call on a frame caught mid-turn. The last reading is used either way."""
    deadline = time.monotonic() + SETTLE_SECONDS
    previous = turn_from_retained(reading)
    while time.monotonic() < deadline:
        time.sleep(SETTLE_INTERVAL)
        nxt = read_once(retained)
        if nxt.get("frame") is None:
            continue
        reading = nxt
        current = turn_from_retained(reading)
        if previous is not None and current is not None and abs(current - previous) <= SQUARE_DEGREES:
            LOG.info("settled at %.1f deg from the retained frame", current)
            return reading
        previous = current
    LOG.info("never settled; using the last reading")
    return reading


def local_cardinal(reading: dict) -> int | None:
    """The fallback: the retained frame's cardinal plus the measured turn."""
    if not reading.get("confident") or reading.get("angle") is None:
        return None
    base = retained_cardinal()
    if base is None:
        return None
    return int(round((base + reading["angle"]) / 90.0)) % 4 * 90


def evaluate() -> None:
    retained = load_retained()
    reading = read_once(retained)
    frame = reading.pop("frame", None)
    if frame is None:
        LOG.info("no frame: %s", reading.get("reason", "camera"))
        return

    due = (time.time() - vlm_asked_at()) >= VLM_INTERVAL_SECONDS
    turn = turn_from_retained(reading)
    moved = retained is None or not reading.get("confident") or (turn is not None and turn > SQUARE_DEGREES)
    LOG.info("reading %s turn=%s moved=%s hourly_due=%s", reading, turn, moved, due)
    if not moved and not due:
        return

    # Settling measures change against the retained frame, so there is nothing
    # to settle when there is no retained frame to measure against.
    if moved and retained is not None:
        reading = settle(retained, dict(reading, frame=frame))
        frame = reading.pop("frame", frame)

    # Confirm what we already believe before trying the alternatives: the
    # rotation now applied, then what the local match thinks it has become.
    prefer = [c for c in (last_cardinal(), local_cardinal(reading)) if c is not None]
    cardinal = ask_cardinal(frame, prefer=prefer)
    from_vlm = cardinal is not None
    if cardinal is None:
        cardinal = local_cardinal(reading)
        if cardinal is None:
            LOG.info("no orientation from DeepSeek and no confident local match; leaving the panel alone")
            return
        LOG.info("falling back to the local match: cardinal %d", cardinal)

    # The frame we just acted on becomes the reference for "has it moved?" —
    # but only when the model confirmed it, so a fallback guess cannot quietly
    # become the new baseline. A fallback rotation therefore leaves the
    # retained frame, and `retainedCardinal` with it, exactly where they were.
    stored = save_retained(frame) if from_vlm else False
    apply(cardinal, vlm_asked=from_vlm, retained=cardinal if stored else None)


def daemon() -> int:
    runtime.BROWSER = Browser(wake := threading.Event())
    runtime.BROWSER.start()
    LOG.info(
        "polling every %.0f s; change threshold %.0f deg; DeepSeek at least every %.0f s",
        POLL_SECONDS,
        SQUARE_DEGREES,
        VLM_INTERVAL_SECONDS,
    )
    while True:
        wake.clear()
        try:
            evaluate()
        except Exception:
            LOG.exception("reading failed")
        wake.wait(POLL_SECONDS)


def seed() -> int:
    """Establish the retained frame now, from DeepSeek's answer."""
    frame = grab_frame()
    if frame is None:
        print("camera unavailable")
        return 1
    cardinal = ask_cardinal(frame)
    if cardinal is None:
        print("DeepSeek gave no usable orientation (a person in frame blocks the send)")
        return 1
    stored = save_retained(frame)
    apply(cardinal, vlm_asked=True, retained=cardinal if stored else None)
    print(f"cardinal {cardinal}; retained frame {'stored' if stored else 'NOT stored'}")
    return 0


def check() -> int:
    """One full pass, printed, nothing applied."""
    retained = load_retained()
    reading = read_once(retained)
    frame = reading.pop("frame", None)
    if frame is None:
        print("camera unavailable")
        return 1
    print("retained frame:", "present" if retained is not None else "none")
    print("reading:", reading, "turn:", turn_from_retained(reading))
    print("person in frame:", person_in(frame))
    prefer = [c for c in (last_cardinal(), local_cardinal(reading)) if c is not None]
    print("deepseek cardinal:", ask_cardinal(frame, prefer=prefer))
    print("local fallback cardinal:", local_cardinal(reading))
    return 0
