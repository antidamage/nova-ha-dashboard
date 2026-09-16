"""Request/response schemas (pydantic models).

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class EventPatch(BaseModel):
    reviewed: bool | None = None
    starred: bool | None = None
    correctedLabels: list[str] | None = None
    correctedIdentity: str | None = None


class SettingsBody(BaseModel):
    enabled: bool = True
    alertsEnabled: bool = False
    zones: list[dict[str, Any]]


class BulkDeleteBody(BaseModel):
    ids: list[str]

