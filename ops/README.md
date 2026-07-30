# Nova self-update (GitHub → build → safe switch)

The dashboard updates itself from GitHub while running, with no risk of a bad
state: new versions are built **out-of-line**, the live install is switched by
re-pointing a symlink farm, every switch is **health-gated**, and a failed
update **auto-rolls-back** to the previous version. Two prior releases are kept,
so a manual "reinstall previous version" is always available.

## Why this shape

Nova runs the app in a Docker container started by the system unit
`nova-ha-dashboard.service`, which bind-mounts the fixed path
`/opt/nova-ha-dashboard → /app` and runs `npm start` (Next.js on `:80`,
`--network host`, `Restart=always`). The app owner has **no sudo**, so the
updater cannot change that unit or use systemd path/timer units. It therefore:

- restarts the app with `docker stop` (the unit's `Restart=always` re-runs
  `ExecStart`, which re-reads the mount), and
- is triggered by a **per-minute user cron** running `nova-release process`.

Because the mount path is fixed, releases live **inside** the mount root and the
"current" version is selected by a **symlink farm**: every top-level entry of
the active release is symlinked at `/opt/nova-ha-dashboard/<entry>`, except the
real shared state (`.env.local`, `data/`). Switching = repoint the farm +
restart. Rollback = repoint the farm at the previous release (no rebuild).

```
/opt/nova-ha-dashboard/        bind-mounted to /app
  .env.local                   REAL shared secret (unit --env-file target)
  data/                        REAL shared runtime state
    update/state.json          updater -> app status (drives banner/config UI)
    update/control/*.json       app -> updater apply/rollback requests
  repo/                        git clone, only fetched
  releases/<ts>-<sha>/         full build (tracked files + node_modules + .next)
  releases/.current .previous  pointer files
  bin/nova-release             the updater
  .next public package.json config app lib …  SYMLINKS into the active release
```

## Components

- **App side** (in this repo): `lib/update.ts`, `app/api/update/*`,
  `lib/update-scheduler.ts` + `instrumentation.ts` (daily check at
  `update.checkHourLocal` in `power.timeZone`), the main-page `UpdateBanner`,
  and the config-page `UpdateConfig` (check / reinstall-previous / auto-update
  switch). The app only *detects* and *requests*; it never touches Docker.
- **Host side** (`ops/`): `nova-release` does fetch/build/switch/health/rollback;
  `install-updater.sh` installs it and the trigger cron.

## Install (one-time, as the app owner on the Nova host — see `PRIVATEREF.md#1.1`/`#2.1`)

```bash
scp ops/nova-release ops/install-updater.sh <user>@<nova-host>:/tmp/
ssh <user>@<nova-host> 'bash /tmp/install-updater.sh'
ssh <user>@<nova-host> '/opt/nova-ha-dashboard/bin/nova-release migrate'
```

`migrate` builds the current `origin/main` out-of-line, snapshots the existing
flat install as a `bootstrap` rollback target, switches the symlink farm, and
health-checks. If the new build is unhealthy it restores the snapshot.

`install-updater.sh` puts `nova-release` in `~/.local/bin` (not in the app root)
so it survives a stray flat deploy over `/opt/nova-ha-dashboard`.

> **Do not flat-deploy over `/opt/nova-ha-dashboard` anymore** (old `nova-deploy`
> skill / manual `rsync` + `npm build` in place). That overwrites the releases
> symlink farm and deletes `releases/`, breaking self-update. The home-dir
> `nova-release` + user cron survive such a wipe, so recovery is just
> `nova-release migrate` again — but the supported path going forward is the
> in-app **Update** button / nightly auto-update.

## Commands

```
nova-release process       drain queued control requests (run by cron)
nova-release apply [sha]    build & switch to origin/main HEAD (or a sha)
nova-release rollback       switch back to the previous release
nova-release prune          delete releases beyond the kept window
nova-release status         print data/update/state.json
nova-release migrate        one-time flat -> releases conversion
```

Tunables via env (`NOVA_*`): `NOVA_KEEP_RELEASES` (default 3 = current + 2),
`NOVA_HEALTH_TIMEOUT`, `NOVA_UPDATE_BRANCH`, `NOVA_REPO_URL`, `NOVA_BUILD_IMAGE`.

## Container timezone

