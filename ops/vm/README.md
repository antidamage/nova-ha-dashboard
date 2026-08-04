# nova-vm — the Nova hosting appliance (Linux VM on indium)

> **HISTORICAL — superseded 2026-08-02.** The Nova hosting role moved off this
> VM to **iridium bare metal**; see [`../iridium/README.md`](../iridium/README.md)
> for the live runbook. This directory is kept as the rollback record while the
> VM image still exists on indium, and `snapshot-nova.sh` here is still the
> current, reusable way to capture a Nova host's state — the iridium bootstrap
> calls it and `bootstrap.sh` unchanged.
>
> Indium was a 16 GB box hosting a 6 GB guest; it reached 37 GB of swap across 39
> swapfiles and took Nova down on 2026-08-02. Do not revive this arrangement
> without reading that incident first.

The entire Nova hosting role (dashboard + HA + Matter + Mosquitto + tuya
bridge + self-update + power helper) runs in one Ubuntu VM. The physical nova
box becomes a pure kiosk client whose backend is a single parameter, and its
original stack stays installed-but-stopped as the rollback copy.

**Identities:** the VM is `nova-vm` (own MAC → its own router reservation).
Nova keeps its original hostname and IP forever. Concrete hostnames, IPs, the
VM MAC, user names, and key names for every command below are in the
git-ignored `PRIVATEREF.md#1.1`, `#1.2`, and `#2`.
`linux-voice-assistant` stays on nova (it is the room's mic/speakers); HA
dials it at nova's unchanged IP, so voice needs no cutover step.

## 1. Create the VM (once, on indium)

Host prep (done 2026-07-13): UTM + ffmpeg via brew, Ubuntu ISO in `~/VMs/iso/`,
keep-awake LaunchAgent installed, leftover HA Core on :8123 retired.
*(UTM and the keep-awake/caffeinate agents were retired 2026-07-15 — see §7.)*

1. Build the autoinstall seed ISO (puts the SSH pubkey in first; key name: see
   `PRIVATEREF.md#2.2`):
   ```sh
   sed -i '' "s|REPLACE_WITH_SSH_PUBKEY|$(cat ~/.ssh/<ssh-key>.pub)|" autoinstall/user-data
   hdiutil makehybrid -o ~/VMs/iso/nova-vm-seed.iso -hfs -joliet -iso -default-volume-name CIDATA autoinstall/
   ```
2. UTM → New VM → **Virtualize** → Linux → Ubuntu server ISO.
   - 4 CPU, 6144 MB RAM, 64 GB disk (qcow2 grows lazily).
   - Network: **Bridged (en0)** — the VM must be a first-class LAN citizen or
     mDNS/Matter/tuya-local break. Note the generated MAC for the router
     reservation (current value: `PRIVATEREF.md#1.2`).
   - Attach `nova-vm-seed.iso` as a second CD drive; at the GRUB prompt the
     installer picks up `autoinstall` automatically (or add
     `autoinstall ds=nocloud` to the kernel line).
3. First boot: confirm `ssh -i ~/.ssh/<ssh-key> <user>@<vm-host>` works.
4. ~~Autostart at login~~ **Superseded 2026-07-15**: the VM starts at *boot* via a
   root LaunchDaemon — see §7. (The login-agent approach caused a 4-hour outage
   when indium rebooted to the login window and nobody logged in.)

## 2. Snapshot nova → bootstrap the VM

```sh
# from any box with the deploy key (staging dir contains SECRETS)
bash ops/vm/snapshot-nova.sh ~/nova-vm-staging <user>@<nova-host>
rsync -aH ~/nova-vm-staging/ <user>@<vm-host>:~/staging/

# inside the VM — Phase A wiring (see below)
bash /opt/nova-ha-dashboard/ops/vm/bootstrap.sh ~/staging --ha-url http://<nova-ip>:8123
```

`bootstrap.sh` is idempotent and deliberately conservative: stack containers
are created **stopped** with `--restart=no`, scraper crons are installed
commented out, and the `nova-release` cron pins `NOVA_UPDATE_BRANCH=vm-appliance`.

## 3. Parallel-run (soak) — two phases

**Phase A — dashboard only, zero device contention.** The VM dashboard runs
against nova's still-live HA (`--ha-url http://<nova-ip>:8123`); the VM's
own HA/Matter/tuya containers stay stopped. This proves: VM networking, mDNS,
image build, systemd unit, self-update from the branch, kiosk/ATV reachability,
camera consumption from Nocturnium. Point a test browser (NOT the kiosk) at
`http://<vm-host>/`, run:

```sh
bash /opt/nova-ha-dashboard/ops/verify-vm.sh --phase-a
```

then run the docker-pause soft-outage drill against it and let it soak for
several days. Two dashboards against one HA is read-mostly and safe — but do
NOT enable the VM's scraper crons or start its HA stack in this phase:
**tuya-local sessions and the Matter fabric must only ever have one owner.**

**Phase B — full-stack rehearsal windows.** Short mini-cutovers: stop nova's
stack (§5 freeze, but skip the disable steps), fresh delta snapshot, restore
into the VM, `sed` HA_URL back to `http://127.0.0.1:8123`, start the VM stack,
`verify-vm.sh`, walk the integrations, then swap back. Repeat until boring.

## 4. Cutover (the real one)

1. Quiet window. Freeze nova (§5). Final `snapshot-nova.sh` delta + restore.
2. VM: `.env.local` HA_URL → `http://127.0.0.1:8123`; `docker update --restart unless-stopped mosquitto matter-server homeassistant tuya-mobile-mqtt-bridge && docker start` them (mosquitto → matter → HA → bridge); `systemctl enable --now nova-ha-dashboard`.
3. Uncomment the `#CUTOVER#` scraper cron lines in the VM crontab.
4. `bash ops/verify-vm.sh` + walk EVERY integration live: tuya twins local+cloud,
   each Matter device, phone HA apps (re-point their URL to `http://<vm-host>:8123`),
   Apple TV (failover list finds the VM), weather/rainviewer, powershop/gymmaster
   scrape logs, the Windows box's sleep/wake over the tailnet
   (`PRIVATEREF.md#1.5`), wallpaper-sync SSH, voice
   satellite round-trip, `/config` System Power restart button.
5. Kiosk flip on nova: `NOVA_BACKEND_URL=http://<vm-host>/` in
   `~/.config/nova-kiosk/backend.env`, then `systemctl --user start brave-kiosk-guard.service`
   (or wait 2 min) — the guard relaunches Brave onto the new backend.
6. Managed-computers config: remove indium as a sleep target (it hosts the house now).

## 5. Freeze / unfreeze nova (rollback copy — REMOVE NOTHING)

Freeze (cutover step 1, plus the durability bits after verification passes):

```sh
# stop the moving parts
sudo systemctl stop nova-ha-dashboard        # container stops with it
docker stop homeassistant matter-server mosquitto tuya-mobile-mqtt-bridge
# after cutover verification: make the freeze survive a nova reboot
sudo systemctl disable nova-ha-dashboard
docker update --restart=no homeassistant matter-server mosquitto tuya-mobile-mqtt-bridge
crontab -l | sed -E 's/^([^#].*(nova-release|nova-system|powershop|gymmaster))/#FROZEN# \1/' | crontab -
sudo systemctl disable --now nova-camera-watchdog.service   # grabber lives on Nocturnium now
# leave running: brave kiosk + guard, linux-voice-assistant, nova-monitor-agent,
# nova-events-drain/temp-collector timers, nightly OS updater (its docker-update
# block sees only stopped containers and must skip them — verify first run)
```

Unfreeze (rollback): reverse it — `docker update --restart unless-stopped …`,
`docker start …`, `systemctl enable --now nova-ha-dashboard`, un-comment the
`#FROZEN#` cron lines, flip `backend.env` back to `http://127.0.0.1/`. The VM
side: `systemctl disable --now nova-ha-dashboard` + `docker stop` its stack.
State written on the VM after cutover does NOT flow back.

## 6. After the soak passes

- Merge `vm-appliance` → `main`; flip the VM cron's `NOVA_UPDATE_BRANCH` to
  `main`. (Nova's frozen crons can't self-update, so the merge can't touch it.)
- Update skills/docs/memories per the migration plan's Phase 5.
- Longer term (Phase 4): Go state-hub, Go monitor agent/ingest — one at a
  time, each with its own soak.

## 7. Headless daemon (2026-07-15) — boot-time VM, no login required

**Incident**: indium rebooted at 15:18 and sat at the login window for 4 hours.
The VM autostart (§1 step 4) and the caffeinate sleep-blockers were login-scoped
LaunchAgents — no login ⇒ no VM ⇒ dashboard dark; the Mac then maintenance-slept
until a human pressed the power button (19:19).

**Design now**: nova-vm runs as a **root LaunchDaemon** via brew qemu 11 (hvf),
replicating UTM's exact invocation (q35, Skylake-Client, 4 vCPU/6144 MB, e1000
bridged en0, **same MAC** (`PRIVATEREF.md#1.2`) ⇒ same DHCP lease, UEFI
pflash, cloud-init seed.iso). UTM is retired for this VM: its bundle is
`nova-vm.utm.retired-2026-07-15` with disk/vars moved out, so it cannot
double-start the image.

- **Layout (indium)**: `/Users/Shared/nova-vm/` — `disk.qcow2`, `efi_vars.fd`,
  `firmware/edk2-x86_64-code.fd`, `seed.iso`, `run-nova-vm.sh`, `log/`,
  `qmp.sock` / `console.sock` / `qga.sock`. Full ops notes in its README there.
- **Install / re-run**: stage `run-nova-vm.sh` + the plist + firmware there,
  then `sudo bash install-headless-nova-vm.sh` (idempotent). It also deletes
  the old agents and sets `pmset -a sleep 0 disksleep 0 standby 0
  autopoweroff 0 powernap 0` + `womp 1 autorestart 1`.
- **Stop (clean guest ACPI shutdown)**: `sudo launchctl bootout system/<vm-daemon-label>`
  (label: `PRIVATEREF.md#1.2`)
- **Start**: `sudo launchctl bootstrap system /Library/LaunchDaemons/<vm-daemon-label>.plist`
- **Serial console**: `nc -U /Users/Shared/nova-vm/console.sock`
- **KeepAlive semantics**: qemu crash *or guest poweroff* ⇒ relaunch (appliance).
  Host shutdown ⇒ launchd SIGTERM ⇒ wrapper sends QMP `system_powerdown` ⇒
  clean guest stop (verified in the reboot test: "guest powered down cleanly").
- **Verified 2026-07-15**: full host reboot with nobody logging in → VM ping
  t+234s → dashboard healthz t+399s (6m39s), zero interaction.
- **Still login-scoped on indium** (start at boot only because auto-login is
  enabled; die on logout): grafana / NATS / VictoriaMetrics / VictoriaLogs /
  nova-ingest, indium-video-capture, NovaVoiceSatellite, synergy. Follow-up
  candidate: daemonize the non-GUI ones.
