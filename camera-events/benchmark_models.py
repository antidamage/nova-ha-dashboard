"""Compare Nano detectors against an owner-reviewed YOLO-format scene set.

Usage inside the service image:
  python /app/benchmark_models.py /data/benchmark/camera.yaml

The result is deterministic: highest event/object recall wins; within one
percentage point, precision wins, then the smaller YOLO11n baseline.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from ultralytics import YOLO


def evaluate(model_name: str, data: str) -> dict[str, float | str]:
    result = YOLO(model_name).val(data=data, split="val", device="cpu", imgsz=1280, batch=1, verbose=False)
    return {
        "model": model_name,
        "recall": float(result.box.r.mean()),
        "precision": float(result.box.p.mean()),
        "map50": float(result.box.map50),
    }


def choose(results: list[dict[str, float | str]]) -> dict[str, float | str]:
    ordered = sorted(results, key=lambda item: (float(item["recall"]), float(item["precision"])), reverse=True)
    if len(ordered) > 1 and float(ordered[0]["recall"]) - float(ordered[1]["recall"]) < 0.01:
        ordered[:2] = sorted(ordered[:2], key=lambda item: (float(item["precision"]), item["model"] == "yolo11n.pt"), reverse=True)
    return ordered[0]


if __name__ == "__main__":
    if len(sys.argv) != 2 or not Path(sys.argv[1]).is_file():
        raise SystemExit("usage: benchmark_models.py /path/to/camera.yaml")
    values = [evaluate(model, sys.argv[1]) for model in ("yolo11n.pt", "yolo26n.pt")]
    print(json.dumps({"results": values, "selected": choose(values)}, indent=2))
