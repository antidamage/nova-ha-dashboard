"""Display rotation, shared state, and the CDP browser thread.

Both sections share the module-global `BROWSER`, which `loop.daemon()` rebinds
and `write_state()` reads, so they stay in one module. The decision loop that
drives them is `loop.py`; see `ops/kiosk/nova-kiosk-orient.py`.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request

from .config import (
    CAMERA_MATCH,
    CDP,
    KSCREEN_CODE,
    LOG,
    OUTPUT,
    ROTATION_FOR_CARDINAL,
    STATE,
    backend_url,
)

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


def apply(cardinal: int, vlm_asked: bool = False, retained: int | None = None) -> None:
    wanted = ROTATION_FOR_CARDINAL[cardinal]
    output = current_output()
    if not output:
        LOG.warning("no panel output found")
        return
    name, have = output
    if have != wanted:
        LOG.info("rotating %s: %s -> %s", name, have, wanted)
        kscreen(f"output.{name}.rotation.{wanted}")
    write_state(cardinal, wanted, vlm_asked, retained)


def camera_rules(cardinal: int) -> list[dict]:
    return [{"match": CAMERA_MATCH, "degrees": (360 - cardinal) % 360}]


def read_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def vlm_asked_at() -> float:
    """When DeepSeek last gave a usable answer. 0 when it never has."""
    try:
        return float(read_state().get("vlmAskedAt") or 0)
    except (TypeError, ValueError):
        return 0.0


def retained_cardinal() -> int | None:
    """The cardinal the retained frame was stored at.

    Not the same as `last_cardinal()`: a fallback rotation moves the panel
    without replacing the retained frame, so the applied rotation drifts away
    from the frame the next turn is measured against. The local fallback has to
    add its measured turn to *this*.
    """
    value = read_state().get("retainedCardinal")
    return None if value is None else int(value) % 360


def write_state(cardinal: int, rotation: str, vlm_asked: bool = False, retained: int | None = None) -> None:
    previous = read_state()
    state = {
        "rotation": rotation,
        "cameraCorrection": (360 - cardinal) % 360,
        "camera": CAMERA_MATCH,
        "updatedAt": int(time.time()),
        "vlmAskedAt": time.time() if vlm_asked else previous.get("vlmAskedAt", 0),
        "retainedCardinal": previous.get("retainedCardinal") if retained is None else retained,
    }
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
