"""The one path that materialises a plaintext scalar, and the public readers.

Moved verbatim out of `store.py`. `sign_assertion` owns its `bytearray` and
wipes it in a `finally` that runs on the exception paths too -- do not change
the order of the statements in it.
"""

from __future__ import annotations

import time
from typing import Any, Callable

from cryptography.hazmat.primitives.asymmetric import ec

from .. import ctap
from ..ctap import AuthenticatorConfig
from .primitives import secret_box, wipe


class SigningMixin:
    # -- signing ----------------------------------------------------------

    def sign_assertion(
        self,
        *,
        subject_id: str,
        challenge: str,
        config: AuthenticatorConfig,
        release_token: str,
        now: float | None = None,
        _observe_plaintext: Callable[[bytearray], None] | None = None,
    ) -> dict[str, Any]:
        """Release one use of a subject's credential. The only signing path.

        There is no `rp_id` parameter, deliberately. The relying party comes
        from the pinned configuration and nowhere else, so there is no argument
        a caller can supply that would make this sign for a different RP: the
        credential is looked up by `(subject, config.rp_id)`, the rpIdHash is
        computed from `config.rp_id`, and the origin in `clientDataJSON` is
        `config.origin`.

        Raises `PermissionError` when there is no credential or no live
        release. Both are refusals, and both leave the release row consumed if
        it existed — a token that failed to produce a signature is still spent.
        """

        now = time.time() if now is None else now
        release = self._consume_release(subject_id, release_token, now)
        if release is None:
            raise PermissionError("face_session_invalid")
        row = self.credential_row(subject_id, config.rp_id)
        if row is None or row["id"] != release["credential_row"]:
            raise PermissionError("no_credential")

        sign_count = self._next_sign_count(row["id"])
        client_data = ctap.client_data_json(challenge, config)
        auth_data = ctap.authenticator_data(config, sign_count)

        scalar: bytearray | None = None
        dek: bytearray | None = None
        opened: bytes | None = None
        private_key = None
        try:
            dek = self._release_key(subject_id, release_token, bytes(release["salt"]))
            with secret_box(dek) as box:
                opened = box.decrypt(bytes(release["sealed"]))
            scalar = bytearray(opened)
            wipe(opened)
            if _observe_plaintext is not None:
                # Test seam only: hands the test the very buffer this method
                # owns, so "it was zeroed" is an assertion about the real
                # object rather than about a copy.
                _observe_plaintext(scalar)
            private_key = ec.derive_private_key(int.from_bytes(scalar, "big"), ec.SECP256R1())
            signature = ctap.sign(private_key, auth_data, client_data)
        finally:
            # Every path, including the exception paths. The scalar does not
            # outlive the call. What this cannot reach is OpenSSL's own copy
            # inside the `cryptography` key object; dropping the reference is
            # the whole of the available remedy there and the docstring says so.
            wipe(scalar)
            wipe(opened)
            wipe(dek)
            private_key = None

        credential_id = ctap.b64url(bytes(row["credential_id"]))
        # The WebAuthn wire shape, exactly as `navigator.credentials.get()`
        # would serialise it: `id`/`rawId`/`type` at the top and the signature
        # fields nested under `response`.
        #
        # This is not cosmetic. A relying party parses the structure before it
        # looks anything up — authentik calls
        # `parse_authentication_credential_json` and answers a flat
        # "Invalid device" when the shape is wrong, which is indistinguishable
        # from an unknown credential and sent the first live ceremony chasing
        # the registration instead of the payload. Emitting the standard shape
        # also means the browser relays this verbatim rather than reassembling
        # it, so there is one less place for the two to disagree.
        credential = {
            "id": credential_id,
            "rawId": credential_id,
            "type": "public-key",
            "response": {
                "clientDataJSON": ctap.b64url(client_data),
                "authenticatorData": ctap.b64url(auth_data),
                "signature": ctap.b64url(signature),
                "userHandle": ctap.b64url(subject_id.encode("utf-8")),
            },
            "clientExtensionResults": {},
        }
        return {
            "subject": subject_id,
            "credential": credential,
            "signCount": sign_count,
            # Flat aliases retained for the local harness and for logging. The
            # `credential` object above is what a relying party receives.
            "credentialId": credential_id,
            "clientDataJSON": credential["response"]["clientDataJSON"],
            "authenticatorData": credential["response"]["authenticatorData"],
            "signature": credential["response"]["signature"],
            "userHandle": credential["response"]["userHandle"],
        }

    # -- introspection ----------------------------------------------------

    def public_key(self, subject_id: str, rp_id: str) -> bytes | None:
        """The COSE public key. Public material; there is no private equivalent."""

        row = self.credential_row(subject_id, rp_id)
        return None if row is None else bytes(row["public_key"])

    def sign_count(self, subject_id: str, rp_id: str) -> int | None:
        row = self.credential_row(subject_id, rp_id)
        return None if row is None else int(row["sign_count"])


