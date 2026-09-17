# Deployment and Operations

Primary deployment target:

- Host: the Nova box (hostname: see `PRIVATEREF.md#1.1`).
- Application directory: `/opt/nova-ha-dashboard`.
- Service: `nova-ha-dashboard.service`.
- Node runtime: Node 20 in the current recovered host setup.
- Home Assistant: local container on port `8123`.
- Matter server: port `5580`.
- Mosquitto: localhost port `1883`.
- Face service: `nova-face-auth.service`, localhost port `8099` (8098 is
  camera-events). Every call to it carries `X-Nova-Face-Key`, read from
  `/etc/nova-face-auth.env`; the unit has an `ExecStartPre` test for that file,
  so no secret file means no service and never a default key. Caddy exposes it
  at `/face/*` on the HTTPS vhost only, and the dashboard reaches it through
  same-origin `/api/face/*` with the key injected server-side. `/api/face/enrol*`,
  `/api/face/subjects*`, `/api/face/arm` and `/api/face/health` are behind
  authentik forward-auth (tailnet origin only), matched **by path in
  `@admin_any`, never by method in `@admin_writes`** — a method-filtered matcher
  leaves GET ungated, which briefly made the subject thumbnail (the biometric
  itself) readable by anyone on the LAN. `/api/face/challenge` and
  `/api/face/assert` are deliberately ungated because they are the login path,
  and `/api/face/disarm` and `/api/face/sessions/revoke` because they only ever
  reduce access. The whole `/api/face/*` surface answers 421 on the plain-HTTP
  vhost: the key never crosses the wire, but the request body is a video of
  someone's face and the response carries the WebAuthn assertion. A failed face build is
  non-fatal to the dashboard deploy, and the readiness probe reads the key
  inside the remote shell rather than from the workstation. See §16 and
  `specs/face-auth.md`.
- CCTV capture: MacroSilicon MS210x / EasierCAP on Nova, exposed to the
  dashboard container through host `/dev` mounted read-only at `/host-dev` plus
  device-cgroup rule `c 81:* rwm` for V4L2 character devices.
