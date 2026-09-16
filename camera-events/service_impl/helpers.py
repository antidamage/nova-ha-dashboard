"""Pure helper functions: time formatting and zone/frame geometry.

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import cv2
import numpy as np

from core import Box, point_in_polygon


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_time(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def iso_time(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")


def zones_for(box: Box, zones: list[dict[str, Any]]) -> list[str]:
    for zone in zones:
        if zone.get("kind") == "exclude" and point_in_polygon(box.foot, zone.get("points", [])):
            return []
    return [zone["id"] for zone in zones if zone.get("kind") != "exclude" and point_in_polygon(box.foot, zone.get("points", []))]


def zone_for(box: Box, zones: list[dict[str, Any]]) -> str | None:
    candidates = zones_for(box, zones)
    return candidates[-1] if candidates else (None if any(
        zone.get("kind") == "exclude" and point_in_polygon(box.foot, zone.get("points", [])) for zone in zones
    ) else "unmapped")


def frame_quality(frame: np.ndarray) -> tuple[bool, float, float]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    median = float(np.median(gray))
    contrast = float(np.percentile(gray, 95) - np.percentile(gray, 5))
    return median >= 24 and contrast >= 22, median, contrast
