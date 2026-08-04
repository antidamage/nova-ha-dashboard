# Nova on iridium — bare metal hosting role

The whole Nova hosting role (dashboard + HA + Matter + Mosquitto + tuya bridge +
Caddy) runs natively on **iridium**, which also hosts the voice stack. This
replaces the `nova-vm` QEMU guest on indium, retired 2026-08-02.

`ops/vm/` is kept as the rollback record. Do not delete it while the VM image
still exists on indium.

## Why bare metal and not the VM image

Iridium's BIOS has VT-x disabled, so there is no `/dev/kvm` and a lift-and-shift
of the qcow2 was never available. It did not need to be: all five stack
containers already ran `NetworkMode: host`, so the payload is portable Docker.
Measured warm, the guest used ~2.7 GB against a 4 GB allocation, and QEMU carried
several GB of overhead on top. Native containers cost about a third of the VM.

## What is different from `ops/vm/`

| | VM | iridium |
|---|---|---|
| Dashboard memory cap | none | `--memory-reservation=1536m --memory=3g` on `docker run` |
| Caddy config | `/etc/caddy/Caddyfile` | **`/etc/caddy/nova.Caddyfile`** |
| TLS SANs | `nova*`, `.14`, `100.66.54.105` | `nova*`, `iridium*`, `.20`, `100.104.57.108` |
| mDNS | guest avahi `host-name=nova` | iridium avahi `host-name=nova` + `iridium.local` alias unit |
| Identity | own MAC / DHCP reservation | collapsed onto iridium's `192.168.8.20` |

**The Caddy config path is not cosmetic.** Iridium already runs a separate
user-scoped `caddy.service` for the OpenClaw gateway which owns
`/etc/caddy/Caddyfile` and binds `:8443`. Nova's Caddy is system-scoped, binds
`:443`, and must never write that file — `deploy-nova-dashboard.ps1` was
installing over it before this was caught.

**The memory cap is not `MemoryHigh=` on the unit.** `docker run` places the
container under docker's own cgroup scope, so a unit-level `MemoryHigh=` would
constrain only the short-lived docker client and do nothing to the app.

## Bootstrap (safe, no downtime)

```sh
# from any box with the deploy key — READ-ONLY against the source host
NOVA_SSH_KEY=~/.ssh/id_ed25519_adeline \
  bash ops/vm/snapshot-nova.sh ~/nova-iridium-staging antidamage@192.168.8.14
rsync -aH ~/nova-iridium-staging/ antidamage@192.168.8.20:~/staging/

# on iridium
bash /opt/nova-ha-dashboard/ops/iridium/bootstrap-iridium.sh ~/staging
```

The staging directory contains `.env.local` and full `docker inspect` dumps —
**live credentials**. It is created `chmod 700`; keep it off shared paths and
delete it after bootstrap.

Bootstrap starts nothing. Containers are created stopped with `--restart=no` and
no unit is enabled, so this can be run days before the cutover.

## Cutover

Naming systems do not follow a host migration on their own. mDNS, Tailscale and
DHCP each have independent claim/release semantics, and the 2026-07 migration
lost hours to exactly this. **Release before claiming, and verify from a third
box.**

1. **Freeze the VM** (it stays running as the rollback):
   ```sh
   sudo systemctl stop nova-ha-dashboard nova-caddy
   docker stop tuya-mobile-mqtt-bridge homeassistant matter-server mosquitto
   crontab -l | sed -E 's/^([^#].*(nova-release|nova-system|powershop|gymmaster))/#FROZEN# \1/' | crontab -
   ```
2. **Authoritative delta snapshot** — rerun the snapshot/rsync above now that the
   source is quiesced. This pass is the one that counts.
