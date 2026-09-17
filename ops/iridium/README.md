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

## Self-update on this host — the two halves must name the same host

The app *checks* a channel (`update.apiBase` + `repo` + `branch` in
dashboard-config) and the host *fetches* from this clone's `origin`. They are
configured separately and neither can move the other, so a change to one is half
a change. See `../../specs/self-update-channel.md`.

As found on 2026-09-17, three things are missing here and the self-updater has
never once worked:

- `/opt/nova-ha-dashboard/repo` does not exist and there is no `releases/`. The
  install is flat, so `nova-release migrate` was never run on this host. Every
  queued update logged `fatal: cannot change to '.../repo'` and then, before the
  fix in `ops/nova-release`, reported `success: Already up to date ()`.
- No key in `~/.ssh` is registered with Forgejo, so the app owner cannot fetch a
  private repository over SSH from here.
- `~/.local/bin/nova-release` is the 2026-08-03 copy, older than the repo's.

The crontab already runs the drain every minute, which is correct:
`* * * * * NOVA_UPDATE_BRANCH=main ~/.local/bin/nova-release process`.

### 1. Give the updater a read-only token

The channel here is a **private** Forgejo repository, so the clone and every
later fetch need a token. This replaces the ssh deploy key this runbook used to
require: an HTTPS clone authenticated with a token needs nothing in `~/.ssh`.

Mint one in Forgejo under *Settings → Applications* with the **`read:repository`**
scope and nothing else, then put it where only this account can read it — outside
the app tree, because the container mounts that tree read/write and can read
anything inside it:

```bash
install -d -m 0700 ~/.config/nova
umask 077; printf '%s' '<token>' > ~/.config/nova/update-token
chmod 600 ~/.config/nova/update-token
```

`nova-release` reads that path by default (`NOVA_UPDATE_TOKEN_FILE`). Verify the
helper answers for the forge and withholds for anyone else before trusting it:

```bash
printf 'protocol=https\nhost=ununhexium.tuatara-dory.ts.net\n\n' \
  | NOVA_REPO_URL=https://ununhexium.tuatara-dory.ts.net:3300/antidamage/nova-ha-dashboard.git \
    ~/.local/bin/nova-release credential get      # expect username= and password=
printf 'protocol=https\nhost=github.com\n\n' \
  | NOVA_REPO_URL=https://ununhexium.tuatara-dory.ts.net:3300/antidamage/nova-ha-dashboard.git \
    ~/.local/bin/nova-release credential get      # expect NOTHING
```

### 2. The same token, for the in-app check

One token serves both halves; do not mint a second. The in-app check reads it
from the container's environment rather than from a file, because the container
can only see the app tree and `/opt/nova-household`, and `.env.local` is owned by
the app owner, so no sudo is involved:

```bash
sed -i '/^NOVA_UPDATE_TOKEN=/d' /opt/nova-ha-dashboard/.env.local
printf 'NOVA_UPDATE_TOKEN=%s\n' '<the-same-token>' >> /opt/nova-ha-dashboard/.env.local
```

Unlike the clone, a copy here is safe and intended: the container *is* the
consumer. It takes effect on the next container start, which step 3 performs
anyway.

### 3. Refresh the helper, then migrate

Do step 2 (the token) **before** the flat deploy that carries the household
overlay. Ordering step 1 (the key) only matters relative to `migrate`, which is
the first thing here that talks to the forge. With `update.apiBase` pointing at
the private Forgejo and no token yet, the in-app check gets a 404 and records a
check error rather than an available update — harmless, but it reads like a bug.

```bash
# The helper lives in the home directory rather than the app root, so a flat
# deploy cannot break it — but it also never updates itself. Refresh it by hand
# whenever ops/nova-release changes, or the guards this runbook relies on are not
# the ones running on this host.
install -m 0755 /opt/nova-ha-dashboard/ops/nova-release ~/.local/bin/nova-release

NOVA_REPO_URL=ssh://git@ununhexium.tuatara-dory.ts.net:2222/antidamage/nova-ha-dashboard.git \
NOVA_UPDATE_BRANCH=main ~/.local/bin/nova-release migrate
```

`migrate` clones `repo/`, builds the first release out-of-line, moves the current
flat install into `releases/bootstrap-<ts>` as the rollback target, repoints the
symlink farm and restarts the container. It is the one irreversible-looking step
and it is the only way self-update starts working here.

**`NOVA_REPO_URL` is only consulted when `repo/` does not exist.** `do_migrate`
clones if there is no `$REPO_DIR/.git` and otherwise just fetches `origin` — so
if a clone ever exists from a previous run, this variable is ignored and the
host keeps fetching whatever that clone's `origin` says. Passing it is
load-bearing here only because this host has no clone, and getting it wrong is
the worst outcome available: the app would *report* the Forgejo's head while the
host *fetched* GitHub, so the dashboard would offer an update and then install
something else. Check it straight afterwards, and fix it by hand if it is wrong:

```bash
git -C /opt/nova-ha-dashboard/repo remote -v
# origin must be ssh://git@ununhexium.tuatara-dory.ts.net:2222/antidamage/nova-ha-dashboard.git
# wrong? then:
git -C /opt/nova-ha-dashboard/repo remote set-url origin \
  ssh://git@ununhexium.tuatara-dory.ts.net:2222/antidamage/nova-ha-dashboard.git
```

It takes about a minute and a half to build, and the `/opt` tree is mid-move
while it runs, so **do not run it in the foreground of an ssh session you might
lose.** Launch it as a transient user unit and watch it from outside:

```bash
XDG_RUNTIME_DIR=/run/user/$(id -u) systemd-run --user --collect \
  --unit=nova-migrate \
  env NOVA_REPO_URL=ssh://git@ununhexium.tuatara-dory.ts.net:2222/antidamage/nova-ha-dashboard.git \
      NOVA_UPDATE_BRANCH=main \
      "$HOME/.local/bin/nova-release" migrate

journalctl --user -u nova-migrate -f      # until it reports success
~/.local/bin/nova-release status
```

`Linger=yes` is already set for this account, so the user manager survives logout
and the migration finishes whether or not you stay connected. This is the same
incantation that restored the farm on the previous host on 2026-06-28, after it
had been flat for weeks.

Verify afterwards:

```bash
git -C /opt/nova-ha-dashboard/repo remote -v
ls -l /opt/nova-ha-dashboard | head          # top-level entries are symlinks
ls -ld /opt/nova-ha-dashboard/data /opt/nova-ha-dashboard/.env.local   # still real
curl -s http://127.0.0.1:3001/api/update | head -c 400
```

### 4. From now on, do not flat-deploy over `/opt/nova-ha-dashboard`

`deploy-nova-dashboard.ps1` deletes everything at the app root except `data/`,
`.env.local` and `.staging`, which takes `releases/` and `repo/` with it and
breaks self-update. This is not hypothetical: it is how the farm came to be
missing for weeks on the previous host, restored on 2026-06-28.

Order matters: deploy the source change flat **first** (that is the current state
anyway), migrate **second**. If a flat deploy happens after a migration,
recovery is the same `migrate` invocation — the home-directory helper and the
cron survive it, which is exactly why they live outside the app root.
