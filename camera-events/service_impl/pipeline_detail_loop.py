"""Pipeline mixin: the detail model, alert notification, and the detail-pass queue loop.

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

import requests

from core import evaluate_policy
from .constants import DETAIL_ENABLED, LOG, MOONDREAM_MODEL, POLICY
from .helpers import iso_time, utc_now
from .store import STORE


class PipelineDetailLoopMixin:
    def load_detail_model(self) -> Any:
        if self.detail_model is not None:
            return self.detail_model
        import torch
        from transformers import AutoModelForCausalLM
        # Iridium's GPU is deliberately reserved for the always-on voice stack
        # and the tiny fast detector. The detailed pass is asynchronous, so run
        # Moondream in host RAM rather than risking a voice-model CUDA OOM.
        device = os.environ.get("NOVA_CAMERA_EVENTS_DETAIL_DEVICE", "cpu")
        LOG.info("loading Moondream detail model on %s", device)
        self.detail_model = AutoModelForCausalLM.from_pretrained(
            MOONDREAM_MODEL,
            revision=os.environ.get("NOVA_CAMERA_EVENTS_MOONDREAM_REVISION", "2025-06-21"),
            trust_remote_code=True,
            torch_dtype=torch.bfloat16,
            device_map={"": device},
            low_cpu_mem_usage=True,
        )
        return self.detail_model


    def notify(self, event_id: str, title: str, summary: str) -> None:
        settings = STORE.get_setting("analysis") or {}
        if not settings.get("alertsEnabled", False):
            return
        base = os.environ.get("HA_URL", "http://127.0.0.1:8123").rstrip("/")
        token = os.environ.get("HA_TOKEN")
        if not token:
            return
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        link = f"/dashboard/outside?cameraEvent={event_id}"
        try:
            response = requests.post(f"{base}/api/services/notify/notify", headers=headers, json={"title": title, "message": summary, "data": {"url": link}}, timeout=8)
            response.raise_for_status()
            state = "sent"
        except requests.RequestException:
            try:
                response = requests.post(f"{base}/api/services/persistent_notification/create", headers=headers, json={"title": title, "message": f"{summary}\n\n{link}", "notification_id": f"nova_camera_{event_id}"}, timeout=8)
                response.raise_for_status()
                state = "persistent"
            except requests.RequestException as error:
                LOG.warning("HA alert failed: %s", error)
                state = "failed"
        with STORE.lock:
            STORE.connection.execute("UPDATE events SET alert_state=? WHERE id=?", (state, event_id))
            STORE.connection.commit()

    def detail_loop(self) -> None:
        while not self.stop.is_set():
            if not DETAIL_ENABLED:
                self.stop.wait(30)
                continue
            with STORE.lock:
                retry_before = iso_time(time.time() - 60)
                row = STORE.connection.execute(
                    """SELECT * FROM events
                       WHERE status='queued'
                          OR (status='analysis_failed' AND detail_attempts<3 AND updated_at<=?)
                       ORDER BY started_at LIMIT 1""",
                    (retry_before,),
                ).fetchone()
                if row:
                    STORE.connection.execute(
                        "UPDATE events SET status='analysing',detail_attempts=detail_attempts+1,updated_at=? WHERE id=?",
                        (utc_now(), row["id"]),
                    )
                    STORE.connection.commit()
            if not row:
                self.stop.wait(10)
                continue
            try:
                self.detail_event(row)
                self.detail_error = None
            except Exception as error:
                self.detail_error = str(error)
                LOG.exception("detail analysis failed for %s", row["id"])
                exhausted = int(row["detail_attempts"]) >= 2
                labels = json.loads(row["labels_json"])
                zones = json.loads(row["zones_json"])
                fallback_decision = evaluate_policy(POLICY, labels, zones) if exhausted else None
                with STORE.lock:
                    STORE.connection.execute(
                        """UPDATE events SET status='analysis_failed',detail_error=?,updated_at=?,retained=?,
                           retained_reason=?,priority=?,policy_version=? WHERE id=?""",
                        (
                            str(error)[:1000], utc_now(), int(exhausted),
                            "detail_analysis_failed_fail_open" if exhausted else None,
                            fallback_decision["priority"] if fallback_decision and fallback_decision["retain"] else "important",
                            int(POLICY.get("version", 1)), row["id"],
                        ),
                    )
                    STORE.connection.commit()
                if exhausted and fallback_decision and fallback_decision["alert"]:
                    self.notify(row["id"], "Camera safety event", row["summary"])

