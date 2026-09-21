"""The verdict: which outputs are active, and what that means for the amp.

Pure — it takes what pyatv reported plus the Apple TV's own identities and
returns the two states the bridge publishes. No Home Assistant, no IO, so the
table below is testable on its own (specs/appletv-audio-outputs.md).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from .const import STATE_OFF, STATE_ON, STATE_READ_UNAVAILABLE, STATE_READ_UNKNOWN


def normalise_identifier(value: object) -> str:
    """
    Hex only, lower case.

    The same Apple TV is reported three ways — `96:02:06:63:50:DB`,
    `94020663-50DB-442B-9355-78C9DDCA0C94` and `9602066350DB` are one device —
    so an identifier match has to normalise before comparing.
    """
    return re.sub(r"[^0-9a-f]", "", str(value or "").lower())


def own_identifiers(unique_id: object, identifiers: Iterable[object] | None) -> set[str]:
    """Every identifier this Apple TV answers to, normalised."""
    values = [unique_id, *(identifiers or [])]
    return {normalised for value in values if (normalised := normalise_identifier(value))}


def own_names(*names: object) -> set[str]:
    """
    The Apple TV's own name, folded, for the fallback match.

    Home Assistant titles a second Apple TV "Home Theatre (1485)" while the
    device calls itself "Home Theatre", so the disambiguating suffix goes.
    """
    folded: set[str] = set()
    for name in names:
        cleaned = re.sub(r"\s*\(\d+\)$", "", str(name or "")).strip().casefold()
        if cleaned:
            folded.add(cleaned)
    return folded


def is_own_output(device: object, own_ids: set[str], names: set[str]) -> bool:
    """
    Whether a reported output *is* the Apple TV.

    An exact identifier match is preferred; the name is the fallback, because
    tvOS reports the television's own speakers as the Apple TV itself and how
    it spells that has varied.
    """
    if normalise_identifier(getattr(device, "identifier", None)) in own_ids:
        return True
    reported = str(getattr(device, "name", None) or "").strip().casefold()
    return bool(reported) and reported in names


@dataclass(frozen=True)
class Verdict:
    """What the bridge publishes for one Apple TV."""

    tv_speakers: str
    audio_output: str
    active_outputs: list[dict[str, str]] = field(default_factory=list)


def verdict_from(
    devices: Sequence[object] | None,
    own_ids: set[str],
    names: set[str],
) -> Verdict:
    """
    The whole decision, from the outputs pyatv reported.

    | Reported                                    | `tv_speakers` |
    |---------------------------------------------|---------------|
    | nothing at all — no live connection, or MRP | `unavailable` |
    | the Apple TV's own output, and nothing else | `on`          |
    | anything else active                        | `off`         |

    `unavailable` is deliberately not `off`: a bridge that cannot read must
    never be able to silence the amplifier (specs/amp-appletv-power.md §8.3).
    """
    reported = list(devices or [])
    if not reported:
        return Verdict(tv_speakers=STATE_READ_UNAVAILABLE, audio_output=STATE_READ_UNKNOWN)
    active = [
        {
            "identifier": str(getattr(device, "identifier", None) or ""),
            "name": str(getattr(device, "name", None) or getattr(device, "identifier", "") or ""),
        }
        for device in reported
    ]
    names_reported = ", ".join(output["name"] or output["identifier"] for output in active)
    if all(is_own_output(device, own_ids, names) for device in reported):
        return Verdict(tv_speakers=STATE_ON, audio_output=names_reported, active_outputs=active)
    return Verdict(tv_speakers=STATE_OFF, audio_output=names_reported, active_outputs=active)
