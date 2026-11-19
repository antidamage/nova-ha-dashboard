#!/usr/bin/env python3
"""Wake the kiosk panel on touch, dim it after a while, then power it off.

A touch rises the backlight to the dashboard's adaptive target over 2 s; 30 s
after the last touch it dims to 0 over 30 s; 120 s at 0 powers the display off;
one tap powers it back on. The dashboard page supplies the target over a CDP
binding (window.novaKioskBacklight) and is told each phase, so it can swallow a
tap on a panel too dim to read.

    nova-kiosk-backlight.py           run the service
    nova-kiosk-backlight.py restore   display on at the last target, then exit

See nova-ha-dashboard/specs/kiosk-backlight.md.
"""
from __future__ import annotations

import json
import logging
import os
import queue
import select
import sys
import time
from pathlib import Path

from nova_kiosk_backlight_hw import Panel, Touch, ensure_powerdevil_dim_off
from nova_kiosk_backlight_page import PageLink

LOG = logging.getLogger("kiosk-backlight")


def setting(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


RISE_S = setting("BACKLIGHT_RISE_S", 2)
HOLD_S = setting("BACKLIGHT_HOLD_S", 30)
DIM_S = setting("BACKLIGHT_DIM_S", 30)
OFF_AFTER_S = setting("BACKLIGHT_OFF_AFTER_S", 120)
SWALLOW_BELOW = setting("BACKLIGHT_SWALLOW_BELOW_PCT", 25)
# "blank" keeps the panel powered at minimum backlight under the page's black
# cover; "dpms" powers it off. Nocturnium needs blank: its touchscreen is part of
# the LCD and drops off USB when the panel is powered off.
OFF_MODE = os.environ.get("BACKLIGHT_OFF_MODE", "blank").strip().lower()
POWER_OFF = OFF_MODE == "dpms"
REPUSH_S = 5.0  # while dark, so a reloaded page goes black again and the page knows we are alive
POWER_SETTLE_S = 2.0  # touches right after a power change are panel noise
TICK_S = 0.05
HOLD_FLAG = Path("~/.config/nova-kiosk/backlight.hold").expanduser()
# Kept across reboots: a restart at night must rise to the night target, not 100%.
STATE = Path("~/.config/nova-kiosk/backlight-target.json").expanduser()


def saved_target() -> float:
    try:
        return max(1.0, min(100.0, float(json.loads(STATE.read_text())["target"])))
    except (OSError, ValueError, KeyError, TypeError):
        return 100.0


def save_target(target: float) -> None:
    try:
        tmp = STATE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"target": target}))
        os.replace(tmp, STATE)
    except OSError as error:
        LOG.warning("could not save the target: %s", error)


