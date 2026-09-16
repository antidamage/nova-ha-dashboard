"""The service's one state owner: the SQLite-backed `Store`.

`Store` is assembled from the mixins in this package — one per concern,
matching the section comments the class carried before the split — because
every method shares the same `self.connection`/`self.lock` set up once in
`SchemaMixin.__init__`. Splitting the concern into files while keeping them as
methods of one class (rather than free functions threading a connection
argument through every call) is what `specs/agent-token-footprint.md` §2
criterion 2 means by state whose parts "share closure state": the state is
still owned in exactly one place, only the method bodies are organised by
feature.
"""

from __future__ import annotations

from .attempts import AttemptsMixin
from .challenges import ChallengesMixin
from .lockouts import LockoutsMixin
from .quick_sessions import QuickSessionsMixin
from .schema import SchemaMixin
from .subjects import SubjectsMixin
from .vetoes import VetoesMixin


class Store(
    SchemaMixin,
    ChallengesMixin,
    SubjectsMixin,
    AttemptsMixin,
    LockoutsMixin,
    VetoesMixin,
    QuickSessionsMixin,
):
    """SQLite in the shape of camera-events' store: base schema by
    CREATE TABLE IF NOT EXISTS, then a PRAGMA table_info read and an ALTER per
    missing column, so adding a column never costs a data wipe."""


STORE: Store | None = None


def store() -> Store:
    if STORE is None:  # pragma: no cover - only before startup
        raise RuntimeError("store is not initialised")
    return STORE
