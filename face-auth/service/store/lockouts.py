"""Lockout state, the armed switch, and release-rate accounting."""

from __future__ import annotations

import time
import uuid

import core

from ..config import LOCKOUT_FAILURES, LOCKOUT_GLOBAL_FAILURES, LOCKOUT_WINDOW_SECONDS, LOG, utc_now


class LockoutsMixin:
    def lockout(self, scope: str) -> core.LockoutState:
        """Read one scope's durable counter.

        Durable, not in process memory: restarting a container is the cheapest
        thing an attacker on the LAN can cause, and a restart must not clear a
        lockout.
        """

        with self.lock:
            row = self.connection.execute("SELECT * FROM lockouts WHERE scope=?", (scope,)).fetchone()
        if row is None:
            return core.LockoutState()
        return core.LockoutState(
            failures=int(row["failures"]),
            window_start=float(row["window_start"]),
            armed=bool(row["armed"]),
        )

    def _write_lockout(self, scope: str, state: core.LockoutState, *, disarmed_by: str | None = None) -> None:
        with self.lock:
            self.connection.execute(
                "INSERT INTO lockouts(scope, failures, window_start, armed) VALUES(?,?,?,?)"
                " ON CONFLICT(scope) DO UPDATE SET failures=excluded.failures,"
                " window_start=excluded.window_start, armed=excluded.armed",
                (scope, state.failures, state.window_start, int(state.armed)),
            )
            if not state.armed:
                self.connection.execute(
                    "UPDATE lockouts SET disarmed_at=?, disarmed_by=? WHERE scope=?",
                    (utc_now(), disarmed_by or "lockout", scope),
                )
            self.connection.commit()

    def note_failure(self, subject_id: str | None, now: float | None = None) -> None:
        """Fold a refusal into the global counter and, when attributable, the
        subject's.

        The global scope exists because a refused clip usually has no subject —
        per-subject counting alone cannot see a spoof campaign, which is
        exactly the thing worth seeing.
        """

        now = time.time() if now is None else now
        globally = core.register_failure(
            self.lockout("global"), now,
            max_failures=LOCKOUT_GLOBAL_FAILURES, window_seconds=LOCKOUT_WINDOW_SECONDS,
        )
        self._write_lockout("global", globally)
        if subject_id:
            scope = f"subject:{subject_id}"
            state = core.register_failure(
                self.lockout(scope), now,
                max_failures=LOCKOUT_FAILURES, window_seconds=LOCKOUT_WINDOW_SECONDS,
            )
            self._write_lockout(scope, state)
            if not state.armed:
                # A subject tripping their own limit disarms the service, not
                # just themselves: the spoof attempts are against the service.
                self.set_armed(False, actor=f"lockout:{scope}")

    def set_armed(self, armed: bool, *, actor: str) -> None:
        """The one durable switch. `armed = False` is reachable from a lockout,
        a rate trip and a Discord veto; `armed = True` is reachable only from
        `/arm`, which requires a password + TOTP authentik session. Nothing
        that presents a face can reach it."""

        state = self.lockout("global")
        with self.lock:
            self.connection.execute(
                "INSERT INTO lockouts(scope, failures, window_start, armed) VALUES('global',?,?,?)"
                " ON CONFLICT(scope) DO UPDATE SET armed=excluded.armed",
                (state.failures, state.window_start, int(armed)),
            )
            if armed:
                # Re-arming clears the counters as well; leaving them set would
                # re-trip on the next bad-lighting refusal.
                self.connection.execute(
                    "UPDATE lockouts SET failures=0, window_start=0, armed=1, cleared_at=?, cleared_by=?",
                    (utc_now(), actor),
                )
            else:
                self.connection.execute(
                    "UPDATE lockouts SET disarmed_at=?, disarmed_by=? WHERE scope='global'",
                    (utc_now(), actor),
                )
            self.connection.commit()
        LOG.warning("face release %s by %s", "armed" if armed else "DISARMED", actor)

    def armed(self) -> bool:
        return self.lockout("global").armed

    def recent_releases(self, now: float) -> list[float]:
        with self.lock:
            self.connection.execute(
                "DELETE FROM releases WHERE released_at < ?", (now - core.RELEASE_WINDOW_SECONDS * 2,)
            )
            rows = self.connection.execute(
                "SELECT released_at FROM releases WHERE released_at >= ?",
                (now - core.RELEASE_WINDOW_SECONDS,),
            ).fetchall()
            self.connection.commit()
        return [float(row["released_at"]) for row in rows]

    def record_release(self, subject_id: str, now: float) -> None:
        with self.lock:
            self.connection.execute(
                "INSERT INTO releases(id, subject_id, released_at) VALUES(?,?,?)",
                (uuid.uuid4().hex, subject_id, now),
            )
            self.connection.commit()
