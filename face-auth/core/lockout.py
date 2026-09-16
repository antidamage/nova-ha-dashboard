"""Lockout state and release-rate accounting."""

from __future__ import annotations

from dataclasses import dataclass

from .constants import LOCKOUT_FAILURES, LOCKOUT_WINDOW_SECONDS, RELEASE_MAX_PER_HOUR, RELEASE_WINDOW_SECONDS


@dataclass(frozen=True)
class LockoutState:
    """One row of the `lockouts` table, as a value.

    `armed` is the durable switch. It lives under the `global` scope in SQLite
    rather than in process memory, because restarting a container is the
    cheapest thing an attacker on the LAN can cause and a restart must not
    clear a lockout.
    """

    failures: int = 0
    window_start: float = 0.0
    armed: bool = True

    def as_dict(self) -> dict[str, object]:
        return {"failures": self.failures, "windowStart": self.window_start, "armed": self.armed}


def register_failure(
    state: LockoutState,
    now: float,
    *,
    max_failures: int = LOCKOUT_FAILURES,
    window_seconds: int = LOCKOUT_WINDOW_SECONDS,
) -> LockoutState:
    """Fold one refusal into a scope's counter and trip `armed` at the limit.

    The window is a fixed span from the first failure in it, not a sliding
    decay — an attacker cannot hold the counter open cheaply, and yesterday's
    failures cannot lock out today's login. Reaching `max_failures` sets
    `armed = False`, and nothing in this module ever sets it back: re-arming is
    a password + TOTP action, and it must not be reachable by presenting a face.
    """

    if state.window_start <= 0 or now - state.window_start >= window_seconds:
        failures, window_start = 1, now
    else:
        failures, window_start = state.failures + 1, state.window_start
    armed = state.armed and failures < max_failures
    return LockoutState(failures=failures, window_start=window_start, armed=armed)


def lockout_reason(
    state: LockoutState,
    now: float,
    *,
    max_failures: int = LOCKOUT_FAILURES,
    window_seconds: int = LOCKOUT_WINDOW_SECONDS,
) -> str | None:
    """`disarmed`, `locked_out`, or None. Never clears anything.

    Disarm is checked first because it is the durable state a human or a
    Discord veto set, and it outranks a counter that may have aged out.
    """

    if not state.armed:
        return "disarmed"
    if state.window_start > 0 and now - state.window_start < window_seconds and state.failures >= max_failures:
        return "locked_out"
    return None


def release_rate_exceeded(
    releases: list[float],
    now: float,
    *,
    max_per_hour: int = RELEASE_MAX_PER_HOUR,
    window_seconds: int = RELEASE_WINDOW_SECONDS,
) -> bool:
    """Would one more successful release exceed the cap in the rolling window?

    Successful releases are capped as well as failures because a spoof that
    works once can otherwise be replayed for fresh sessions indefinitely.
    Exceeding this is an attack signal, not backpressure: the caller disarms on
    it rather than asking the client to slow down.
    """

    if max_per_hour <= 0:
        return True
    recent = [stamp for stamp in releases if now - stamp < window_seconds]
    return len(recent) + 1 > max_per_hour
