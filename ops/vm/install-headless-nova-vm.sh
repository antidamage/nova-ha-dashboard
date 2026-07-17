#!/bin/bash
# install-headless-nova-vm.sh — one-shot cutover of nova-vm from
# "UTM app inside adeline's login session" to "root LaunchDaemon at boot".
#
# Run on indium:  sudo bash /Users/Shared/nova-vm/install-headless-nova-vm.sh
#
# Idempotent: safe to re-run. Aborts (changing nothing) if the UTM-managed VM
# cannot be stopped cleanly. Expected dashboard downtime: one guest reboot.
set -euo pipefail

VMDIR=/Users/Shared/nova-vm
BUNDLE=/Users/adeline/Library/Containers/com.utmapp.UTM/Data/Documents/nova-vm.utm
UTMCTL=/Applications/UTM.app/Contents/MacOS/utmctl
DAEMON=/Library/LaunchDaemons/nz.co.skull.nova-vm.plist
LABEL=nz.co.skull.nova-vm
HEALTH=http://192.168.8.14/api/healthz

step() { echo; echo "==> $*"; }

[ "$(id -u)" = "0" ] || { echo "ERROR: run with sudo"; exit 1; }

step "Sanity: staged files present"
for f in "$VMDIR/run-nova-vm.sh" "$VMDIR/nz.co.skull.nova-vm.daemon.plist" \
         "$VMDIR/firmware/edk2-x86_64-code.fd" "$VMDIR/seed.iso"; do
  [ -f "$f" ] || { echo "ERROR: missing staged file $f"; exit 1; }
done

# ---- 1. Take ownership of the disk ----------------------------------------
if [ -f "$VMDIR/disk.qcow2" ]; then
  step "VM storage already relocated to $VMDIR (skipping stop/move)"
else
  step "Stopping UTM-managed nova-vm (guest ACPI shutdown, up to 120s)"
  sudo -u adeline "$UTMCTL" stop nova-vm || true
  for _ in $(seq 1 60); do
    pgrep -x QEMULauncher >/dev/null 2>&1 || break
    sleep 2
  done
  if pgrep -x QEMULauncher >/dev/null 2>&1; then
    echo "ERROR: UTM qemu still running after 120s — aborting, nothing changed."
    echo "Stop it manually (utmctl stop nova-vm) and re-run."
    exit 1
  fi
  echo "UTM VM is down."

  step "Relocating VM storage to $VMDIR"
  [ -f "$BUNDLE/Data/disk.qcow2" ]  || { echo "ERROR: $BUNDLE/Data/disk.qcow2 not found"; exit 1; }
  [ -f "$BUNDLE/Data/efi_vars.fd" ] || { echo "ERROR: $BUNDLE/Data/efi_vars.fd not found"; exit 1; }
  mv "$BUNDLE/Data/disk.qcow2"  "$VMDIR/disk.qcow2"
  mv "$BUNDLE/Data/efi_vars.fd" "$VMDIR/efi_vars.fd"
  mv "$BUNDLE" "$BUNDLE.retired-2026-07-15"
  echo "Moved disk.qcow2 + efi_vars.fd; UTM bundle retired (cannot double-start)."
fi

# ---- 2. Install daemon ------------------------------------------------------
step "Installing wrapper + LaunchDaemon"
mkdir -p "$VMDIR/log"
chmod 755 "$VMDIR/run-nova-vm.sh"
cp "$VMDIR/nz.co.skull.nova-vm.daemon.plist" "$DAEMON"
chown root:wheel "$DAEMON"
chmod 644 "$DAEMON"

# ---- 3. Remove the login-scoped agents (the root cause) --------------------
step "Removing login-scoped LaunchAgents (nova-vm, caffeinate, keep-awake)"
U=$(id -u adeline)
for lbl in nz.co.skull.nova-vm nz.co.skull.caffeinate nz.co.skull.keep-awake; do
  launchctl bootout "gui/$U/$lbl" 2>/dev/null || true
  rm -f "/Users/adeline/Library/LaunchAgents/$lbl.plist"
done
echo "Agents removed (sleep prevention moves to pmset below)."

# ---- 4. System-level no-sleep (works at the login window) -------------------
step "Disabling system sleep via pmset (login-independent)"
pmset -a sleep 0 disksleep 0 standby 0 autopoweroff 0 powernap 0
pmset -a womp 1 autorestart 1 ttyskeepawake 1
echo "sleep/standby/autopoweroff/powernap off; wake-on-lan + auto-restart on."

# ---- 5. Start ---------------------------------------------------------------
step "Starting $LABEL (system domain)"
launchctl bootout "system/$LABEL" 2>/dev/null || true
sleep 2
launchctl bootstrap system "$DAEMON"
launchctl enable "system/$LABEL"

step "Waiting for dashboard at $HEALTH (up to 300s)"
ok=""
for _ in $(seq 1 150); do
  if curl -s -m 3 "$HEALTH" 2>/dev/null | grep -q '"ok":true'; then ok=1; break; fi
  sleep 2
done

echo
if [ -n "$ok" ]; then
  echo "SUCCESS: nova-vm now runs as a boot-time system daemon and the dashboard is serving."
  echo "Next: verify the no-login guarantee with:  sudo reboot"
  echo "(do NOT log in afterwards — the dashboard must come back by itself)"
else
  echo "WARNING: daemon is loaded but dashboard did not answer within 300s."
  echo "Inspect:  tail -50 $VMDIR/log/qemu.err.log $VMDIR/log/wrapper.log"
  echo "Console:  nc -U $VMDIR/console.sock"
  exit 1
fi
