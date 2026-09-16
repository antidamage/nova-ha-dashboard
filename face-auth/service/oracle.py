"""The signing oracle and the veto channel."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from typing import Any

from .config import (
    HOST_SECRET,
    LOG,
    PUBLIC_BASE_URL,
    VETO_HOOK_KEY,
    VETO_HOOK_URL,
    VETO_LINK_TTL_SECONDS,
    WEBAUTHN_ORIGIN,
    WEBAUTHN_RP_ID,
    utc_now,
)
from .errors import Refusal
from .store import store


class Oracle:
    """The authenticator, in this process.

    Same process as the face decision on purpose: the decision never crosses a
    boundary before it authorises a signature, so there is no socket on which
    a "the face matched" message could be injected by anything that had not
    already compromised the process that would have signed anyway.
    """

    def __init__(self) -> None:
        from authenticator import AuthenticatorConfig, CredentialStore

        self.config = AuthenticatorConfig(rp_id=WEBAUTHN_RP_ID, origin=WEBAUTHN_ORIGIN)
        self.store = CredentialStore(
            store().connection, host_secret=HOST_SECRET, lock=store().lock
        )


ORACLE: Oracle | None = None


def require_oracle() -> Oracle:
    """The credential half, or a 503.

    Its absence is not a startup failure: the recognition half — `/identify`,
    `/detect`, `/embed`, which camera-events and the kiosk use — keeps working
    on a host that has not been given a host secret or a relying party yet.
    What it must never do is fall back to some other way of letting somebody
    in.
    """

    if ORACLE is None:
        raise Refusal(503, "service_unavailable")
    return ORACLE


# Two distinct "no mapping" answers, because they mean opposite things. The
# module saying "nobody is mapped to that subject" is a refusal: an unvetoable
# release is not a release. The module not answering at all is a third-party
# outage, and a third-party outage must not lock the household out of its own
    # house.
UNMAPPED = object()
UNKNOWN = object()


class VetoClient:
    """The Discord veto, over the module's hook endpoint.

    Revocation only, in both directions. Nothing this client sends can approve
    an assertion, and nothing it receives is treated as an authorisation — the
    only thing it can report that changes an outcome is "this subject has no
    account mapped", which *refuses*.
    """

    def __init__(self, url: str) -> None:
        self.url = url

    def _post(self, payload: dict[str, Any], timeout: float = 4.0) -> tuple[int, dict[str, Any]] | None:
        """POST the hook. `None` means the module did not answer at all."""

        if not self.url:
            return None
        headers = {"Content-Type": "application/json"}
        if VETO_HOOK_KEY:
            headers["X-Nova-Face-Veto-Key"] = VETO_HOOK_KEY
        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
                return response.status, (json.loads(body) if body else {})
        except urllib.error.HTTPError as error:
            body = error.read()
            try:
                return error.code, (json.loads(body) if body else {})
            except ValueError:
                return error.code, {}
        except Exception as error:  # noqa: BLE001 - any other failure is "unknown"
            LOG.warning("veto channel unreachable: %s", error.__class__.__name__)
            return None

    def resolve(self, subject: str):
        """UNMAPPED, UNKNOWN, or the account row for the subject.

        Only an explicit answer means unmapped: `{"mapped": false}`, or a 409
        from the module. Every other non-answer — no hook URL configured, a
        404 from a module that has not implemented the resolve hook, a 5xx, a
        timeout — is UNKNOWN, and the caller proceeds while logging an
        undelivered veto. That asymmetry is deliberate: refusing on "the module
        did not answer" would make a Discord outage a household lockout, which
        the spec forbids in as many words.
        """

        answer = self._post({"hook": "face.account.resolve", "subject": subject}, timeout=2.0)
        if answer is None:
            return UNKNOWN
        status, body = answer
        if status == 409 or (status < 400 and body.get("mapped") is False):
            return UNMAPPED
        if status >= 400:
            LOG.warning("veto channel could not resolve subject mapping: status %s", status)
            return UNKNOWN
        return body.get("account") or {}

    def session_opened(
        self,
        *,
        subject: str,
        username: str | None,
        client_ip: str | None,
        surface: str,
        veto_id: str,
        session_id: str | None = None,
    ) -> bool:
        """`face.session.opened`. Failure to deliver is logged, not fatal."""

        payload = {
            "hook": "face.session.opened",
            "subject": subject,
            "authentikUsername": username,
            "sessionId": session_id,
            "clientIp": client_ip,
            "surface": surface,
            "at": utc_now(),
            "vetoId": veto_id,
            "fallbackUrl": self.fallback_url(veto_id),
        }
        answer = self._post(payload)
        if answer is None or answer[0] >= 400 or answer[1].get("delivered") is False:
            # Loudly. A veto channel that is quietly down is worse than none at
            # all, because the owner believes a session opening will reach her
            # phone and it will not. It still does not block the response — a
            # third-party outage must not lock her out of her own house — so
            # the log line and the `attempts` row are the whole of the alarm.
            LOG.error(
                "VETO UNDELIVERED for subject %s: a session was opened and nobody was told (%s)",
                subject,
                "no answer" if answer is None else f"status {answer[0]}",
            )
            return False
        return True

    @staticmethod
    def fallback_url(veto_id: str, action: str = "disarm") -> str | None:
        """The HMAC-signed single-use escape hatch, when nothing else works."""

        if not (HOST_SECRET and PUBLIC_BASE_URL):
            return None
        expiry = int(time.time() + VETO_LINK_TTL_SECONDS)
        query = f"a={action}&v={veto_id}&e={expiry}"
        signature = hmac.new(HOST_SECRET.encode(), query.encode(), hashlib.sha256).hexdigest()
        return f"{PUBLIC_BASE_URL.rstrip('/')}/face/veto?{query}&sig={signature}"


VETO = VetoClient(VETO_HOOK_URL)
