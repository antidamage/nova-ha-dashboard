# Nova face-auth service.
#
# Same base as camera-events so the two services share image layers on the GPU
# host rather than each carrying its own CUDA stack. That host is memory- and
# disk-constrained and has a documented hard-hang history, so both matter.
FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# build-essential is required, not decorative: insightface 0.7.3 compiles a
# Cython extension during install and fails without a compiler. ffmpeg, libgl1
# and libglib2.0-0 are OpenCV's runtime dependencies for decoding the submitted
# webm clips; curl fetches the anti-spoof weights below and is what the unit's
# readiness probe uses.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ffmpeg \
        libgl1 \
        libglib2.0-0 \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Anti-spoof weights, baked in by pinned URL and verified by hash.
#
# No first-run download on the host, no runtime network dependency, and no
# possibility of the service starting with a different model than the one the
# thresholds were calibrated against. `sha256sum -c` fails the build rather
# than the login: a service that cannot tell a photograph from a person must
# not serve, and this is the last point at which that can be enforced cheaply.
ARG ANTISPOOF_BASE=https://raw.githubusercontent.com/minivision-ai/Silent-Face-Anti-Spoofing/master/resources/anti_spoof_models
RUN mkdir -p /models/antispoof && cd /models/antispoof \
    && curl -fsSL -o 2.7_80x80_MiniFASNetV2.pth "${ANTISPOOF_BASE}/2.7_80x80_MiniFASNetV2.pth" \
    && curl -fsSL -o 4_0_0_80x80_MiniFASNetV1SE.pth "${ANTISPOOF_BASE}/4_0_0_80x80_MiniFASNetV1SE.pth" \
    && printf '%s  %s\n' \
        a5eb02e1843f19b5386b953cc4c9f011c3f985d0ee2bb9819eea9a142099bec0 2.7_80x80_MiniFASNetV2.pth \
        84ee1d37d96894d5e82de5a57df044ef80a58be2b218b5ed7cdfd875ec2f5990 4_0_0_80x80_MiniFASNetV1SE.pth \
        > SHA256SUMS \
    && sha256sum -c SHA256SUMS

# Detection and recognition weights, likewise baked in. buffalo_l carries
# RetinaFace det_10g and ArcFace w600k_r50; the download happens here so the
# first login is not waiting on GitHub.
# `root` matches FACE_MODEL_ROOT below: insightface resolves a pack to
# <root>/models/<pack>, so models.py and this download must agree on the root
# or the container fetches the pack again on its first request.
#
# `ensure_available`, NOT `FaceAnalysis(...)`. Constructing FaceAnalysis builds
# onnxruntime InferenceSessions, and onnxruntime-gpu segfaulted doing that here
# (exit 139, killing the build) because `docker build` has no GPU: buildkit
# never gets --gpus, so the CUDA provider initialises against a device that is
# not there. Nothing about this step needs a session anyway — the only job is
# to have the weights on disk before the first request. Sessions are built at
# runtime by models.py, where the CUDA-then-CPU provider fallback lives and
# where a missing GPU is an expected, handled state rather than a crash.
RUN python -c "from insightface.utils.storage import ensure_available; ensure_available('models', 'buffalo_l', root='/models')"

COPY models.py /app/
COPY core /app/core
COPY service /app/service
COPY antispoof /app/antispoof
COPY authenticator /app/authenticator
COPY test_core.py test_authenticator.py /app/

ENV NOVA_FACE_AUTH_DATA=/data \
    FACE_MODEL_ROOT=/models \
    FACE_ANTISPOOF_DIR=/models/antispoof

# 8098 is camera-events; 8095-8097 are free.
EXPOSE 8099

# No HEALTHCHECK here: /healthz requires X-Nova-Face-Key, and baking a key into
# an image or an inspectable healthcheck command is exactly what the key
# handling rules forbid. The unit's readiness probe reads the key from the
# host's own env file instead.
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8099"]
