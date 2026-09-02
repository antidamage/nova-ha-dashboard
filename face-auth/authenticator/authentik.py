"""The two things that genuinely need authentik's API.

One-time registration of a credential from an authenticated admin session, and
session termination for the veto path. This module does **not** drive the login
flow: the browser does that, exactly as it would for a hardware key, and the
oracle only signs. The previous pass's flow-driving client is retired along
with `/auth/face`.

`urllib` rather than a client library, deliberately — this is four requests and
adding an HTTP stack to a container that already carries CUDA, ONNX and OpenCV
to save forty lines is a poor trade. The transport is injectable so the tests
exercise the request shapes without a network.

The admin token is passed in by the service from `/etc/nova-face-auth.env`. It
is never read from the environment here and never logged; the base URL is
configuration for the same reason — it is a household hostname and this
repository is public.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

LOG = logging.getLogger("nova-face-auth.authentik")

Transport = Callable[[str, str, dict[str, str], bytes | None], tuple[int, bytes]]


class AuthentikError(Exception):
    """authentik said no, or did not answer.

    Callers map this to a 503. There is no local fallback session anywhere
    above this: a service that mints its own session when the identity provider
    is down is not an authentication system.
    """


def _urllib_transport(method: str, url: str, headers: dict[str, str], body: bytes | None) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except OSError as error:
        raise AuthentikError(f"authentik unreachable: {error.__class__.__name__}") from error


@dataclass
class AuthentikClient:
    base_url: str
    token: str
    transport: Transport = _urllib_transport

    def _call(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        if not self.base_url or not self.token:
            raise AuthentikError("authentik is not configured")
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        status, raw = self.transport(method, f"{self.base_url.rstrip('/')}{path}", headers, body)
        if status >= 400:
            # The body can carry the token back in an error echo, so it is
            # summarised by length rather than logged.
            LOG.warning("authentik %s %s -> %s (%d bytes)", method, path, status, len(raw))
            raise AuthentikError(f"authentik returned {status} for {path}")
        return json.loads(raw) if raw else None

    # -- registration -----------------------------------------------------

    def user_id(self, username: str) -> int:
        results = (self._call("GET", f"/api/v3/core/users/?username={username}") or {}).get("results", [])
        if not results:
            raise AuthentikError("no such authentik user")
        return int(results[0]["pk"])

    def register_webauthn_device(
        self,
        *,
        username: str,
        name: str,
        credential_id: str,
        public_key: str,
        sign_count: int = 0,
        aaguid: str = "00000000-0000-0000-0000-000000000000",
    ) -> dict[str, Any]:
        """Register one credential against an authentik user, once.

        Registration is an administrative action performed from an
        authenticated admin session — it is a credential-issuing operation and
        gets the strongest gate available. It is never reachable by presenting
        a face, and there is no Discord action anywhere that reaches it either.

        `credential_id` and `public_key` are the base64url values the store
        returned. No private material crosses this boundary, because none is
        ever available to a caller of the store in the first place.
        """

        return self._call(
            "POST",
            "/api/v3/authenticators/admin/webauthn/",
            {
                "user": self.user_id(username),
                "name": name,
                "credential_id": credential_id,
                "public_key": public_key,
                "sign_count": sign_count,
                "aaguid": aaguid,
            },
        )

    # -- revocation -------------------------------------------------------

    def sessions_for(self, username: str) -> list[dict[str, Any]]:
        user = self.user_id(username)
        return (self._call("GET", f"/api/v3/core/authenticated_sessions/?user={user}") or {}).get("results", [])

    def terminate_session(self, session_id: str) -> bool:
        """Kill one session. The Revoke half of the veto."""

        self._call("DELETE", f"/api/v3/core/authenticated_sessions/{session_id}/")
        return True

    def terminate_all_sessions(self, username: str) -> int:
        """Kill every session a user holds.

        The fallback when a veto arrives without a session id — a revoke that
        over-reaches is a nuisance, a revoke that misses is a control that did
        not work.
        """

        count = 0
        for session in self.sessions_for(username):
            identifier = session.get("uuid") or session.get("pk")
            if identifier and self.terminate_session(str(identifier)):
                count += 1
        return count
