"""Ask DeepSeek which way a frame is facing.

The local ORB match can tell us the view has *moved*; nothing local can
reliably tell us which way is up. Measured 2026-09-20 on a real frame from
this camera: YuNet scored the wrong rotation higher than the right one
(0.69 at c=0 against 0.54 at the true c=270), and the room yielded only 11
Hough lines, too few for a structural tilt. Absolute orientation needs
semantics, so it goes to a vision model.

`deepseek-v4-flash-vision-exp` is an alias for the one `deepseek-flash`
backend, which does read images. "I cannot see the image" and an empty
`content` are both intermittent and are retried, not believed.

See specs/kiosk-display-rotation.md.
"""

from __future__ import annotations

import base64
import json
import re
import time
import urllib.error
import urllib.request

import cv2
import numpy as np

from .config import (
    DEEPSEEK_ATTEMPTS,
    DEEPSEEK_KEY,
    DEEPSEEK_MAX_TOKENS,
    DEEPSEEK_MODEL,
    DEEPSEEK_RETRY_SLEEP,
    DEEPSEEK_TIMEOUT,
    DEEPSEEK_URL,
    LOG,
)
from .people import UPRIGHT_ROTATIONS, person_in

# Measured 2026-09-20 against this model. Asked "which edge is nearest the
# ceiling?", it answered upright and upside-down photos correctly every time,
# but on a photo turned 90 or 270 it reasoned in circles and hit the token
# limit without ever answering — and 90/270 is exactly this panel's case.
#
# So it is never asked to interpret a sideways photo. Each candidate rotation
# is un-done first and the model is asked only to confirm an already-upright
# picture — a yes/no it answers in ~450 tokens, correctly, every time it
# answers at all.
QUESTION = (
    "Is this photo the right way up, with the ceiling at the top and the floor "
    "at the bottom? Answer with exactly one word: yes or no."
)

_BLIND = re.compile(r"can(?:no|'?)t\s+(?:see|view|access)|unable to (?:see|view)", re.I)


def _payload(frame: np.ndarray) -> bytes:
    ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok:
        raise ValueError("frame would not encode")
    image = base64.b64encode(buffer.tobytes()).decode("ascii")
    body = {
        "model": DEEPSEEK_MODEL,
        "max_tokens": DEEPSEEK_MAX_TOKENS,
        "temperature": 0,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": QUESTION},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image}"}},
                ],
            }
        ],
    }
    return json.dumps(body).encode()


def _ask_once(frame: np.ndarray) -> str | None:
    request = urllib.request.Request(
        DEEPSEEK_URL,
        data=_payload(frame),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {DEEPSEEK_KEY}"},
    )
    with urllib.request.urlopen(request, timeout=DEEPSEEK_TIMEOUT) as response:
        answer = json.load(response)
    try:
        choice = answer["choices"][0]
    except (KeyError, IndexError, TypeError):
        return None
    if choice.get("finish_reason") == "length" and not (choice.get("message") or {}).get("content"):
        LOG.info("deepseek ran out of tokens before answering; raise ORIENT_DEEPSEEK_MAX_TOKENS")
    return (choice.get("message") or {}).get("content") or None


def _verdict(text: str) -> bool | None:
    """True/False for a clear yes/no, None when the reply says nothing usable."""
    if _BLIND.search(text):
        return None
    words = re.findall(r"[a-z]+", text.lower())
    for word in reversed(words):  # the verdict lands at the end of any reasoning
        if word in ("yes", "upright", "correct"):
            return True
        if word in ("no", "rotated", "sideways", "inverted"):
            return False
    return None


def _is_upright(view: np.ndarray) -> bool | None:
    """Ask whether this already-upright candidate really is upright.

    Measured 2026-09-20: roughly one call in three comes back with empty
    content for a question the very next call answers. So an empty or
    unreadable reply is a retry signal, never a "no" — a flaky blank counted as
    a rejection would walk straight past the correct rotation. An explicit
    verdict, either way, is final and costs no further calls.
    """
    for attempt in range(1, DEEPSEEK_ATTEMPTS + 1):
        try:
            text = _ask_once(view)
        except (urllib.error.URLError, OSError, ValueError) as error:
            LOG.warning("deepseek attempt %d failed: %s", attempt, error)
            text = None
        if text:
            verdict = _verdict(text)
            if verdict is not None:
                return verdict
            LOG.info("attempt %d unusable: %r", attempt, text[:120])
        if attempt < DEEPSEEK_ATTEMPTS:
            time.sleep(DEEPSEEK_RETRY_SLEEP)
    return None


def ask_cardinal(frame: np.ndarray, prefer: list[int] | None = None) -> int | None:
    """The room's clockwise turn in this frame, or None if we could not tell.

    `prefer` orders the candidates, so the rotation we already believe in is
    confirmed in one call instead of four.
    """
    if not DEEPSEEK_KEY:
        LOG.warning("no DEEPSEEK_API_KEY; cannot ask for orientation")
        return None
    if person_in(frame):
        LOG.info("person in frame; not sending, will retry on the next tick")
        return None
    order = [c for c in (prefer or []) if c in UPRIGHT_ROTATIONS]
    order += [c for c in UPRIGHT_ROTATIONS if c not in order]
    asked = False
    for cardinal in order:
        turn = UPRIGHT_ROTATIONS[cardinal]
        verdict = _is_upright(frame if turn is None else cv2.rotate(frame, turn))
        if verdict is not None:
            asked = True
        if verdict:
            LOG.info("deepseek confirms cardinal %d is upright", cardinal)
            return cardinal
        LOG.info("cardinal %d: %s", cardinal, "not upright" if verdict is False else "no verdict")
    LOG.warning("no candidate confirmed upright%s", "" if asked else " (the model never answered)")
    return None
