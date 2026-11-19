"""The kiosk panel's hardware, for nova-kiosk-backlight.py.

Brightness through KDE (KWin owns the backlight, so sysfs writes would be put
back), display power through kscreen-doctor, the power state from the DRM
connector's sysfs `dpms`, and the touchscreen's evdev node found by its udev
property. See nova-ha-dashboard/specs/kiosk-backlight.md.
"""
from __future__ import annotations

import glob
import logging
import os
import struct
import subprocess
from pathlib import Path

LOG = logging.getLogger("kiosk-backlight")

BRIGHTNESS_SERVICE = "org.kde.ScreenBrightness"
BRIGHTNESS_PATH = "/org/kde/ScreenBrightness/display0"
BRIGHTNESS_IFACE = "org.kde.ScreenBrightness.Display"
SUPPRESS_INDICATOR = 1
INTERNAL_CONNECTORS = ("eDP", "LVDS", "DSI")

# struct input_event on 64-bit Linux: timeval (two longs), type, code, value.
EVENT = struct.Struct("llHHi")
EV_KEY = 1
BTN_TOUCH = 330


def session_env() -> dict:
    env = dict(os.environ)
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    env.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path={env['XDG_RUNTIME_DIR']}/bus")
    return env


def run(*args: str, timeout: float = 5) -> str:
    done = subprocess.run(list(args), capture_output=True, text=True, timeout=timeout, env=session_env())
    return done.stdout.strip()


class Panel:
    """Brightness (as a percent) and display power."""

    def __init__(self, connector: str = "") -> None:
        self.connector = connector
        self.max = 0
        self.last_written: int | None = None

    def max_brightness(self) -> int:
        if not self.max:
            try:
                out = run("busctl", "--user", "get-property", BRIGHTNESS_SERVICE, BRIGHTNESS_PATH,
                          BRIGHTNESS_IFACE, "MaxBrightness")
                self.max = int(out.split()[-1])
            except (OSError, ValueError, IndexError, subprocess.SubprocessError):
                return 10000
        return self.max or 10000

    def set_percent(self, pct: float) -> None:
        value = round(max(0.0, min(100.0, pct)) / 100 * self.max_brightness())
        if value == self.last_written:
            return
        try:
            run("busctl", "--user", "call", BRIGHTNESS_SERVICE, BRIGHTNESS_PATH, BRIGHTNESS_IFACE,
                "SetBrightness", "iu", str(value), str(SUPPRESS_INDICATOR))
            self.last_written = value
        except (OSError, subprocess.SubprocessError) as error:
            LOG.warning("brightness %s failed: %s", value, error)
            self.max = 0

    def forget(self) -> None:
        """Write the next level even if it matches the last one (something else may have moved it)."""
        self.last_written = None

    def dpms_file(self) -> Path | None:
        for path in sorted(glob.glob("/sys/class/drm/card*-*")):
            name = path.split("-", 1)[1]
            if self.connector and name != self.connector:
                continue
            if not self.connector and not name.startswith(INTERNAL_CONNECTORS):
                continue
            try:
                if Path(path, "status").read_text().strip() != "connected":
                    continue
            except OSError:
                continue
            return Path(path, "dpms")
        return None

    def is_on(self) -> bool:
        """True unless the panel reads Off. Unknown counts as on (fail lit)."""
        path = self.dpms_file()
        if path:
            try:
                return path.read_text().strip() != "Off"
            except OSError:
                pass
        try:
            return "off" not in run("kscreen-doctor", "--dpms", "show").lower()
        except (OSError, subprocess.SubprocessError):
            return True

    def power(self, on: bool) -> None:
        try:
            run("kscreen-doctor", "--dpms", "on" if on else "off", timeout=10)
        except (OSError, subprocess.SubprocessError) as error:
            LOG.warning("dpms %s failed: %s", on, error)


def find_touchscreen(override: str = "") -> str | None:
    if override:
        return override
    for sys_dev in sorted(glob.glob("/sys/class/input/event*")):
        try:
            major_minor = Path(sys_dev, "dev").read_text().strip()
            data = Path(f"/run/udev/data/c{major_minor}").read_text()
        except OSError:
            continue
        if "E:ID_INPUT_TOUCHSCREEN=1" in data.splitlines():
            return "/dev/input/" + os.path.basename(sys_dev)
    return None


class Touch:
    """The touchscreen, read without a grab so KWin still gets every event."""

    def __init__(self, override: str = "") -> None:
        self.override = override
        self.fd: int | None = None
        self.path: str | None = None
        self.warned = False

    def open(self) -> bool:
        if self.fd is not None:
            return True
        self.path = find_touchscreen(self.override)
        if not self.path:
            if not self.warned:
                LOG.warning("no touchscreen found")
                self.warned = True
            return False
        try:
            self.fd = os.open(self.path, os.O_RDONLY | os.O_NONBLOCK)
        except OSError as error:
            if not self.warned:
                LOG.warning("cannot read %s: %s", self.path, error)
                self.warned = True
            return False
        LOG.info("reading touches from %s", self.path)
        self.warned = False
        return True

    def close(self) -> None:
        if self.fd is not None:
            try:
                os.close(self.fd)
            except OSError:
                pass
        self.fd = None

    def read(self) -> tuple[bool, bool] | None:
        """`(any event, a contact began)`, or None when the device failed."""
        try:
            data = os.read(self.fd, EVENT.size * 64)
        except BlockingIOError:
            return False, False
        except OSError as error:
            LOG.warning("touchscreen read failed: %s", error)
            self.close()
            return None
        if not data:
            self.close()
            return None
        contact = False
        for offset in range(0, len(data) - EVENT.size + 1, EVENT.size):
            _, _, kind, code, value = EVENT.unpack_from(data, offset)
            if kind == EV_KEY and code == BTN_TOUCH and value == 1:
                contact = True
        return True, contact


def ensure_powerdevil_dim_off() -> None:
    """Plasma's own idle dim multiplies the panel down and fights the ramps."""
    args = ["--file", "powerdevilrc", "--group", "AC", "--group", "Display", "--key", "DimDisplayWhenIdle"]
    try:
        if run("kreadconfig6", *args) == "false":
            return
        run("kwriteconfig6", *args, "--type", "bool", "false")
        run("qdbus6", "org.kde.Solid.PowerManagement", "/org/kde/Solid/PowerManagement", "refreshStatus")
        LOG.info("turned powerdevil's idle dim off again")
    except (OSError, subprocess.SubprocessError) as error:
        LOG.warning("could not check powerdevil's idle dim: %s", error)
