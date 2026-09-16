"""The service's one exception type."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException


class Refusal(HTTPException):
    """A refusal that names its reason in a stable machine-readable string.

    The UI renders these. `liveness_rigid` and `antispoof` deliberately show
    the same text there — the distinction belongs in `attempts`, where it is
    useful, not in the UI, where it is a tuning aid for an attacker.
    """

    def __init__(self, status: int, reason: str, **extra: Any) -> None:
        super().__init__(status_code=status, detail={"reason": reason, **extra})
        self.reason = reason
