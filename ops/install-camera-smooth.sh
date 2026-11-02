#!/usr/bin/env bash
# Installs the camera smooth delivery service from a checkout of this repo, on the
# host with the GPU. Run as root from the repo root. specs/camera-smooth-delivery.md.
set -euo pipefail

ROOT=/opt/nova-camera-smooth
MODELS_RELEASE=https://github.com/TNTwise/rife-ncnn-vulkan/releases/download/20250112/ubuntu.zip
MODELS=(rife-v4.26 rife-v4.25)

install -d "$ROOT/app" "$ROOT/models"
install -m 0644 camera-smooth/core.py camera-smooth/pipeline.py camera-smooth/service.py "$ROOT/app/"

if [ ! -x "$ROOT/venv/bin/python" ]; then
  python3 -m venv "$ROOT/venv"
fi
"$ROOT/venv/bin/pip" install --quiet -r camera-smooth/requirements.txt

missing=0
for model in "${MODELS[@]}"; do
  [ -f "$ROOT/models/$model/flownet.bin" ] || missing=1
done
if [ "$missing" = 1 ]; then
  work=$(mktemp -d /var/tmp/camera-smooth-models.XXXXXX)
  trap 'rm -rf "$work"' EXIT
  curl -fsSL -o "$work/models.zip" "$MODELS_RELEASE"
  for model in "${MODELS[@]}"; do
    "$ROOT/venv/bin/python" - "$work/models.zip" "$model" "$ROOT/models" <<'PY'
import sys, zipfile
from pathlib import Path
archive, model, dest = sys.argv[1], sys.argv[2], Path(sys.argv[3])
with zipfile.ZipFile(archive) as z:
    for name in z.namelist():
        parts = Path(name).parts
        if model in parts and not name.endswith("/") and parts[parts.index(model) + 1:]:
            target = dest / model / parts[-1]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(name))
PY
  done
fi

install -m 0644 ops/nova-camera-smooth.service /etc/systemd/system/nova-camera-smooth.service
systemctl daemon-reload
systemctl enable nova-camera-smooth.service
systemctl restart nova-camera-smooth.service
systemctl --no-pager --lines=0 status nova-camera-smooth.service
