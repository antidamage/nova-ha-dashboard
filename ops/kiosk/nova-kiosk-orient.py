#!/usr/bin/env python3
"""Rotate the kiosk desktop to match the panel's physical orientation.

The built-in webcam is fixed to the panel, so the room's rotation in its
picture is the panel's rotation in the world. Each reading matches ORB
features against a stored upright reference (keypoints and descriptors only,
never pixels) and rotates the desktop with kscreen-doctor.

Frames live in memory for one reading and are never written, logged or shown.
The browser is used only as a navigation signal over CDP; nothing is captured
through it.

    nova-kiosk-orient.py            run the daemon
    nova-kiosk-orient.py reference  store the upright reference (--force to replace)
    nova-kiosk-orient.py read       one reading, printed, nothing applied

See nova-ha-dashboard/specs/kiosk-display-rotation.md.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

import cv2
import numpy as np

LOG = logging.getLogger("kiosk-orient")


def env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


CAMERA_MATCH = os.environ.get("ORIENT_CAMERA", "USB2.0 HD")
FORBIDDEN_NAMES = ("macrosilicon", "2109", "lifecam")
POLL_SECONDS = env_float("ORIENT_POLL_SECONDS", 60.0)
SQUARE_DEGREES = env_float("ORIENT_SQUARE_DEGREES", 15.0)
BURST_INTERVAL = 1.0
BURST_SECONDS = 5.0
WARMUP_FRAMES = 8
MIN_INLIERS = 25
MIN_INLIER_RATIO = 0.25
CDP = os.environ.get("ORIENT_CDP", "http://127.0.0.1:9223")
OUTPUT = os.environ.get("ORIENT_OUTPUT", "")  # empty = the connected panel output

STATE_DIR = Path(os.environ.get("ORIENT_STATE_DIR", "/var/lib/nova-kiosk-orient"))
REFERENCE = STATE_DIR / "reference.npz"
STATE = STATE_DIR / "state.json"

# Room turned clockwise in the frame by c degrees -> kscreen rotation.
ROTATION_FOR_CARDINAL = {0: "normal", 90: "left", 180: "inverted", 270: "right"}
KSCREEN_CODE = {1: "normal", 2: "left", 4: "inverted", 8: "right"}


def backend_url() -> str:
    try:
        for line in Path("~/.config/nova-kiosk/backend.env").expanduser().read_text().splitlines():
            if line.strip().startswith("NOVA_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return "http://127.0.0.1/"


# --------------------------------------------------------------------------
# Capture and analysis
# --------------------------------------------------------------------------


def resolve_camera() -> str | None:
    base = Path("/sys/class/video4linux")
    try:
        nodes = sorted((n.name for n in base.iterdir() if n.name.startswith("video")), key=lambda n: int(n[5:] or 0))
    except OSError:
        return None
    for node in nodes:
        try:
            name = (base / node / "name").read_text().strip()
        except OSError:
            continue
        lower = name.lower()
        # The IR node carries its own name ("USB2.0 IR"), so the substring
        # match on "USB2.0 HD" already skips it.
        if CAMERA_MATCH.lower() in lower and not any(bad in lower for bad in FORBIDDEN_NAMES):
            return f"/dev/{node}"
    return None


def grab_gray() -> np.ndarray | None:
    """One frame, in memory, as grayscale. None when the camera is unavailable."""
    device = resolve_camera()
    if not device:
        LOG.warning("built-in camera (%s) not found", CAMERA_MATCH)
        return None
    cap = cv2.VideoCapture(device, cv2.CAP_V4L2)
    try:
        if not cap.isOpened():
            LOG.info("camera %s busy or unreadable", device)
            return None
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        frame = None
        for _ in range(WARMUP_FRAMES + 1):
            ok, frame = cap.read()
            if not ok:
                return None
        return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    finally:
        cap.release()


_orb = cv2.ORB_create(nfeatures=1500)
_clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))


def features(gray: np.ndarray):
    keypoints, descriptors = _orb.detectAndCompute(_clahe.apply(gray), None)
    points = np.float32([k.pt for k in keypoints]) if keypoints else np.zeros((0, 2), np.float32)
    return points, descriptors


def measure(gray: np.ndarray, ref_points: np.ndarray, ref_desc: np.ndarray) -> dict:
    """`{confident, angle, cardinal, deviation, inliers}`; angle is the room's clockwise turn."""
    points, desc = features(gray)
    result = {"confident": False, "angle": None, "cardinal": None, "deviation": None, "inliers": 0}
    if desc is None or len(points) < MIN_INLIERS:
        return result
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(ref_desc, desc, k=2)
    good = [m for m, *rest in (p for p in pairs if len(p) == 2) if m.distance < 0.75 * rest[0].distance]
    if len(good) < MIN_INLIERS:
        return result
    src = ref_points[[m.queryIdx for m in good]]
    dst = points[[m.trainIdx for m in good]]
    matrix, mask = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=6.0)
    if matrix is None:
        return result
    inliers = int(mask.sum())
    angle = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0])) % 360
    cardinal = int(round(angle / 90.0)) % 4 * 90
    deviation = abs((angle - cardinal + 180) % 360 - 180)
    result.update(
        inliers=inliers,
        angle=round(angle, 1),
        cardinal=cardinal,
        deviation=round(deviation, 1),
        confident=inliers >= MIN_INLIERS and inliers / len(good) >= MIN_INLIER_RATIO,
    )
    return result


def load_reference():
    data = np.load(REFERENCE)
    return data["points"], data["descriptors"]


def read_once(reference) -> dict:
    gray = grab_gray()
    if gray is None:
        return {"confident": False, "reason": "camera"}
    try:
        return measure(gray, *reference)
    finally:
        del gray


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


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    command = sys.argv[1] if len(sys.argv) > 1 else "run"
    if command == "reference":
        sys.exit(take_reference("--force" in sys.argv))
    if command == "read":
        sys.exit(self_check())
    sys.exit(daemon())
