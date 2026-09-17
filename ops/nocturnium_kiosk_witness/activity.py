"""Panel activity detection, read straight from evdev.

Moved verbatim from `ops/nocturnium-kiosk-witness.py`; see that entry point.
"""

from __future__ import annotations

import os
from pathlib import Path

from .config import LOG

# --------------------------------------------------------------------------
# Activity detection
# --------------------------------------------------------------------------
#
# Read directly from evdev rather than asking the desktop.
#
# The kiosk session on this host is WAYLAND (verified live, 2026-09-03:
# `loginctl show-session -p Type` reports `wayland`). XScreenSaver's idle
# extension and `xprintidle` are both X11-only and would silently never fire —
# a daemon watching an empty room and a daemon that cannot see input look
# exactly the same from outside. evdev is below the display server, so it works
# on Wayland, X11 and a bare console alike, and does not depend on a desktop
# D-Bus API surviving an upgrade.
#
# Reading an event device does NOT steal events from the compositor: each
# open file description gets its own buffer, so several readers each see every
# event. This is a passive observer.
#
# It needs the `input` group, which the unit grants with SupplementaryGroups
# rather than by changing the login account.


class Activity:
    """Has anyone touched the panel since the last poll?"""

    # Handlers that mean "a human input device". The audio jacks on this host
    # also present event nodes, and they would otherwise register as touches.
    HUMAN_HANDLERS = ("mouse", "kbd", "js")

    def __init__(self) -> None:
        self._files: list = []
        for path in self._device_paths():
            try:
                self._files.append(open(path, "rb", buffering=0))
            except OSError as error:
                LOG.debug("skipping %s: %s", path, error)
        if not self._files:
            raise RuntimeError(
                "no readable input devices. The service needs the `input` group "
                "(SupplementaryGroups=input in the unit) — /dev/input/event* is "
                "root:input 0660."
            )
        for handle in self._files:
            os.set_blocking(handle.fileno(), False)
        LOG.info("watching %d input device(s) for panel activity", len(self._files))

    @staticmethod
    def _device_paths() -> list[str]:
        """Event nodes belonging to human input devices, from /proc."""
        paths: list[str] = []
        try:
            lines = Path("/proc/bus/input/devices").read_text(encoding="utf-8").splitlines()
        except OSError as error:
            LOG.warning("could not enumerate input devices: %s", error)
            return paths

        # Blocks are separated by a blank line; only the Handlers row matters.
        handlers = ""
        for line in lines + [""]:
            if line.startswith("H: Handlers="):
                handlers = line.split("=", 1)[1]
                continue
            if line.strip():
                continue
            if handlers and any(marker in handlers for marker in Activity.HUMAN_HANDLERS):
                for token in handlers.split():
                    if token.startswith("event"):
                        paths.append(f"/dev/input/{token}")
            handlers = ""
        return paths

    def poll(self) -> bool:
        """True when at least one event arrived since the last call.

        Events are read and discarded — the content does not matter, only that
        a person did something.
        """
        touched = False
        for handle in self._files:
            while True:
                try:
                    chunk = handle.read(4096)
                except (BlockingIOError, InterruptedError):
                    break
                except OSError as error:
                    LOG.debug("read error on %s: %s", handle.name, error)
                    break
                if not chunk:
                    break
                touched = True
                if len(chunk) < 4096:
                    break
        return touched

    def drain(self) -> None:
        """Discard anything buffered, so the first poll is not a false touch."""
        self.poll()
