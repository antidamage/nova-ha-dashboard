"""Display rotation, the CDP browser thread, and the daemon commands.

Moved verbatim from `ops/kiosk/nova-kiosk-orient.py`; see that entry point.
These three sections share the module-global `BROWSER`, which `daemon()`
rebinds and `write_state()` reads, so they stay in one module.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

import cv2
import numpy as np

from .config import (
    BURST_INTERVAL,
    BURST_SECONDS,
    CAMERA_MATCH,
    CDP,
    KSCREEN_CODE,
    LOG,
    OUTPUT,
    POLL_SECONDS,
    REFERENCE,
    ROTATION_FOR_CARDINAL,
    SQUARE_DEGREES,
    STATE,
    STATE_DIR,
    backend_url,
)
from .vision import features, grab_gray, load_reference, measure, read_once

# --------------------------------------------------------------------------
# Display
# --------------------------------------------------------------------------


def kscreen(*args: str) -> str:
    env = dict(os.environ)
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    env.setdefault("WAYLAND_DISPLAY", "wayland-0")
    done = subprocess.run(["kscreen-doctor", *args], capture_output=True, text=True, timeout=20, env=env)
    return re.sub(r"\x1b\[[0-9;]*m", "", done.stdout + done.stderr)


def current_output() -> tuple[str, str] | None:
    """`(output name, rotation name)` for the panel."""
    name = rotation = None
    for line in kscreen("-o").splitlines():
        header = re.match(r"Output: \d+ (\S+)", line)
        if header:
            if name and rotation and (not OUTPUT or name == OUTPUT):
                return name, rotation
            name, rotation = header.group(1), None
            continue
        code = re.match(r"\s*Rotation: (\d+)", line)
        if code:
            rotation = KSCREEN_CODE.get(int(code.group(1)), "normal")
    if name and rotation and (not OUTPUT or name == OUTPUT):
        return name, rotation
    return None


def apply(cardinal: int) -> None:
    wanted = ROTATION_FOR_CARDINAL[cardinal]
    output = current_output()
    if not output:
        LOG.warning("no panel output found")
        return
    name, have = output
    if have != wanted:
        LOG.info("rotating %s: %s -> %s", name, have, wanted)
        kscreen(f"output.{name}.rotation.{wanted}")
    write_state(cardinal, wanted)


def camera_rules(cardinal: int) -> list[dict]:
    return [{"match": CAMERA_MATCH, "degrees": (360 - cardinal) % 360}]


def write_state(cardinal: int, rotation: str) -> None:
    state = {
        "rotation": rotation,
        "cameraCorrection": (360 - cardinal) % 360,
        "camera": CAMERA_MATCH,
        "updatedAt": int(time.time()),
    }
    try:
        previous = json.loads(STATE.read_text())
    except (OSError, ValueError):
        previous = {}
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state))
    os.replace(tmp, STATE)
    if previous.get("cameraCorrection") != state["cameraCorrection"]:
        BROWSER.push_rules(camera_rules(cardinal))


def last_cardinal() -> int | None:
    try:
        return (360 - int(json.loads(STATE.read_text())["cameraCorrection"])) % 360
    except (OSError, ValueError, KeyError):
        return None


# --------------------------------------------------------------------------
# Browser: navigation signal in, preview rotation out. Nothing captured.
# --------------------------------------------------------------------------


class Browser(threading.Thread):
    def __init__(self, wake: threading.Event):
        super().__init__(daemon=True)
        self.wake = wake
        self.backend = backend_url().rstrip("/")
        self.ws = None
        self.lock = threading.Lock()
        self.next_id = 1000

    def _send(self, method: str, params: dict | None = None) -> None:
        with self.lock:
            if not self.ws:
                return
            self.next_id += 1
            self.ws.send(json.dumps({"id": self.next_id, "method": method, "params": params or {}}))

    def push_rules(self, rules: list[dict]) -> None:
        script = (
            "try{localStorage.setItem('nova.kiosk.cameraRotations',%s);"
            "window.dispatchEvent(new Event('nova:kiosk-camera-rotation'))}catch(e){}"
        ) % json.dumps(json.dumps(rules))
        try:
            self._send("Runtime.evaluate", {"expression": script})
        except Exception as error:  # a dropped socket is picked up by run()
            LOG.debug("push failed: %s", error)

    def _page(self):
        with urllib.request.urlopen(CDP + "/json/list", timeout=4) as response:
            for target in json.load(response):
                if target.get("type") == "page" and target.get("url", "").startswith(self.backend):
                    return target
        return None

    def _relevant(self, url: str) -> bool:
        if not url.startswith(self.backend):
            return False
        path = urllib.parse.urlparse(url).path or "/"
        return path == "/" or path.startswith("/config")

    def run(self) -> None:
        import websocket  # python3-websocket

        while True:
            try:
                target = self._page()
                if not target:
                    time.sleep(5)
                    continue
                ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=None, suppress_origin=True)
                with self.lock:
                    self.ws = ws
                self._send("Page.enable")
                LOG.info("watching kiosk page navigation")
                cardinal = last_cardinal()
                if cardinal is not None:
                    self.push_rules(camera_rules(cardinal))
                while True:
                    message = json.loads(ws.recv())
                    method = message.get("method")
                    params = message.get("params", {})
                    url = None
                    if method == "Page.frameNavigated" and not params.get("frame", {}).get("parentId"):
                        url = params["frame"].get("url", "")
                    elif method == "Page.navigatedWithinDocument":
                        url = params.get("url", "")
                    if url is not None and self._relevant(url):
                        LOG.info("page entered: %s", urllib.parse.urlparse(url).path or "/")
                        self.wake.set()
                        cardinal = last_cardinal()
                        if cardinal is not None:
                            self.push_rules(camera_rules(cardinal))
            except Exception as error:
                LOG.debug("cdp: %s", error)
            with self.lock:
                self.ws = None
            time.sleep(5)


class _NoBrowser:
    def push_rules(self, rules):
        pass


BROWSER = _NoBrowser()


# --------------------------------------------------------------------------
# Main loop
# --------------------------------------------------------------------------


def evaluate(reference) -> None:
    reading = read_once(reference)
    LOG.info("reading %s", {k: v for k, v in reading.items()})
    if not reading.get("confident"):
        return
    if reading["deviation"] <= SQUARE_DEGREES:
        apply(reading["cardinal"])
        return
    deadline = time.monotonic() + BURST_SECONDS
    while time.monotonic() < deadline:
        time.sleep(BURST_INTERVAL)
        reading = read_once(reference)
        LOG.info("recheck %s", reading)
        if reading.get("confident") and reading["deviation"] <= SQUARE_DEGREES:
            apply(reading["cardinal"])
            return
    LOG.info("not square after %.0f s; back to polling", BURST_SECONDS)


def daemon() -> int:
    if not REFERENCE.is_file():
        LOG.error("no reference at %s; run `%s reference` with the panel upright", REFERENCE, sys.argv[0])
        return 2
    global BROWSER
    reference = load_reference()
    wake = threading.Event()
    BROWSER = Browser(wake)
    BROWSER.start()
    LOG.info("polling every %.0f s; square within %.0f deg", POLL_SECONDS, SQUARE_DEGREES)
    while True:
        wake.clear()
        try:
            evaluate(reference)
        except Exception:
            LOG.exception("reading failed")
        wake.wait(POLL_SECONDS)


def take_reference(force: bool) -> int:
    if REFERENCE.exists() and not force:
        print(f"{REFERENCE} exists; pass --force to replace it")
        return 1
    gray = grab_gray()
    if gray is None:
        print("camera unavailable")
        return 1
    points, desc = features(gray)
    del gray
    if desc is None or len(points) < 200:
        print(f"only {len(points)} features; too little detail for a reference")
        return 1
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_DIR / "reference.tmp.npz"
    np.savez(tmp, points=points, descriptors=desc)
    os.replace(tmp, REFERENCE)
    print(f"reference stored: {len(points)} keypoints (no image kept)")
    return 0


def self_check() -> int:
    """A live reading, plus the same frame turned in memory, to prove the angle convention."""
    reference = load_reference()
    gray = grab_gray()
    if gray is None:
        print("camera unavailable")
        return 1
    print("live", measure(gray, *reference))
    print("cw90", measure(cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE), *reference))
    print("180", measure(cv2.rotate(gray, cv2.ROTATE_180), *reference))
    print("ccw90", measure(cv2.rotate(gray, cv2.ROTATE_90_COUNTERCLOCKWISE), *reference))
    del gray
    return 0
