# Nova HA Dashboard

Nova HA Dashboard is a local Home Assistant control surface for a smart-home setup. It is a Next.js app served on the local network, designed for desktop, wall-mounted and touch-screen use in both portrait and landscape orientations.

This project may or may not be be set up to be configurable in the future, but for now the code is the configuration and you can fork and modify it to suit your own smart-home setup.

## What It Does

- Reads rooms, devices, entity state, brightness, and colour information from Home Assistant.
- Provides zone-level controls for lights, switches, climate, fans, and related entities.
- Shows a cyber-styled portrait/landscape dashboard for daily use.
- Includes live colour selection, brightness control, router status, and a digital clock.
- Excludes special-case devices, such as the outside light, from broad inside/everything actions.
- Polls and refreshes local state so multiple open dashboard clients stay reasonably current.

## Local Development

Install dependencies:

```powershell
npm install
```

Run the development server:

```powershell
npm run dev
```

Build for production:

```powershell
npm run build
```

Start a production server:

```powershell
npm run start
```

## Environment

The app expects Home Assistant connection settings from environment variables:

- `HA_URL`: Home Assistant base URL, defaulting to `http://127.0.0.1:8123`.
- `HA_TOKEN`: a Home Assistant long-lived access token.
- `GREE_AIRCON_HOST`: optional direct LAN IP for the Gree air conditioner, defaulting to the current Nova LAN address. This is used only for fixed louver positioning that Home Assistant does not expose.

Production secrets live on Nova, not in this repository.

The dashboard also stores small global runtime preferences, such as the last aircon settings chosen from Nova, under `data/`. These files are ignored by Git.

## Deployment Notes

The live deployment runs on Nova under `/opt/nova-ha-dashboard` and is managed by `nova-ha-dashboard.service`. Typical changes are built locally first, copied to Nova, rebuilt there, and then the service is restarted.

Generated files, build output, browser artifacts, local environment files, and dependencies are ignored by Git.
