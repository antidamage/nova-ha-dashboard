"""Pipeline: per-clip orientation, detection and liveness/antispoof judging.

A facade. The routes and `service/__init__.py` import from here; the code is in
three siblings:

- clip_analysis.py  `ClipAnalysis` — detection per frame, frame/embedding views
- orientation.py    `upright`, `turns_from_landmarks`, `rotate` — sideways clips
- judging.py        `run_liveness`, `identify_frames` — the verdicts
"""

from __future__ import annotations

from .clip_analysis import ClipAnalysis
from .judging import identify_frames, run_liveness
from .orientation import rotate, turns_from_landmarks, upright

__all__ = ["ClipAnalysis", "identify_frames", "rotate", "run_liveness", "turns_from_landmarks", "upright"]
