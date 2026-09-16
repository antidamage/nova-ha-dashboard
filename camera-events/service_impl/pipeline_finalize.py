"""Pipeline mixin: closing an event into a clip (event_clip / finalize_if_ready).

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

import subprocess
from typing import Any

from core import event_window_closed, priority_for, prompt_road_crossing, subject_gap_seconds
from .constants import (
    CLIP_POST_ROLL_SECONDS,
    CLIP_PRE_ROLL_SECONDS,
    CLIP_TAIL_MARGIN_SECONDS,
    EVENT_GAP_SECONDS,
    EVENT_ROOT,
    LOG,
    MAX_EVENT_SECONDS,
    PERSON_GAP_SECONDS,
    SOURCE_TOKEN,
)
from .helpers import iso_time
from .store import STORE


class PipelineFinalizeMixin:
    def event_clip(self, event: dict[str, Any]) -> str | None:
        start, end = event["start"] - CLIP_PRE_ROLL_SECONDS, event["last"] + CLIP_POST_ROLL_SECONDS
        selected = [segment for segment in self.catalog if segment["at"] + segment["duration"] >= start and segment["at"] <= end]
        if not selected:
            return None
        event_dir = EVENT_ROOT / event["id"]
        output = event_dir / "event.mp4"
        playlist = event_dir / "event.m3u8"
        lines = ["#EXTM3U", "#EXT-X-VERSION:3", f"#EXT-X-TARGETDURATION:{max(2, int(max(item['duration'] for item in selected) + 1))}", "#EXT-X-MEDIA-SEQUENCE:0"]
        for segment in selected:
            lines.extend([f"#EXTINF:{segment['duration']:.3f},", segment["url"]])
        lines.append("#EXT-X-ENDLIST")
        playlist.write_text("\n".join(lines) + "\n", encoding="utf-8")
        header_args = ["-headers", f"Authorization: Bearer {SOURCE_TOKEN}\r\n"] if SOURCE_TOKEN else []
        command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-protocol_whitelist", "file,http,https,tcp,tls,crypto", *header_args, "-i", str(playlist), "-c", "copy", "-movflags", "+faststart", str(output)]
        try:
            subprocess.run(command, check=True, timeout=180)
            playlist.unlink(missing_ok=True)
            return str(output)
        except (subprocess.SubprocessError, OSError) as error:
            # CalledProcessError renders the whole command line, which carries the
            # camera bearer token in its -headers argument. Never log it.
            detail = str(error).replace(SOURCE_TOKEN, "<redacted>") if SOURCE_TOKEN else str(error)
            LOG.warning("clip creation failed for %s: %s", event["id"], detail)
            return None

    def finalize_if_ready(self, analysed_through: float, stalled: bool = False) -> None:
        """Close the open event once analysed media time shows the subject has gone.

        `analysed_through` is how far the fast pass has actually looked, not how far
        the recorder has published; see `event_window_closed`.
        """
        if self.active is None:
            return
        gap = subject_gap_seconds(
            {item["class"] for item in self.active.get("subjects", [])} | set(self.active.get("labels", [])),
            default_gap=EVENT_GAP_SECONDS,
            person_gap=PERSON_GAP_SECONDS,
            minimum=CLIP_POST_ROLL_SECONDS + CLIP_TAIL_MARGIN_SECONDS,
        )
        closed = event_window_closed(
            self.active["start"], self.active["last"], analysed_through,
            gap=gap, max_duration=MAX_EVENT_SECONDS,
        )
        if not stalled and not closed:
            return
        event = self.active
        self.active = None
        observations = event.get("roadObservations", [])
        if observations:
            event["labels"] = sorted(set(event["labels"]) | {
                "prompt_road_crossing" if prompt_road_crossing(observations) else "road_behavior_candidate"
            })
            event["priority"] = priority_for(event["labels"], event["zones"])
            event["summary"] = (
                "A person crossed the road promptly. Detailed analysis pending."
                if "prompt_road_crossing" in event["labels"]
                else "Roadside pedestrian behavior requires detailed analysis."
            )
            STORE.update_collection(event)
        clip = self.event_clip(event)
        STORE.finalize(event["id"], iso_time(event["last"]), clip)
        LOG.info("event %s queued; clip=%s", event["id"], bool(clip))

