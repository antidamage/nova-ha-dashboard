"""Pure camera-event geometry and classification helpers.

Kept dependency-free so the scene rules can be tested without the inference
container. Coordinates are normalized to the source frame.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import hypot
from typing import Any, Iterable


@dataclass(frozen=True)
class Box:
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def foot(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2, self.y2)

    @property
    def centre(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)

    def expanded(self, fraction: float = 0.18) -> "Box":
        width = self.x2 - self.x1
        height = self.y2 - self.y1
        return Box(
            max(0.0, self.x1 - width * fraction),
            max(0.0, self.y1 - height * fraction),
            min(1.0, self.x2 + width * fraction),
            min(1.0, self.y2 + height * fraction),
        )


def point_in_polygon(point: tuple[float, float], polygon: Iterable[tuple[float, float]]) -> bool:
    """Ray-cast a point into a normalized polygon, including its boundary."""

    points = list(polygon)
    if len(points) < 3:
        return False
    x, y = point
    inside = False
    previous = points[-1]
    for current in points:
        x1, y1 = previous
        x2, y2 = current
        cross = (y1 > y) != (y2 > y)
        if cross:
            at_x = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x <= at_x:
                inside = not inside
        # Boundary check with a small normalized tolerance.
        segment_length = hypot(x2 - x1, y2 - y1)
        if segment_length:
            area = abs((x - x1) * (y2 - y1) - (y - y1) * (x2 - x1))
            if area / segment_length < 1e-6 and min(x1, x2) - 1e-6 <= x <= max(x1, x2) + 1e-6 and min(y1, y2) - 1e-6 <= y <= max(y1, y2) + 1e-6:
                return True
        previous = current
    return inside


def box_iou(left: Box, right: Box) -> float:
    ix1, iy1 = max(left.x1, right.x1), max(left.y1, right.y1)
    ix2, iy2 = min(left.x2, right.x2), min(left.y2, right.y2)
    intersection = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    left_area = max(0.0, left.x2 - left.x1) * max(0.0, left.y2 - left.y1)
    right_area = max(0.0, right.x2 - right.x1) * max(0.0, right.y2 - right.y1)
    union = left_area + right_area - intersection
    return intersection / union if union else 0.0


def vehicle_proximity(person: Box, vehicle: Box) -> bool:
    """IoU plus a ground-point test catches people beside, not just over, a car."""

    expanded = vehicle.expanded()
    foot_x, foot_y = person.foot
    return box_iou(person, vehicle) > 0 or (
        expanded.x1 <= foot_x <= expanded.x2 and expanded.y1 <= foot_y <= expanded.y2
    )


def prompt_road_crossing(
    observations: list[tuple[float, float, float]],
    *,
    max_duration: float = 15.0,
    max_stop: float = 3.0,
) -> bool:
    """Return true for a short, monotonic curb-to-curb traversal.

    Observations are ``(timestamp, x, y)`` ground points. The camera's road
    crosses primarily on the y axis; either travel direction is accepted.
    """

    if len(observations) < 3:
        return False
    duration = observations[-1][0] - observations[0][0]
    if duration <= 0 or duration > max_duration:
        return False
    ys = [item[2] for item in observations]
    direction = 1 if ys[-1] > ys[0] else -1
    if abs(ys[-1] - ys[0]) < 0.12:
        return False
    reversals = 0
    longest_stop = 0.0
    stop_started: float | None = None
    for before, after in zip(observations, observations[1:]):
        delta = (after[2] - before[2]) * direction
        if delta < -0.015:
            reversals += 1
        if abs(after[2] - before[2]) < 0.004 and abs(after[1] - before[1]) < 0.004:
            stop_started = before[0] if stop_started is None else stop_started
            longest_stop = max(longest_stop, after[0] - stop_started)
        else:
            stop_started = None
    return reversals == 0 and longest_stop <= max_stop


def priority_for(labels: Iterable[str], zones: Iterable[str]) -> str:
    label_set, zone_set = set(labels), set(zones)
    if label_set & {"possible_animal_attack", "person_fallen", "person_stranded_in_road"}:
        return "urgent"
    if label_set & {"possible_delivery", "possible_vehicle_interaction", "unusual_road_behavior"}:
        return "important"
    if zone_set & {"front_path", "gate_entry", "rear_laneway"} and "person" in label_set:
        return "important"
    return "routine"


PRIORITY_ORDER = {"routine": 0, "important": 1, "urgent": 2}


def evaluate_policy(
    policy: dict[str, Any],
    labels: Iterable[str],
    zones: Iterable[str],
    *,
    owner_present: bool = False,
) -> dict[str, Any]:
    """Evaluate declarative retain/alert rules without household constants.

    Matching rules accumulate. Owner suppression applies per rule so an
    explicit safety override can still alert even when the owner is present.
    """

    label_set, zone_set = set(labels), set(zones)
    reasons: list[str] = []
    alert_reasons: list[str] = []
    priority = "routine"
    for rule in policy.get("rules", []):
        match = rule.get("match", {})
        all_labels = set(match.get("allLabels", []))
        any_labels = set(match.get("anyLabels", []))
        all_zones = set(match.get("allZones", []))
        any_zones = set(match.get("anyZones", []))
        if all_labels and not all_labels <= label_set:
            continue
        if any_labels and not any_labels & label_set:
            continue
        if all_zones and not all_zones <= zone_set:
            continue
        if any_zones and not any_zones & zone_set:
            continue
        if owner_present and rule.get("suppressWhenOwner", False) and not rule.get("safetyOverride", False):
            continue
        rule_id = str(rule.get("id", "policy_rule"))
        if rule.get("retain", False):
            reasons.append(rule_id)
        if rule.get("alert", False):
            alert_reasons.append(rule_id)
        candidate_priority = str(rule.get("priority", "routine"))
        if PRIORITY_ORDER.get(candidate_priority, 0) > PRIORITY_ORDER.get(priority, 0):
            priority = candidate_priority
    return {
        "retain": bool(reasons),
        "alert": bool(alert_reasons),
        "priority": priority,
        "reasons": reasons,
        "alertReasons": alert_reasons,
    }
