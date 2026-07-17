#!/bin/bash
# run-nova-vm.sh — run nova-vm headless under launchd (system domain, root).
#
# Replicates the exact qemu invocation UTM 4.7.5 used for this VM (captured
# from ps on 2026-07-15), minus SPICE/USB/audio/display cruft, so the guest
# sees identical hardware: q35 + Skylake-Client + e1000 with the same MAC
# (1A:67:86:56:03:57 -> DHCP keeps 192.168.8.14).
#
# SIGTERM (launchctl bootout / host shutdown) => ACPI powerdown via QMP so the
# guest shuts down cleanly; hard-kill only after ~90s of no cooperation.
set -u

VMDIR="/Users/Shared/nova-vm"
QEMU="/usr/local/bin/qemu-system-x86_64"
QMP_SOCK="$VMDIR/qmp.sock"
LOG="$VMDIR/log/wrapper.log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

qmp_powerdown() {
  # QMP requires the capabilities handshake before accepting commands.
  printf '{"execute":"qmp_capabilities"}\n{"execute":"system_powerdown"}\n' \
    | /usr/bin/nc -U "$QMP_SOCK" >/dev/null 2>&1
}

QPID=""
on_term() {
  log "SIGTERM: requesting guest ACPI powerdown"
  for attempt in 1 2 3 4 5 6; do
    qmp_powerdown
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      kill -0 "$QPID" 2>/dev/null || { log "guest powered down cleanly"; exit 0; }
      sleep 1
    done
    log "guest still running after powerdown attempt $attempt"
  done
  log "guest did not power down in ~90s; killing qemu"
  kill -9 "$QPID" 2>/dev/null
  exit 1
}
trap on_term TERM INT

mkdir -p "$VMDIR/log"
rm -f "$QMP_SOCK" "$VMDIR/console.sock" "$VMDIR/qga.sock" "$VMDIR/qemu.pid"

"$QEMU" \
  -name novavm \
  -uuid 4E8C9679-ADBE-4A4B-9EAE-4B46CA2CFF59 \
  -machine q35,vmport=off,i8042=off,hpet=off \
  -accel hvf \
  -cpu Skylake-Client \
  -smp cpus=4,sockets=1,cores=4,threads=1 \
  -m 6144 \
  -nodefaults -vga none -display none \
  -global PIIX4_PM.disable_s3=1 -global ICH9-LPC.disable_s3=1 \
  -drive "if=pflash,format=raw,unit=0,file.filename=$VMDIR/firmware/edk2-x86_64-code.fd,file.locking=off,readonly=on" \
  -drive "if=pflash,unit=1,file.filename=$VMDIR/efi_vars.fd" \
  -device e1000,mac=1A:67:86:56:03:57,netdev=net0 \
  -netdev vmnet-bridged,id=net0,ifname=en0 \
  -device ide-hd,bus=ide.0,drive=maindisk,bootindex=0 \
  -drive "if=none,media=disk,id=maindisk,file.filename=$VMDIR/disk.qcow2,discard=unmap,detect-zeroes=unmap" \
  -device ide-cd,bus=ide.1,drive=seedcd,bootindex=1 \
  -drive "if=none,media=cdrom,id=seedcd,file.filename=$VMDIR/seed.iso,file.locking=off,readonly=on" \
  -device virtio-rng-pci \
  -device virtio-serial \
  -chardev "socket,path=$VMDIR/qga.sock,server=on,wait=off,id=qga0" \
  -device virtserialport,chardev=qga0,name=org.qemu.guest_agent.0 \
  -serial "unix:$VMDIR/console.sock,server=on,wait=off" \
  -qmp "unix:$QMP_SOCK,server=on,wait=off" \
  -pidfile "$VMDIR/qemu.pid" \
  &
QPID=$!
log "qemu started pid=$QPID"
wait "$QPID"
RC=$?
log "qemu exited rc=$RC"
exit $RC