- KDE Plasma dashboard browser: `~/.config/autostart/brave-nova.desktop`
  launches Snap Brave at `http://127.0.0.1/` with `--start-fullscreen`; this
  native browser/window-manager fullscreen is required so toolbar refreshes do
  not depend solely on DOM fullscreen permission. Loopback, not the host's
  mDNS name,
  is used deliberately: the dashboard container binds `--network host` on the
  same box, so the kiosk never needs mDNS at all, and self-referential
  mDNS lookups from Snap Brave were an unreliable source of
  persistent "Nova is unavailable" blocker states that other clients (which
  resolve the host's name across the LAN, not against themselves) never hit.

Operational expectations:

- `.env.local` on the deployed host must contain HA, MCP, iCloud, and
  Powershop secrets as needed.
- The dashboard expects network access to Home Assistant and internet access
  for weather/radar/satellite/Powershop/iCloud features where configured.
- If optional integrations are missing, the dashboard should degrade with setup
  status, warnings, or hidden/empty sections instead of crashing.
- The service's `/dev` bind and V4L2 cgroup rule are intentionally hot-plug
  safe: the container must still start when the capture adapter is absent, in
  which case the recorder selects the synthetic signal-test source.
- Production camera environment values in `.env.local` are:

```ini
NOVA_FFMPEG_PATH=/app/data/vendor/ffmpeg
NOVA_CAMERA_FONT=/app/data/vendor/DejaVuSans.ttf
NOVA_CAMERA_OUTSIDE_DEVICE=/host-dev/v4l/by-id/usb-MACROSILICON_AV_TO_USB2.0_20200909-video-index0
NOVA_CAMERA_OUTSIDE_INPUT_FORMAT=v4l2
NOVA_CAMERA_OUTSIDE_PIXEL_FORMAT=mjpeg
NOVA_CAMERA_OUTSIDE_STANDARD=none
NOVA_CAMERA_OUTSIDE_FRAME_SIZE=720x480
NOVA_CAMERA_OUTSIDE_FRAME_RATE=25
NOVA_CAMERA_OUTSIDE_BRIGHTNESS=0
NOVA_CAMERA_OUTSIDE_CONTRAST=1
NOVA_CAMERA_OUTSIDE_SHARPNESS=0
```

- `ops/nova-ha-dashboard.service` is the checked-in service definition for this
  device access model. The installed host unit must remain aligned with it.
- The service resets V4L2 controls to hardware defaults before starting the
  container; persistent image tuning belongs in the ffmpeg environment values.
- To deliberately restore the generated signal test, unset
  `NOVA_CAMERA_OUTSIDE_DEVICE` and restart `nova-ha-dashboard`; do not remove the
  generator implementation.

Self-update:

- The dashboard detects a new version in-app and the host applies it; the two
  halves have separate configuration and neither can point the other at a
  repository. See `self-update-channel.md` for the channel, the request shape and
  the rules, and `ops/README.md` for the host-side updater.
- This deployment's channel comes from the household overlay, not from the
  shipped default. Iridium's `nova-release` clone fetches from its own `origin`,
  so both halves must name the same host for an update to detect and then
  actually install. `ops/iridium/README.md` is the runbook.

Powershop scheduled scrape:

- Runner defaults to `/opt/nova-ha-dashboard`.
- Data defaults to `/opt/nova-ha-dashboard/data/power/powershop`.
- Log file defaults under `data/power/powershop/logs`.
- Docker image defaults to `mcr.microsoft.com/playwright:v1.60.0-jammy`, which
  matches the checked-in `playwright-core` version.
- The scraper uses Playwright Chromium from that Docker image unless
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` overrides it; it does not reuse the
  Brave kiosk browser that displays the dashboard.
- Cron is installed by `scripts/install-powershop-cron.sh`.

GymMaster scheduled scrape:

- Runner defaults to `/opt/nova-ha-dashboard`.
- Data defaults to `/opt/nova-ha-dashboard/data/gymmaster`.
- Log file defaults under `data/gymmaster/logs`.
- Docker image defaults to `mcr.microsoft.com/playwright:v1.60.0-jammy`, which
  matches the checked-in `playwright-core` version.
- Runtime credentials must be supplied as `GYMMASTER_EMAIL` and
  `GYMMASTER_PASSWORD` in `.env.local` on Nova.
- The runner mounts `/opt/nova-ha-dashboard/data` read/write so the script can
  fall back to updating dashboard preferences if the local dashboard API is
  unavailable.
- The production runner defaults `GYMMASTER_DASHBOARD_URL` to
  `http://127.0.0.1` because `nova-ha-dashboard.service` serves the dashboard
  on host port 80.
- Cron is installed by `scripts/install-gymmaster-cron.sh` with four entries:
  `0 3-19 * * *`, `*/15 20-23 * * *`, `*/15 0-1 * * *`, and `0 2 * * *`.

System power host helper:

- `ops/nova-system` drains `data/system/control/*.json` on a per-minute user cron
  installed by `ops/install-nova-system.sh` to `~/.local/bin/nova-system`,
  mirroring the self-updater's file control channel.
- `restart-stack` (the System Power button) `docker restart`s the service
  containers in `NOVA_STACK_CONTAINERS` then `docker stop`s the dashboard last —
  no sudo (the app owner is in the `docker` group).
- `restart-dashboard` is normally handled in-app by `process.exit(0)`; the
  helper's equivalent action (`docker stop nova-ha-dashboard`) is retained for
  manual CLI use.
- `reboot-host` runs `systemctl reboot`. The app owner has no interactive sudo,
  so reboot requires a one-time NOPASSWD rule in
  `/etc/sudoers.d/nova-system-reboot` for `systemctl reboot` / `reboot`, which
  `install-nova-system.sh --install-sudoers` installs. Without that rule the
  reboot request records a `failed` result in `data/system/state.json` and the
  host stays up.