`/opt/nova-ha-dashboard/.env.local` must contain `TZ=Pacific/Auckland`. The
`node:20-bookworm-slim` container defaults to UTC, and anything that reasons
about local time on the server — the auto theme's hour-of-day sun fallback,
`update.checkHourLocal`, log timestamps — is wrong by 12-13 hours without it.
The unit's `--env-file` passes it through; no sudo needed, takes effect on the
next container restart (`docker stop nova-ha-dashboard`).

## Failure handling

- Build fails → release discarded, live install untouched.
- New release fails health check → farm repointed to previous, restart, verify;
  state recorded as `rolledback` (the bad release is kept for inspection).
- Disk guard (`NOVA_MIN_FREE_MB`) and `flock` (no overlapping runs) protect the
  host. Secrets/config are real and shared, so a bad build cannot corrupt them.

If sudo ever becomes available, the per-minute cron can be replaced by a
`systemd.path` unit watching `data/update/control/`, and `docker stop` by
`systemctl restart nova-ha-dashboard` — no other changes needed.

## System power controls (restart dashboard / reboot host)

The **System Power** section at the bottom of `/config` has two double-confirmed
buttons: *Restart Nova Services* and *Restart Nova (the computer)*. They reuse the
same shape as self-update — the containerised app can't stop its own container
or reboot the box, so it only **writes a request file** and a host helper acts:

```text
/opt/nova-ha-dashboard/data/system/
  control/*.json   app -> host  { "action": "restart-dashboard" | "restart-stack" | "reboot-host" }
  state.json       host -> last action/result (observability only)
```

- **App side** (this repo): `lib/system-control.ts`,
  `app/api/system/restart-stack` (the button), `app/api/system/restart-dashboard`
  (lower-level primitive), `app/api/system/reboot`, and the `SystemControlConfig`
  section rendered last in `ConfigWorkspace`.
- **Host side** (`ops/`): `nova-system` drains the queue —
  `restart-stack` = `docker restart` each service in `NOVA_STACK_CONTAINERS`
  (HA, MQTT, Matter, voice, bridges) then `docker stop nova-ha-dashboard` last;
  `restart-dashboard` = just `docker stop nova-ha-dashboard` (the unit's
  `Restart=always` relaunches it, no sudo); `reboot-host` = reboot the machine.
  `install-nova-system.sh` installs it and a second per-minute drain cron.

### Install the power helper (one-time, as the app owner on the Nova host)

```bash
scp ops/nova-system ops/install-nova-system.sh <user>@<nova-host>:/tmp/
ssh <user>@<nova-host> 'bash /tmp/install-nova-system.sh'
```

Dashboard restart works immediately. Host reboot needs privilege the app owner
doesn't have, so grant a tight NOPASSWD rule for just `systemctl reboot`:

```bash
# either let the installer do it (prompts for sudo once)…
ssh -t <user>@<nova-host> 'bash /tmp/install-nova-system.sh --install-sudoers'
# …or add it by hand:
#   sudo visudo -f /etc/sudoers.d/nova-system-reboot
#   <user> ALL=(root) NOPASSWD: /usr/bin/systemctl reboot, /sbin/reboot
```

Without that rule the *Restart Nova Services* button still works; *Restart Nova*
records a `failed` result in `data/system/state.json` and the box stays up.

```text
nova-system process            drain queued requests (run by cron)
nova-system restart-stack       docker restart HA + services, then bounce the dashboard
nova-system restart-dashboard   docker stop just the app container
nova-system reboot              reboot the host (needs the sudoers rule above)
nova-system status              print data/system/state.json
```

## Tuya Local self-repair

Nova keeps a local `tuya_local` entity and a cloud MQTT twin for each supported
Tuya device. DHCP address changes or a local-key rotation can strand the local
entry, at which point the dashboard deliberately falls back to the cloud twin.

`scripts/tuya-local-repair.sh --apply` refreshes keys from the Tuya mobile API,
discovers current LAN endpoints, and changes only candidates that pass a live
TinyTuya probe. It makes a dated `core.config_entries` backup before restarting
Home Assistant. The hourly systemd timer makes that recovery automatic:

```bash
bash /opt/nova-ha-dashboard/ops/install-tuya-local-repair.sh
systemctl list-timers nova-tuya-local-repair.timer
journalctl -u nova-tuya-local-repair.service
```

The cloud twin remains available throughout discovery and whenever a candidate
cannot be verified.

The set of service containers `restart-stack` bounces (everything except the
dashboard, which is handled last) is `NOVA_STACK_CONTAINERS`, default
`mosquitto matter-server homeassistant tuya-mobile-mqtt-bridge linux-voice-assistant`.
Override it in the cron/environment if the stack changes.
