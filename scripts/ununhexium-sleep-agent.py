#!/usr/bin/env python3
"""Small localhost-only sleep endpoint for the Nova dashboard.

Tailscale Serve exposes this process to Nova; the endpoint itself still
requires a bearer token so random tailnet callers cannot suspend the PC.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def read_token(path: Path) -> str:
    token = path.read_text(encoding="utf-8").strip()
    if not token:
        raise SystemExit(f"Token file is empty: {path}")
    return token


def suspend_after_response() -> None:
    time.sleep(0.35)
    result = ctypes.windll.PowrProf.SetSuspendState(False, False, False)
    if not result:
        error_code = ctypes.get_last_error()
        raise ctypes.WinError(error_code)


class SleepHandler(BaseHTTPRequestHandler):
    server_version = "UnunhexiumSleepAgent/1.0"

    def _json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        expected = self.server.token  # type: ignore[attr-defined]
        return self.headers.get("Authorization") == f"Bearer {expected}"

    def do_GET(self) -> None:
        if self.path != "/health":
            self._json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not found"})
            return
        self._json(HTTPStatus.OK, {"ok": True})

    def do_POST(self) -> None:
        if self.path != "/sleep":
            self._json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not found"})
            return
        if not self._authorized():
            self._json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "unauthorized"})
            return

        self._json(HTTPStatus.ACCEPTED, {"ok": True, "status": "sleeping"})
        threading.Thread(target=suspend_after_response, daemon=True).start()

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8767, type=int)
    parser.add_argument("--token-file", required=True, type=Path)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), SleepHandler)
    server.token = read_token(args.token_file)  # type: ignore[attr-defined]
    server.serve_forever()


if __name__ == "__main__":
    main()
