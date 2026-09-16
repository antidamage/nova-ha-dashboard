"""CIDR parsing and the default-deny network-binding gate."""

from __future__ import annotations

import ipaddress


def parse_cidrs(specification: str | None) -> list[ipaddress._BaseNetwork]:
    """Parse a comma-separated CIDR list, dropping nothing silently.

    A single unparseable entry makes the whole list empty rather than a
    shorter list that still allows something. Half-understanding an allow-list
    is how a typo turns into an open door; refusing the list outright turns the
    same typo into a locked door, which is the failure this design wants.
    """

    if not specification:
        return []
    networks: list[ipaddress._BaseNetwork] = []
    for entry in specification.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            return []
    return networks


def client_address(
    forwarded_for: str | None,
    peer: str | None,
    *,
    trust_forwarded: bool = True,
) -> str | None:
    """The address the network gate judges: Caddy's forwarded client, then peer.

    Caddy terminates TLS and is the only thing in front of the service, so the
    left-most `X-Forwarded-For` entry is the real client. `trust_forwarded` is
    the switch for a topology where the service is directly reachable and the
    header would be attacker-supplied — there it must be ignored entirely, not
    merely preferred less.
    """

    if trust_forwarded and forwarded_for:
        first = forwarded_for.split(",")[0].strip()
        if first:
            return first
    peer = (peer or "").strip()
    return peer or None


def network_allowed(address: str | None, networks: list[ipaddress._BaseNetwork]) -> bool:
    """Default-deny membership test.

    Every "no" case collapses to the same answer on purpose: no address, an
    address that will not parse, and an empty or unparseable CIDR list all
    refuse. There is no branch here that ends in "allow because we could not
    tell".
    """

    if not networks or not address:
        return False
    candidate = address.strip()
    if candidate.startswith("[") and "]" in candidate:  # [::1]:port
        candidate = candidate[1:candidate.index("]")]
    try:
        parsed = ipaddress.ip_address(candidate)
    except ValueError:
        # A bare "host:port" from a peer tuple, but never an IPv6 guess — an
        # ambiguous address is refused rather than half-parsed.
        if candidate.count(":") == 1:
            try:
                parsed = ipaddress.ip_address(candidate.split(":")[0])
            except ValueError:
                return False
        else:
            return False
    if isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped is not None:
        parsed = parsed.ipv4_mapped
    return any(parsed in network for network in networks)
