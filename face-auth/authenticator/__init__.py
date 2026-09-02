"""The signing oracle: a WebAuthn host authenticator with custody of its keys.

This package is imported into the face service's own process on purpose. The
face decision and the signature happen either side of a function call, not
either side of a socket, so there is no boundary at which a "the face matched"
message could be injected without also having already compromised the process
that would have signed anyway.

Three files, three jobs:

- `store.py` holds keys. Nothing else does. No function in it returns raw key
  bytes to a caller, and the plaintext scalar is zeroed in a `finally` on every
  path out of the signing call.
- `ctap.py` builds the WebAuthn structures — `clientDataJSON` with a pinned
  origin, `authenticatorData` with a pinned RP ID hash — and never sees a
  private key it did not receive as an argument for the duration of one
  signature.
- `authentik.py` talks to the identity provider: registering a credential once
  from an authenticated admin session, and terminating sessions for the veto
  path.

`harness.py` is a relying-party test double so the round trip is provable
without authentik, and is imported by tests only.
"""

from .ctap import (
    AuthenticatorConfig,
    authenticator_data,
    client_data_json,
    rp_id_hash,
)
from .store import CredentialStore, RegisteredCredential

__all__ = [
    "AuthenticatorConfig",
    "CredentialStore",
    "RegisteredCredential",
    "authenticator_data",
    "client_data_json",
    "rp_id_hash",
]
