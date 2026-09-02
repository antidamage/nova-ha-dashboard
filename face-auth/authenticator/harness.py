"""A local WebAuthn relying party, for tests and for a pre-deploy round trip.

The point of this file is that "register, then assert, then verify" is provable
here, today, without waiting on authentik's flow configuration — and that the
verification is written against the specification rather than against the code
that produced the assertion. It checks the things a real relying party checks:
the ceremony type, the challenge, the origin, the RP ID hash, the user-verified
flag, a counter that has moved forward, and the signature over
`authenticatorData ‖ SHA-256(clientDataJSON)`.

It is a test double. It is not an authorisation decision anywhere in the
service, and nothing imports it outside tests and the manual round trip.
"""

from __future__ import annotations

import json
import secrets
from dataclasses import dataclass, field

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fido2 import cbor

from . import ctap
from .ctap import AuthenticatorConfig


class VerificationError(Exception):
    """A relying party's refusal. Named so a test can assert on the reason."""


def public_key_from_cose(cose_bytes: bytes) -> ec.EllipticCurvePublicKey:
    """Rebuild a P-256 public key from its COSE_Key encoding.

    ES256 only: `alg` must be -7 and `crv` P-256. Anything else is refused
    rather than coerced, because a relying party that accepts an unexpected
    algorithm is a relying party that can be argued into a weaker one.
    """

    key = cbor.decode(cose_bytes)
    if key.get(1) != 2 or key.get(3) != -7 or key.get(-1) != 1:
        raise VerificationError("not an ES256 P-256 COSE key")
    numbers = ec.EllipticCurvePublicNumbers(
        int.from_bytes(key[-2], "big"), int.from_bytes(key[-3], "big"), ec.SECP256R1()
    )
    return numbers.public_key()


@dataclass
class RelyingParty:
    """The smallest honest relying party: issue a challenge, verify an assertion."""

    config: AuthenticatorConfig
    credentials: dict[str, bytes] = field(default_factory=dict)     # subject -> COSE key
    credential_ids: dict[str, str] = field(default_factory=dict)     # subject -> b64url id
    counters: dict[str, int] = field(default_factory=dict)
    issued: set[str] = field(default_factory=set)

    def register(self, subject: str, credential) -> None:
        self.credentials[subject] = credential.cose_public_key
        self.credential_ids[subject] = ctap.b64url(credential.credential_id)
        self.counters[subject] = 0

    def challenge(self) -> str:
        value = ctap.b64url(secrets.token_bytes(32))
        self.issued.add(value)
        return value

    def verify(self, subject: str, assertion: dict, challenge: str) -> bool:
        """Check an assertion the way a relying party has to, or raise."""

        if subject not in self.credentials:
            raise VerificationError("unknown credential")
        if challenge not in self.issued:
            raise VerificationError("challenge was never issued")
        # Single use at the relying party as well as at the oracle: a replayed
        # assertion must not verify twice even if the oracle would re-sign it.
        self.issued.discard(challenge)

        if assertion.get("credentialId") != self.credential_ids[subject]:
            raise VerificationError("assertion is for a different credential")

        client_data = ctap.b64url_decode(assertion["clientDataJSON"])
        document = json.loads(client_data)
        if document.get("type") != "webauthn.get":
            raise VerificationError("wrong ceremony type")
        if document.get("challenge") != challenge:
            raise VerificationError("challenge mismatch")
        if document.get("origin") != self.config.origin:
            raise VerificationError("origin mismatch")

        auth_data = ctap.b64url_decode(assertion["authenticatorData"])
        if auth_data[:32] != ctap.rp_id_hash(self.config.rp_id):
            raise VerificationError("rp id hash mismatch")
        flags = auth_data[32]
        if not flags & ctap.FLAG_UP:
            raise VerificationError("user not present")
        if not flags & ctap.FLAG_UV:
            raise VerificationError("user not verified")
        counter = int.from_bytes(auth_data[33:37], "big")
        if counter <= self.counters[subject]:
            # A counter that does not advance is the signal a relying party has
            # for a cloned authenticator. It is checked here because it is the
            # only place in this repository where checking it means anything.
            raise VerificationError("signature counter did not advance")
        self.counters[subject] = counter

        try:
            public_key_from_cose(self.credentials[subject]).verify(
                ctap.b64url_decode(assertion["signature"]),
                ctap.signature_base(auth_data, client_data),
                ec.ECDSA(hashes.SHA256()),
            )
        except InvalidSignature as error:
            raise VerificationError("signature does not verify") from error
        return True
