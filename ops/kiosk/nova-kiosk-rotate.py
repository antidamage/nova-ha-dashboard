#!/usr/bin/env python3
"""Rotate the kiosk display 90 degrees clockwise when the dashboard asks.

The dashboard's rotate button calls `window.novaKioskRotate("clockwise")`. This
service puts that function on the kiosk page over CDP (a Runtime binding) and
turns the output with kscreen-doctor, so the browser's viewport changes and the
dashboard picks its landscape or portrait layout on its own.

It reads no camera and asks no model. It records the rotation it applied for
the two things that correct the built-in camera's picture to the panel: the
face witness (state.json) and the face preview (localStorage over CDP).

    nova-kiosk-rotate.py            run the service
    nova-kiosk-rotate.py rotate     turn the display one step now and exit
    nova-kiosk-rotate.py status     print the output's current rotation

See nova-ha-dashboard/specs/kiosk-display-rotation.md.
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

LOG = logging.getLogger("kiosk-rotate")

CDP = os.environ.get("ROTATE_CDP", "http://127.0.0.1:9223")
OUTPUT = os.environ.get("ROTATE_OUTPUT", "")  # empty = the first connected output
CAMERA_MATCH = os.environ.get("ROTATE_CAMERA", "USB2.0 HD")
STATE_DIR = Path(os.environ.get("ROTATE_STATE_DIR", "/var/lib/nova-kiosk-rotate"))
STATE = STATE_DIR / "state.json"
BINDING = "novaKioskRotate"
# A rotation takes a moment to settle; a second tap inside it is the same tap.
DEBOUNCE_SECONDS = 1.5

# Clockwise turn of the picture, in kscreen's names. `left` is the clockwise
# one: `right` is where a panel physically turned clockwise sits, and it turns
# the picture the other way.
NEXT_CLOCKWISE = {"normal": "left", "left": "inverted", "inverted": "right", "right": "normal"}
KSCREEN_CODE = {1: "normal", 2: "left", 4: "inverted", 8: "right"}
# Room turned clockwise in the camera frame by c degrees, per rotation.
CARDINAL = {"normal": 0, "left": 90, "inverted": 180, "right": 270}


def backend_url() -> str:
    try:
        for line in Path("~/.config/nova-kiosk/backend.env").expanduser().read_text().splitlines():
            if line.strip().startswith("NOVA_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return "http://127.0.0.1/"


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


def camera_rules(rotation: str) -> list[dict]:
    return [{"match": CAMERA_MATCH, "degrees": (360 - CARDINAL[rotation]) % 360}]


def write_state(rotation: str) -> None:
    state = {
        "rotation": rotation,
        "cameraCorrection": (360 - CARDINAL[rotation]) % 360,
        "camera": CAMERA_MATCH,
        "updatedAt": int(time.time()),
    }
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state))
    os.replace(tmp, STATE)


def recorded_rotation() -> str | None:
    try:
        rotation = json.loads(STATE.read_text()).get("rotation")
    except (OSError, ValueError):
        return None
    return rotation if rotation in CARDINAL else None


def live_rotation() -> str | None:
    """What the output reads now, falling back to the last rotation recorded."""
    try:
        output = current_output()
    except (OSError, subprocess.SubprocessError):
        output = None
    return output[1] if output else recorded_rotation()


def rotate_clockwise() -> str | None:
    """Advance the output one step. Returns the rotation now applied."""
    output = current_output()
    if not output:
        LOG.warning("no panel output found")
        return None
    name, have = output
    wanted = NEXT_CLOCKWISE[have]
    LOG.info("rotating %s: %s -> %s", name, have, wanted)
    kscreen(f"output.{name}.rotation.{wanted}")
    applied = current_output()
    if not applied or applied[1] != wanted:
        LOG.warning("kscreen did not apply %s (output reads %s)", wanted, applied)
        return None
    write_state(wanted)
    return wanted


class Page:
    """The kiosk page over CDP: the binding in, the camera rule out."""

    def __init__(self) -> None:
        self.backend = backend_url().rstrip("/")
        self.ws = None
        self.next_id = 0
        self.last_rotation = 0.0

    def send(self, method: str, params: dict | None = None) -> None:
        self.next_id += 1
        self.ws.send(json.dumps({"id": self.next_id, "method": method, "params": params or {}}))

    def push_rules(self, rotation: str | None) -> None:
        if not rotation:
            return
        # Also tell the page which way it is turned: the rotate modal holds still
        # against the screen by counter-rotating itself (specs/kiosk-display-rotation.md).
        script = (
            "try{localStorage.setItem('nova.kiosk.cameraRotations',%s);"
            "window.dispatchEvent(new Event('nova:kiosk-camera-rotation'))}catch(e){}"
            "try{window.__novaKioskRotation=%s;"
            "window.dispatchEvent(new CustomEvent('nova:kiosk-rotation',{detail:%s}))}catch(e){}"
        ) % (json.dumps(json.dumps(camera_rules(rotation))), json.dumps(rotation), json.dumps(rotation))
        self.send("Runtime.evaluate", {"expression": script})

    def target(self):
        with urllib.request.urlopen(CDP + "/json/list", timeout=4) as response:
            for target in json.load(response):
                if target.get("type") == "page" and target.get("url", "").startswith(self.backend):
                    return target
        return None

    def on_binding(self) -> None:
        now = time.monotonic()
        if now - self.last_rotation < DEBOUNCE_SECONDS:
            LOG.info("tap ignored: still settling")
            return
        self.last_rotation = now
        self.push_rules(rotate_clockwise())

    def run(self) -> None:
        import websocket  # python3-websocket

        while True:
            try:
                target = self.target()
                if not target:
                    time.sleep(5)
                    continue
                self.ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=None, suppress_origin=True)
                self.send("Runtime.enable")
                self.send("Runtime.addBinding", {"name": BINDING})
                self.send("Page.enable")
                LOG.info("attached to the kiosk page")
                self.push_rules(live_rotation())
                while True:
                    message = json.loads(self.ws.recv())
                    method = message.get("method")
                    params = message.get("params", {})
                    if method == "Runtime.bindingCalled" and params.get("name") == BINDING:
                        self.on_binding()
                    elif method == "Page.frameNavigated" and not params.get("frame", {}).get("parentId"):
                        self.push_rules(live_rotation())
            except Exception as error:
                LOG.debug("cdp: %s", error)
            self.ws = None
            time.sleep(5)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    command = sys.argv[1] if len(sys.argv) > 1 else "run"
    if command == "rotate":
        sys.exit(0 if rotate_clockwise() else 1)
    if command == "status":
        print(current_output())
        sys.exit(0)
    Page().run()
