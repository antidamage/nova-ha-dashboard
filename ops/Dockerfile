# Runtime image for the Nova dashboard container on the VM appliance (no GPU).
#
# The VAAPI image (ops/Dockerfile.vaapi) exists for the original nova host,
# where the dashboard itself ran the Outside-camera ffmpeg pipeline against the
# AMD iGPU. On the VM appliance the camera is captured and hardware-encoded by
# Nocturnium's standalone-compatible camera surface (VAAPI on that host), and
# the dashboard is a pure consumer via `videoHostUrl` — so this
# image carries NO VAAPI userspace and expects camera ingestion to be DISABLED
# in config (dashboard.camera.outside.ingestionEnabled=false).
#
# ffmpeg stays installed (CPU build) only for incidental short-run work such as
# DVR snapshot extraction — never for continuous encoding. A long-running
# libx264 process in this container is a regression (see ops/verify-vm.sh).
#
# Base is Debian trixie to stay byte-for-byte compatible with the bookworm
# staging builds produced by nova-release (Node major is identical).
#
#   docker build -t nova-ha-dashboard:plain -f ops/Dockerfile ops/
FROM node:20-trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