3. **Re-bootstrap** iridium against the delta staging dir.
4. **Identity handover, in this order:**
   1. VM: `host-name=nova-vm-retired` in `/etc/avahi/avahi-daemon.conf`, restart
      avahi. This releases `nova.local` first.
   2. Iridium: `host-name=nova` in `/etc/avahi/avahi-daemon.conf`, restart avahi,
      then `systemctl enable --now nova-avahi-alias.service` to keep
      `iridium.local` resolving for the deploy tooling.
   3. Verify **from ununhexium, not from iridium** — a box's self-query for its
      own new mDNS name is unreliable:
      ```sh
      avahi-resolve-host-name -4 nova.local   # must return 192.168.8.20
      ```
      If avahi conflict-renamed itself to `nova-2`, restart it a second time; it
      does not retry the preferred name on its own.
   4. Tailscale: `sudo tailscale logout` on the VM so the retired node stops
      holding a tailnet identity.

      **The tailnet vhost is not hardcoded.** `ops/iridium/sync-tailnet-host.sh`
      rewrites it to whatever MagicDNS name this node actually owns, and both
      `bootstrap-iridium.sh` and `deploy-nova-dashboard.ps1` run it before
      validating the config. That matters because Caddy's
      `get_certificate tailscale` only works for the node's own name — point it
      anywhere else and Caddy refuses to start, taking HTTPS and the browser
      voice satellite with it.

      See "Reclaiming `nova.tuatara-dory.ts.net`" below for the one part that
      cannot be automated.
   5. Router: delete the DHCP reservation for the retired qemu MAC
      `1A:67:86:56:03:57`. **Do not reboot the router** — the last reboot reset
      Wireless Radio to OFF and took the house's WiFi down for ~15 minutes.
      Deleting a reservation needs no reboot.
5. **Start the stack** in dependency order:
   ```sh
   docker update --restart unless-stopped mosquitto matter-server homeassistant tuya-mobile-mqtt-bridge
   docker start mosquitto && docker start matter-server && docker start homeassistant && docker start tuya-mobile-mqtt-bridge
   sudo systemctl enable --now nova-ha-dashboard nova-caddy
   ```
6. **Uncomment the crons** on iridium (`nova-release`, `nova-system`, powershop,
   gymmaster).
7. **Verify** — `bash ops/verify-vm.sh` (no `--phase-a`), then walk every
   integration live. See the migration plan's verification section.

## Reclaiming `nova.tuatara-dory.ts.net` — DONE 2026-08-03

Kept as the record of how, because the failure modes are not obvious.

The short tailnet name stayed attached to the retired nova-vm node. Two things
were true and were re-verified on 2026-08-03:

- **Logging the old node out does not release the name.** It goes
  `offline, last seen 1m ago` and keeps holding it.
- **The CLI cannot claim it.** `tailscale set --hostname=nova` is a silent
  no-op, and `tailscale cert nova.tuatara-dory.ts.net` answers
  `invalid domain … must be one of ["iridium.tuatara-dory.ts.net"]`.
  (`tailscale up --reset` is not worth trying: it can drop the node off the
  tailnet pending re-auth, and this host now runs the whole house.)

So it takes two actions in the admin console at
<https://login.tailscale.com/admin/machines>:

1. Delete the offline **`nova`** machine (100.66.54.105 — the retired VM).
2. On **iridium**'s machine, `⋯` → **Edit machine name** → `nova`.

Then just redeploy, or run it directly:

```sh
sudo bash /opt/nova-ha-dashboard/ops/iridium/sync-tailnet-host.sh
sudo systemctl restart nova-caddy
```

`sync-tailnet-host.sh` picks up the new name, rewrites the vhost, validates, and
restores its backup if the result would not load. Nothing else needs editing —
that is the whole point of deriving the name instead of pinning it.

**Restart, not reload.** `nova-caddy.service` has no `ExecReload` because
`caddy reload` drives the admin API and this Caddyfile sets `admin off`; a
`systemctl reload` reports a failed job while the service is perfectly healthy.

**Renaming the node breaks HTTPS until the vhost is synced** — the old name stops
existing the moment the console rename lands, so Caddy is left serving a name
tailscaled will no longer certify. Run the sync immediately after renaming.

## Rollback

Stop iridium's stack and units, reverse the avahi and Tailscale steps, unfreeze
the VM's containers and crontab, and restart the VM daemon on indium. State
written on iridium after cutover does **not** flow back.

## After the cutover

Nothing Nova-related should remain on indium except the Apple TV build path.
Retire, in this order, and only once verification passes:

- `sudo launchctl bootout system/nz.co.skull.nova-vm`, then move the plist out of
  `/Library/LaunchDaemons/`. **Keep `/Users/Shared/nova-vm/` on disk for at least
  a week** as the rollback image before reclaiming its ~22 GB.
- The monitoring launchd jobs (`nats-server`, `nova-ingest`, `victorialogs`,
  `victoriametrics`, `homebrew.mxcl.grafana`) and the `grafana-port80` daemon —
  the backend now runs from `nova-monitoring/iridium/`.
- `NovaVoiceSatellite` and its watchdog. **That room loses wake-word coverage.**

Enumerate every automation that touches a frozen service, not just the obvious
one: in 2026-07 a nightly maintenance job silently restarted a "frozen" stack and
left two HA instances controlling the same devices for nine hours.