class Backlight:
    """The phases: rise, hold, dim, dark, off."""

    def __init__(self, panel: Panel, page: PageLink | None) -> None:
        self.panel = panel
        self.page = page
        self.target = saved_target()
        self.level = 0.0
        self.phase = "hold"
        self.phase_at = self.last_touch = time.monotonic()
        self.from_level = 0.0
        self.power_changed_at = 0.0
        self.last_pushed: tuple | None = None
        self.next_dpms_check = 0.0
        self.next_repush = 0.0
        self.seen_off = False

    def dark(self) -> bool:
        return self.phase == "off" or self.level < SWALLOW_BELOW

    def blank(self) -> bool:
        return self.phase == "off" and not POWER_OFF

    def enter(self, phase: str, now: float, woke: bool = False) -> None:
        self.phase, self.phase_at, self.from_level = phase, now, self.level
        self.panel.forget()
        LOG.info("%s at %.0f%% (target %.0f%%)", phase, self.level, self.target)
        self.push(woke)

    def push(self, woke: bool = False) -> None:
        key = (self.phase, self.dark(), self.target, self.blank())
        if not woke and key == self.last_pushed:
            return
        self.last_pushed = key
        if self.page:
            state = {"phase": self.phase, "level": round(self.level), "target": self.target,
                     "dark": self.dark(), "blank": self.blank()}
            if woke:
                state["woke"] = True
            self.page.push(state)

    def wake(self, now: float) -> None:
        self.panel.set_percent(0)
        self.level = 0.0
        if POWER_OFF or self.seen_off or not self.panel.is_on():
            self.panel.power(True)
            self.power_changed_at = time.monotonic()
            deadline = time.monotonic() + POWER_SETTLE_S
            while not self.panel.is_on() and time.monotonic() < deadline:
                time.sleep(0.05)
        self.seen_off = False
        self.last_touch = time.monotonic()
        self.enter("rise", time.monotonic(), woke=True)

    def touch(self, now: float, contact: bool) -> None:
        if now - self.power_changed_at < POWER_SETTLE_S:
            return
        if self.phase in ("rise", "hold"):
            self.last_touch = now
        elif contact:
            self.last_touch = now
            if self.phase == "off":
                self.wake(now)
            else:
                self.enter("rise", now)

    def set_target(self, pct: float, now: float) -> None:
        pct = max(1.0, min(100.0, round(pct)))
        if pct == self.target:
            return
        self.target = pct
        save_target(pct)
        if self.phase in ("rise", "hold"):
            self.enter("rise", now)
        else:
            self.push()

    def tick(self, now: float) -> None:
        if HOLD_FLAG.exists():
            self.last_touch = now
            if self.phase not in ("rise", "hold"):
                if self.phase == "off":
                    self.wake(now)
                else:
                    self.enter("rise", now)
        elapsed = now - self.phase_at
        if self.phase == "rise":
            share = min(1.0, elapsed / RISE_S) if RISE_S > 0 else 1.0
            self.level = self.from_level + (self.target - self.from_level) * share
            if share >= 1:
                self.enter("hold", now)
        elif self.phase == "hold":
            self.level = self.target
            if now - self.last_touch >= HOLD_S:
                self.enter("dim", now)
        elif self.phase == "dim":
            share = min(1.0, elapsed / DIM_S) if DIM_S > 0 else 1.0
            self.level = self.from_level * (1 - share)
            if share >= 1:
                self.level = 0.0
                self.enter("dark", now)
        elif self.phase == "dark" and elapsed >= OFF_AFTER_S:
            if POWER_OFF:
                self.panel.power(False)
                self.power_changed_at = time.monotonic()
            self.enter("off", now)
        if self.phase != "off":
            self.panel.set_percent(self.level)
        if now >= self.next_dpms_check:
            self.next_dpms_check = now + 0.5
            self.check_power(now)
        if self.dark() and now >= self.next_repush:
            self.next_repush = now + REPUSH_S
            self.last_pushed = None
        self.push()

    def check_power(self, now: float) -> None:
        """Follow a power change something else made (KWin's double tap, a resume)."""
        if now - self.power_changed_at < POWER_SETTLE_S:
            return
        on = self.panel.is_on()
        if self.phase == "off" and on and (POWER_OFF or self.seen_off):
            LOG.info("display woke from elsewhere")
            self.seen_off = False
            self.last_touch = now
            self.level = 0.0
            self.enter("rise", now, woke=True)
        elif not on and not self.seen_off and (self.phase != "off" or not POWER_OFF):
            LOG.info("display was powered off from elsewhere")
            self.seen_off = True
            if self.phase != "off":
                self.enter("off", now)


def restore() -> int:
    panel = Panel(os.environ.get("BACKLIGHT_DRM_CONNECTOR", ""))
    panel.power(True)
    panel.set_percent(saved_target())
    return 0


def main() -> int:
    ensure_powerdevil_dim_off()
    inbox: queue.Queue = queue.Queue()
    page = PageLink(inbox)
    page.start()
    backlight = Backlight(Panel(os.environ.get("BACKLIGHT_DRM_CONNECTOR", "")), page)
    touch = Touch(os.environ.get("BACKLIGHT_TOUCH_DEVICE", ""))
    now = time.monotonic()
    if not backlight.panel.is_on():
        backlight.wake(now)  # a start counts as a touch, never a dark panel
    else:
        backlight.level = 0.0
        backlight.enter("rise", now)
    next_touch_open = 0.0
    while True:
        now = time.monotonic()
        if touch.fd is None and now >= next_touch_open:
            next_touch_open = now + 5
            touch.open()
        if touch.fd is not None:
            ready, _, _ = select.select([touch.fd], [], [], TICK_S)
            if ready:
                result = touch.read()
                # A failed device fails lit, unless the display is powered off,
                # when a touchscreen inside the panel is expected to vanish.
                if result is None:
                    if not (backlight.phase == "off" and (POWER_OFF or backlight.seen_off)):
                        backlight.touch(time.monotonic(), True)
                elif result[0]:
                    backlight.touch(time.monotonic(), result[1])
        else:
            time.sleep(TICK_S)
        while not inbox.empty():
            message = inbox.get_nowait()
            if not isinstance(message, dict):
                continue
            if "target" in message:
                try:
                    backlight.set_target(float(message["target"]), time.monotonic())
                except (TypeError, ValueError):
                    pass
            if message.get("activity"):
                backlight.touch(time.monotonic(), True)
            if message.get("attached"):
                backlight.last_pushed = None
                backlight.push()
        backlight.tick(time.monotonic())


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if len(sys.argv) > 1 and sys.argv[1] == "restore":
        sys.exit(restore())
    sys.exit(main())
