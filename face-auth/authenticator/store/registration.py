"""Creating, reading and deleting a subject's resident credential."""

from __future__ import annotations

import os
import secrets
import sqlite3
import uuid

from cryptography.hazmat.primitives.asymmetric import ec

from .. import ctap
from ..ctap import AuthenticatorConfig
from .primitives import SALT_BYTES, SCALAR_BYTES, RegisteredCredential, _now_iso, secret_box, wipe


class RegistrationMixin:
    # -- registration -----------------------------------------------------

    def register(self, subject_id: str, config: AuthenticatorConfig) -> RegisteredCredential:
        """Create one resident credential for a subject under the pinned RP.

        One credential per subject per relying party: a second call for the
        same pair replaces the first rather than accumulating credentials that
        a caller could then choose between.
        """

        if self.credential_row(subject_id, config.rp_id) is not None:
            self.delete_credential(subject_id, config.rp_id)

        private_key = ec.generate_private_key(ec.SECP256R1())
        credential_id = secrets.token_bytes(32)
        salt = os.urandom(SALT_BYTES)
        scalar = bytearray(private_key.private_numbers().private_value.to_bytes(SCALAR_BYTES, "big"))
        dek = self._durable_key(subject_id, config.rp_id, salt)
        plain = bytes(scalar)
        try:
            with secret_box(dek) as box:
                sealed = box.encrypt(plain)
        finally:
            wipe(plain)
            wipe(scalar)
            wipe(dek)

        public = ctap.cose_public_key(private_key.public_key())
        attested = ctap.attested_credential_data(credential_id, private_key.public_key())
        with self.lock:
            self.connection.execute(
                "INSERT INTO credentials(id, subject_id, rp_id, credential_id, sealed_key, kdf_salt,"
                " public_key, sign_count, created_at) VALUES(?,?,?,?,?,?,?,0,?)",
                (
                    uuid.uuid4().hex, subject_id, config.rp_id, credential_id, sealed, salt,
                    public, _now_iso(),
                ),
            )
            self.connection.commit()
        return RegisteredCredential(
            credential_id=credential_id,
            cose_public_key=public,
            attested_credential_data=attested,
            rp_id=config.rp_id,
            subject_id=subject_id,
        )

    def credential_row(self, subject_id: str, rp_id: str) -> sqlite3.Row | None:
        with self.lock:
            return self.connection.execute(
                "SELECT * FROM credentials WHERE subject_id=? AND rp_id=?", (subject_id, rp_id)
            ).fetchone()

    def has_credential(self, subject_id: str, rp_id: str) -> bool:
        return self.credential_row(subject_id, rp_id) is not None

    def delete_credential(self, subject_id: str, rp_id: str | None = None) -> None:
        with self.lock:
            if rp_id is None:
                self.connection.execute("DELETE FROM credentials WHERE subject_id=?", (subject_id,))
            else:
                self.connection.execute(
                    "DELETE FROM credentials WHERE subject_id=? AND rp_id=?", (subject_id, rp_id)
                )
            self.connection.execute("DELETE FROM credential_releases WHERE subject_id=?", (subject_id,))
            self.connection.commit()

