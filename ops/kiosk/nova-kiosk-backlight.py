#!/usr/bin/env python3
"""Kiosk backlight: a touch brightens, idle fades to the dim level, then blank.

The page sends the period's settings over a CDP binding and is told each phase.
`restore` turns the display on at the last target. See specs/kiosk-backlight.md.
"""
from __future__ import annotations

import logging
import os
import queue
import select
import sys
import time
from pathlib import Path

from nova_kiosk_backlight_hw import Panel, Touch, ensure_powerdevil_dim_off
from nova_kiosk_backlight_page import PageLink
from nova_kiosk_backlight_settings import clamp_settings, save_settings, saved_settings

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
# "blank": minimum backlight under the page's black cover; "dpms": power off
# (an in-LCD touchscreen drops off USB then, so it cannot wake by touch).
OFF_MODE = os.environ.get("BACKLIGHT_OFF_MODE", "blank").strip().lower()
POWER_OFF = OFF_MODE == "dpms"
REPUSH_S = 5.0  # while dark, so a reloaded page goes black again and the page knows we are alive
POWER_SETTLE_S = 2.0  # touches right after a power change are panel noise
TICK_S = 0.05
HOLD_FLAG = Path("~/.config/nova-kiosk/backlight.hold").expanduser()


class Backlight:
    """The phases: rise, hold, dim, dark (at the dim level), off (blank)."""

    def __init__(self, panel: Panel, page: PageLink | None) -> None:
        self.panel = panel
        self.page = page
        self.target, self.dim, self.off = saved_settings()
        self.level = 0.0
        self.phase = "hold"
        self.phase_at = self.last_touch = time.monotonic()
        self.from_level = 0.0
        self.power_changed_at = 0.0
        self.last_pushed: tuple | None = None
        self.next_dpms_check = 0.0
        self.next_repush = 0.0
        self.seen_off = False
        self.dim_end = 0.0

    def dark(self) -> bool:
        return self.phase == "off" or self.level < SWALLOW_BELOW

    def blank(self) -> bool:
        return self.phase == "off" and not POWER_OFF

    def enter(self, phase: str, now: float, woke: bool = False) -> None:
        self.phase, self.phase_at, self.from_level = phase, now, self.level
        # Fixed at the start: a later, higher dim level never brightens a fade.
        self.dim_end = min(self.dim, self.level)
        self.panel.forget()
        LOG.info("%s at %.0f%% (target %.0f%%, dim %.0f%%, blank %s)", phase, self.level, self.target, self.dim, self.off)
        self.push(woke)

    def push(self, woke: bool = False) -> None:
        key = (self.phase, self.dark(), self.target, self.dim, self.off, self.blank())
        if not woke and key == self.last_pushed:
            return
        self.last_pushed = key
        if self.page:
            state = {"phase": self.phase, "level": round(self.level), "target": self.target, "dim": self.dim,
                     "off": self.off, "dark": self.dark(), "blank": self.blank()}
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

    def set_settings(self, target, dim, off, now: float) -> None:
        """A change applies at once while lit; while idle only if it makes the panel darker."""
        target, dim, off = clamp_settings(target, dim, off)
        if (target, dim, off) == (self.target, self.dim, self.off):
            return
        target_changed = target != self.target
        blank_set = off and not self.off
        self.target, self.dim, self.off = target, dim, off
        save_settings(target, dim, off)
        if self.phase in ("rise", "hold"):
            if target_changed:
                self.enter("rise", now)
        elif self.phase == "dim" and dim < self.dim_end:
            self.enter("dim", now)  # fade on down to the new, lower level
        elif self.phase == "dark" and dim < self.level - 0.5:
            self.enter("dim", now)
        elif self.phase == "dark" and blank_set:
            self.phase_at = now  # blank newly set: its 120 s starts now
        # Brighter waits for a touch: nothing lights an idle panel (sunrise).
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
            self.level = self.from_level + (self.dim_end - self.from_level) * share
            if share >= 1:
                self.level = self.dim_end
                self.enter("dark", now)
        elif self.phase == "dark" and self.off and elapsed >= OFF_AFTER_S:
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
    panel.set_percent(saved_settings()[0])
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
                    backlight.set_settings(message["target"], message.get("dim"), message.get("off"), time.monotonic())
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
