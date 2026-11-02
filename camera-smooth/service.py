"""Serves the smooth stream, and runs the pipeline only while someone is asking for it.

Holds no GPU resources itself. specs/camera-smooth-delivery.md.
"""

import json
import os
import signal
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from core import parse_render_path, parse_stream_path
from supervisor import OUTPUT, Supervisor

PORT = int(os.environ.get("NOVA_CAMERA_SMOOTH_PORT", "8095"))
CONTENT_TYPES = {".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t"}

supervisor = Supervisor()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def _send(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _unavailable(self):
        self._send(503, b'{"error":"not ready"}', "application/json")

    def _render(self, range_id):
        if self.command == "HEAD":
            self._send(200, b"", "video/mp4")
            return
        process = supervisor.start_render(range_id)
        if process is None:
            self._unavailable()
            return
        try:
            # No length: it is not known until it has been made, so the connection's
            # close ends the response.
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            while True:
                chunk = process.stdout.read(1 << 16)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            supervisor.finish_render(process)

    def do_GET(self):
        path = self.path.split("?", 1)[0].lstrip("/")
        if path == "status":
            self._send(200, json.dumps(supervisor.status()).encode(), "application/json")
            return
        range_id = parse_render_path(path)
        if range_id is not None:
            self._render(range_id)
            return
        parsed = parse_stream_path(path)
        if parsed is None:
            self._send(404, b'{"error":"not found"}', "application/json")
            return
        job, name = parsed
        if not supervisor.note_demand(job, may_claim=name == "index.m3u8") or not supervisor.is_running(job):
            self._unavailable()
            return
        target = OUTPUT / name
        try:
            body = target.read_bytes()
        except OSError:
            self._unavailable()
            return
        self._send(200, body, CONTENT_TYPES[target.suffix])

    do_HEAD = do_GET


def supervise():
    while True:
        try:
            supervisor.tick()
        except Exception:  # noqa: BLE001 - this loop dying would leave the pipeline unmanaged
            traceback.print_exc()
        time.sleep(1)


def main():
    threading.Thread(target=supervise, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)

    def stop(*_args):
        supervisor.kill_from_signal()
        os._exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    server.serve_forever()


if __name__ == "__main__":
    main()
