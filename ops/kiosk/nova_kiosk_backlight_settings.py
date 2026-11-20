"""The kiosk backlight's saved settings, for nova-kiosk-backlight.py.

The page's current period: the lit target, the dim level and whether to blank.
Kept across reboots, so a restart at night rises to the night target, not 100%.
See nova-ha-dashboard/specs/kiosk-backlight.md.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

LOG = logging.getLogger("kiosk-backlight")

STATE = Path("~/.config/nova-kiosk/backlight-target.json").expanduser()


def clamp_settings(target, dim, off) -> tuple[float, float, bool]:
    """The page's period settings. An older page sends only a target: dim to 0, then blank."""
    target = max(1.0, min(100.0, round(float(target))))
    dim = max(0.0, min(target, round(float(dim)))) if dim is not None else 0.0
    return target, dim, bool(off) if off is not None else True


def saved_settings() -> tuple[float, float, bool]:
    try:
        data = json.loads(STATE.read_text())
        return clamp_settings(data["target"], data.get("dim"), data.get("off"))
    except (OSError, ValueError, KeyError, TypeError):
        return 100.0, 0.0, True


def save_settings(target: float, dim: float, off: bool) -> None:
    try:
        tmp = STATE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"target": target, "dim": dim, "off": off}))
        os.replace(tmp, STATE)
    except OSError as error:
        LOG.warning("could not save the settings: %s", error)
