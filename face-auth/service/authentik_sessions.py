"""Snapshotting and sweeping the authentik sessions quick-profile logins open.

Binding a quick session to the authentik session it produced happens here,
on a timed sweep, because `/assert` returns before authentik has created that
session — see `store.open_quick_session`.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from authenticator.authentik import AuthentikClient, AuthentikError

from .config import AUTHENTIK_BASE_URL, AUTHENTIK_TOKEN, LOG
from .store import store


def list_session_ids(username: str | None) -> list[str]:
    """This user's current authentik session ids, or an empty list.

    Fails soft on purpose. An authentik that cannot be reached must not turn a
    successful sign-in into a refusal — the assertion has already been signed by
    the time this runs. An empty snapshot only costs precision later: the sweep
    then sees more candidates than it should and declines to bind rather than
    binding the wrong one.
    """

    if not username:
        return []
    try:
        return [
            str(session.get("uuid") or session.get("pk") or "")
            for session in AuthentikClient(base_url=AUTHENTIK_BASE_URL, token=AUTHENTIK_TOKEN).sessions_for(username)
            if session.get("uuid") or session.get("pk")
        ]
    except AuthentikError as error:
        LOG.warning("could not snapshot sessions for %s: %s", username, error)
        return []


QUICK_SWEEP_INTERVAL_SECONDS = 60


async def quick_session_sweeper() -> None:
    """Run the sweep forever, and never die of one bad pass.

    A sweep that raised would stop every future sweep, and the failure mode of
    that is quick sessions living indefinitely — the exact thing the timeout
    exists to prevent. So every pass is wrapped, and the loop continues.
    """

    while True:
        await asyncio.sleep(QUICK_SWEEP_INTERVAL_SECONDS)
        try:
            closed = await asyncio.to_thread(sweep_quick_sessions)
            if closed:
                LOG.info("quick-session sweep closed %d session(s)", closed)
        except Exception:  # noqa: BLE001
            LOG.exception("quick-session sweep failed; continuing")


def sweep_quick_sessions(now: float | None = None) -> int:
    """Terminate quick sessions that have gone quiet. Returns how many.

    Two jobs, in this order, because the first is what makes the second
    possible. `/assert` runs before authentik has created a session — the
    assertion it returns has not been submitted to the flow executor yet — so
    the row is opened with a snapshot of the sessions that already existed, and
    bound here on a later pass to whichever session appeared that was not in
    that snapshot and is not claimed by another row.

    Exactly one candidate binds. Zero or several does not: a guess here logs
    somebody out of a session the face never released, possibly a password
    session in active use, and a quick session outliving its timeout is the
    lesser failure. Ambiguity is logged and the row closes without terminating.

    A row that cannot be bound is still closed on time. It simply has nothing to
    terminate, which is the honest outcome when the sign-in never completed:
    there is no session to end because none was ever made.
    """

    now = time.time() if now is None else now
    closed = 0
    rows = store().open_quick_sessions()
    if not rows:
        return 0
    client = AuthentikClient(base_url=AUTHENTIK_BASE_URL, token=AUTHENTIK_TOKEN)
    sessions_by_user: dict[str, list[dict[str, Any]]] = {}

    for row in rows:
        username = row["authentik_username"]
        session_id = row["authentik_session_id"]

        if not session_id and username:
            if username not in sessions_by_user:
                try:
                    sessions_by_user[username] = client.sessions_for(username)
                except AuthentikError as error:
                    LOG.warning("quick-session sweep could not list sessions for %s: %s", username, error)
                    sessions_by_user[username] = []
            try:
                prior = set(json.loads(row["prior_session_ids"] or "[]"))
            except (TypeError, ValueError):
                prior = set()
            # Already claimed by another open row: two quick sign-ins in the
            # same window must not both bind the same session.
            claimed = {
                other["authentik_session_id"]
                for other in rows
                if other["authentik_session_id"] and other["id"] != row["id"]
            }
            candidates = [
                candidate_id
                for candidate_id in (
                    str(session.get("uuid") or session.get("pk") or "")
                    for session in sessions_by_user[username]
                )
                if candidate_id and candidate_id not in prior and candidate_id not in claimed
            ]
            if len(candidates) == 1:
                session_id = candidates[0]
                store().bind_quick_session(row["id"], session_id)
            elif len(candidates) > 1:
                # Ambiguous: more than one session appeared after this row was
                # opened, so nothing here can say which one the face released.
                # Terminating a guess could sign her out of a password session
                # she is actively using, and that is a worse outcome than a
                # quick session outliving its timeout — so this declines, says
                # so, and lets the row close without terminating anything.
                LOG.warning(
                    "quick session %s cannot be bound: %d candidate sessions for %s",
                    row["id"], len(candidates), username,
                )

        if now - row["last_seen"] < row["idle_timeout_seconds"]:
            continue

        if session_id:
            try:
                client.terminate_session(session_id)
                LOG.info(
                    "quick session idle-timed out: subject=%s profile=%s session=%s idle=%.0fs",
                    row["subject_id"], row["profile"], session_id, now - row["last_seen"],
                )
            except AuthentikError as error:
                # Leave the row open so the next pass tries again. A session that
                # could not be reached is still a session that must end.
                LOG.error("quick-session termination failed for %s: %s", session_id, error)
                continue
            store().close_quick_session(row["id"], "idle_timeout", now)
        else:
            # Never bound: the sign-in did not complete, the user is unmapped,
            # or the candidates were ambiguous. There is nothing to terminate —
            # which for an incomplete sign-in is the honest outcome, because no
            # session was ever created.
            store().close_quick_session(row["id"], "unbound", now)
        closed += 1

    return closed
