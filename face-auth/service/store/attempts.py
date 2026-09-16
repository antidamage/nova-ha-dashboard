"""The `attempts` audit/calibration row."""

from __future__ import annotations

import uuid
from typing import Any

from ..config import utc_now


class AttemptsMixin:
    def record_attempt(
        self,
        endpoint: str,
        nonce: str | None,
        decision: str,
        reason: str | None,
        signals: dict[str, Any],
        elapsed_ms: int,
        *,
        client_ip: str | None = None,
    ) -> None:
        """Every attempt, pass or fail. This is the audit trail and the
        calibration data set at once — thresholds get tuned from it rather than
        guessed a second time."""

        with self.lock:
            self.connection.execute(
                "INSERT INTO attempts(id, nonce, created_at, decision, reason, residual, antispoof,"
                " agreeing_frames, usable_frames, subject_id, top_score, runner_up, elapsed_ms, endpoint,"
                " client_ip, authentik_session_id, veto_delivered)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    uuid.uuid4().hex, nonce, utc_now(), decision, reason,
                    signals.get("residual"), signals.get("antispoof"),
                    signals.get("agreeingFrames"), signals.get("usableFrames"),
                    signals.get("subject"), signals.get("topScore"), signals.get("runnerUp"),
                    elapsed_ms, endpoint, client_ip,
                    signals.get("authentikSessionId"),
                    None if signals.get("vetoDelivered") is None else int(bool(signals["vetoDelivered"])),
                ),
            )
            self.connection.commit()
