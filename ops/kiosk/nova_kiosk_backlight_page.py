"""The kiosk page link for nova-kiosk-backlight.py, over CDP.

Installs the window.novaKioskBacklight binding on the kiosk page, hands each
call to the service's inbox, and pushes the service's state to the page as
window.__novaKioskBacklight plus a nova:kiosk-backlight event. The same pattern
as nova-kiosk-rotate.py. See nova-ha-dashboard/specs/kiosk-backlight.md.
"""
from __future__ import annotations

import json
import logging
import os
import queue
import threading
import time
import urllib.request
from pathlib import Path

LOG = logging.getLogger("kiosk-backlight")

CDP = os.environ.get("BACKLIGHT_CDP", "http://127.0.0.1:9223")
BINDING = "novaKioskBacklight"


def backend_url() -> str:
    try:
        for line in Path("~/.config/nova-kiosk/backend.env").expanduser().read_text().splitlines():
            if line.strip().startswith("NOVA_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return "http://127.0.0.1/"


class PageLink(threading.Thread):
    """Binding calls in (as dicts on `inbox`), state pushes out."""

    def __init__(self, inbox: queue.Queue) -> None:
        super().__init__(daemon=True)
        self.backend = backend_url().rstrip("/")
        self.inbox = inbox
        self.ws = None
        self.lock = threading.Lock()
        self.next_id = 0

    def send(self, method: str, params: dict | None = None) -> None:
        with self.lock:
            if not self.ws:
                return
            self.next_id += 1
            try:
                self.ws.send(json.dumps({"id": self.next_id, "method": method, "params": params or {}}))
            except Exception as error:  # the reader thread reconnects
                LOG.debug("cdp send: %s", error)

    def push(self, state: dict) -> None:
        detail = json.dumps(state)
        script = (
            "try{window.__novaKioskBacklight=%s;"
            "window.dispatchEvent(new CustomEvent('nova:kiosk-backlight',{detail:%s}))}catch(e){}"
        ) % (detail, detail)
        self.send("Runtime.evaluate", {"expression": script})

    def target(self):
        with urllib.request.urlopen(CDP + "/json/list", timeout=4) as response:
            for target in json.load(response):
                if target.get("type") == "page" and target.get("url", "").startswith(self.backend):
                    return target
        return None

    def run(self) -> None:
        import websocket  # python3-websocket

        while True:
            try:
                target = self.target()
                if target:
                    ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=None,
                                                     suppress_origin=True)
                    with self.lock:
                        self.ws = ws
                    self.send("Runtime.enable")
                    self.send("Runtime.addBinding", {"name": BINDING})
                    self.send("Page.enable")
                    LOG.info("attached to the kiosk page")
                    self.inbox.put({"attached": True})
                    while True:
                        message = json.loads(ws.recv())
                        params = message.get("params", {})
                        method = message.get("method")
                        if method == "Runtime.bindingCalled" and params.get("name") == BINDING:
                            try:
                                self.inbox.put(json.loads(params.get("payload") or "{}"))
                            except ValueError:
                                pass
                        elif method == "Page.frameNavigated" and not params.get("frame", {}).get("parentId"):
                            self.inbox.put({"attached": True})
            except Exception as error:
                LOG.debug("cdp: %s", error)
            with self.lock:
                self.ws = None
            time.sleep(5)
