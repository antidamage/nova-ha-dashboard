"""Register one face subject's WebAuthn credential. Run inside the container.

    docker exec -it nova-face-auth python -m authenticator register <subject>

**Deliberately a CLI and not an HTTP endpoint.** Registration mints the
credential that a recognised face releases, and a face-released session is
estate-wide. An endpoint for it — however well gated — would be a standing
capability to issue estate credentials, sitting in the same process that
authenticates people. A command someone has to run on the host, once per
household member, is the whole point rather than an inconvenience.

It prints the public half plus the exact `ak shell` snippet to paste into
authentik, because authentik's admin WebAuthn API cannot create a device (its
serializer has no credential_id/public_key/rp_id fields while the model
requires them — HTTP 500, verified against 2026.8.0). See
`authentik.py:register_webauthn_device`.

No private material is printed, and none can be: `register()` returns a
`RegisteredCredential`, which by construction carries public fields only.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

from . import ctap
from .ctap import AuthenticatorConfig
from .store import CredentialStore


def _config() -> AuthenticatorConfig:
    rp_id = os.environ.get("WEBAUTHN_RP_ID", "").strip()
    origin = os.environ.get("WEBAUTHN_ORIGIN", "").strip()
    if not rp_id or not origin:
        raise SystemExit(
            "WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN must be set (they live in "
            "/etc/nova-face-auth.env). Refusing to guess the relying party."
        )
    return AuthenticatorConfig(rp_id=rp_id, origin=origin)


def _store() -> CredentialStore:
    host_secret = os.environ.get("NOVA_FACE_HOST_SECRET", "")
    data_root = Path(os.environ.get("NOVA_FACE_AUTH_DATA", "/data"))
    connection = sqlite3.connect(data_root / "faces.sqlite3", check_same_thread=False)
    return CredentialStore(connection, host_secret=host_secret)


def _subject_exists(data_root: Path, subject_id: str) -> bool:
    connection = sqlite3.connect(data_root / "faces.sqlite3")
    try:
        row = connection.execute(
            "SELECT 1 FROM subjects WHERE id=?", (subject_id,)
        ).fetchone()
        return row is not None
    finally:
        connection.close()


def register(subject_id: str, *, force: bool) -> int:
    data_root = Path(os.environ.get("NOVA_FACE_AUTH_DATA", "/data"))
    # Refuse to mint a credential for a face that was never enrolled. Without
    # this, a typo in the subject id produces a perfectly valid credential that
    # no face can ever release -- and, worse, one that sits in authentik as a
    # live passwordless login for a subject nobody can see in the gallery.
    if not _subject_exists(data_root, subject_id) and not force:
        print(
            f"No enrolled subject {subject_id!r}. Enrol the face first, or pass "
            f"--force if you really mean to create a credential with no face "
            f"behind it.",
            file=sys.stderr,
        )
        return 2

    config = _config()
    store = _store()
    existing = store.credential_row(subject_id, config.rp_id)
    if existing is not None and not force:
        print(
            f"{subject_id!r} already has a credential for {config.rp_id}. "
            f"Re-running replaces it, which invalidates the one registered in "
            f"authentik -- pass --force if that is what you want.",
            file=sys.stderr,
        )
        return 2

    credential = store.register(subject_id, config)
    credential_id = ctap.b64url(credential.credential_id)
    public_key = ctap.b64url(credential.cose_public_key)

    print(f"subject      : {credential.subject_id}")
    print(f"rp id        : {credential.rp_id}")
    print(f"credential id: {credential_id}")
    print(f"public key   : {public_key}")
    print()
    print("Now register it in authentik. On the host:")
    print()
    print("    docker exec -it authentik-server-1 ak shell")
    print()
    print("then paste:")
    print()
    print("from authentik.stages.authenticator_webauthn.models import WebAuthnDevice")
    print("from authentik.core.models import User")
    print("u = User.objects.get(username='<your-authentik-username>')")
    print("WebAuthnDevice.objects.create(")
    print("    user=u,")
    print(f"    name={('nova-face-' + credential.subject_id)!r},")
    print(f"    credential_id={credential_id!r},")
    print(f"    public_key={public_key!r},")
    print("    sign_count=0,")
    print(f"    rp_id={credential.rp_id!r},")
    print("    aaguid='00000000-0000-0000-0000-000000000000',")
    print("    confirmed=True,")
    print(")")
    print()
    print("confirmed=True is required. Without it the device exists but the")
    print("validate stage cannot see it, and the flow reports that you have no")
    print("authenticator -- a confusing failure a long way from its cause.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m authenticator")
    sub = parser.add_subparsers(dest="command", required=True)
    reg = sub.add_parser("register", help="create a subject's WebAuthn credential")
    reg.add_argument("subject")
    reg.add_argument(
        "--force",
        action="store_true",
        help="replace an existing credential, or register with no enrolled face",
    )
    args = parser.parse_args(argv)
    if args.command == "register":
        return register(args.subject, force=args.force)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
