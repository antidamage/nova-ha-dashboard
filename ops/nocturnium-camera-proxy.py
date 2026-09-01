#!/usr/bin/env python3
"""Expose Nocturnium's camera API as the standalone video-host surface.

The original Nova dashboard owns capture/VAAPI encoding on localhost under
``/api/camera/...``.  Remote dashboard clients expect a video host exposing
``/camera/...`` and require CORS because they load the HLS bytes directly.
This deliberately small reverse proxy supplies that path and header seam while
leaving all capture, settings, snapshots, and recorder control in the original
service.
"""

from __future__ import annotations

import hmac
import http.client
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


LISTEN = ("0.0.0.0", 8080)
UPSTREAM = ("127.0.0.1", 80)
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}
RESPONSE_OWNED = {"access-control-allow-origin", "date", "server"}

# Token file path; overridable via env for testing. Read fresh on every
# request rather than cached at import time, so rotation just needs a file
# rewrite, no service restart. See ops/nocturnium-camera-proxy.service and
# authentik/specs/authentik-sso.md "Camera bypass contract".
TOKEN_FILE = os.environ.get("NOVA_CAMERA_PROXY_TOKEN_FILE", "/etc/nova-camera-proxy.token")

ALLOWED_ORIGINS = {
    "http://nova.local",
    "http://192.168.8.20",
    "https://nova.tuatara-dory.ts.net",
    "http://127.0.0.1",
}


def _read_token() -> str:
    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return ""


def _equal_secret(left: str, right: str) -> bool:
    # Mirror lib/service-auth.ts's equalSecret: length check first, then a
    # constant-time compare, so an empty configured token never matches an
    # empty presented token.
    if not left or not right:
        return False
    left_bytes = left.encode("utf-8")
    right_bytes = right.encode("utf-8")
    return len(left_bytes) == len(right_bytes) and hmac.compare_digest(left_bytes, right_bytes)


class CameraProxy(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def do_OPTIONS(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        self._proxy()

    def do_HEAD(self) -> None:  # noqa: N802
        self._proxy(send_body=False)

    def do_POST(self) -> None:  # noqa: N802
        self._proxy()

    def do_PUT(self) -> None:  # noqa: N802
        self._proxy()

    def _proxy(self, *, send_body: bool = True) -> None:
        if self.path == "/healthz":
            self.send_response(200)
            self._send_cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", "11")
            self.end_headers()
            if send_body:
                self.wfile.write(b'{"ok":true}')
            return

        if not self.path.startswith("/camera/"):
            self.send_error(404)
            return

        if not self._authorized():
            body = b'{"error":"unauthorized"}'
            self.send_response(401)
            self._send_cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if send_body:
                self.wfile.write(body)
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else None
        upstream_path = "/api" + self.path
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in HOP_BY_HOP and key.lower() != "host"
        }
        headers["Host"] = f"{UPSTREAM[0]}:{UPSTREAM[1]}"

        connection = http.client.HTTPConnection(*UPSTREAM, timeout=15)
        try:
            connection.request(self.command, upstream_path, body=body, headers=headers)
            response = connection.getresponse()
            self.send_response(response.status, response.reason)
            for key, value in response.getheaders():
                if key.lower() not in HOP_BY_HOP and key.lower() not in RESPONSE_OWNED:
                    self.send_header(key, value)
            self._send_cors()
            self.end_headers()
            if send_body:
                while chunk := response.read(256 * 1024):
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionError, TimeoutError, OSError) as error:
            if not self.wfile.closed:
                self.log_error("upstream request failed: %s", error)
        finally:
            connection.close()

    def _authorized(self) -> bool:
        expected = _read_token()
        auth = self.headers.get("Authorization", "")
        if not auth.lower().startswith("bearer "):
            return False
        presented = auth[len("Bearer "):].strip()
        return _equal_secret(presented, expected)

    def _send_cors(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Range, If-Modified-Since, If-None-Match, If-Range")


if __name__ == "__main__":
    server = ThreadingHTTPServer(LISTEN, CameraProxy)
    server.serve_forever()
