"""One run of the smooth pipeline: decode, generate frames, encode to HLS in RAM or an MP4.

A process of its own, so that ending it is what returns the GPU memory. The service
starts and stops it. specs/camera-smooth-delivery.md.
"""

import argparse
import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np
from rife_ncnn_vulkan_python import Rife

from core import OUTPUT_FPS, RATE_PROFILES, FrameBudget, source_frame_seconds

SEGMENT_SECONDS = 1
REPORT_EVERY_FRAMES = 1800


def decoder_command(source, input_options, width, height):
    # The downscale happens here, in the hardware decoder: the recording stays 1080p.
    return [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
        *input_options,
        "-c:v", "h264_cuvid", "-resize", f"{width}x{height}",
        "-i", source,
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]


def encoder_input(width, height):
    return ["-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", str(OUTPUT_FPS), "-i", "-"]


def encoder_video():
    # Named explicitly, because given RGB frames NVENC otherwise picks H.264 4:4:4 RGB,
    # which browsers and hardware decoders show with the wrong colours.
    return [
        "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=nv12",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
        "-c:v", "h264_nvenc", "-profile:v", "high", "-preset", "p4", "-tune", "ll",
        "-cq", "26", "-maxrate", "8M", "-bufsize", "8M",
        "-g", str(OUTPUT_FPS * SEGMENT_SECONDS), "-forced-idr", "1",
    ]


def hls_encoder_command(out_dir, width, height, segments_kept):
    return [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        *encoder_input(width, height),
        *encoder_video(),
        "-f", "hls", "-hls_time", str(SEGMENT_SECONDS), "-hls_list_size", str(segments_kept),
        "-hls_flags", "delete_segments+omit_endlist+independent_segments+temp_file",
        "-hls_segment_filename", str(out_dir / "seg_%06d.ts"),
        str(out_dir / "index.m3u8"),
    ]


def mp4_encoder_command(width, height):
    # Fragmented, because it is written to a pipe and read as it is made.
    return [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        *encoder_input(width, height),
        *encoder_video(),
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4", "pipe:1",
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--input-options", default="[]", help="JSON list of ffmpeg input options")
    parser.add_argument("--out", type=Path, help="HLS directory. Without one, an MP4 goes to stdout")
    parser.add_argument("--model", required=True, help="Path to the RIFE model directory")
    parser.add_argument("--rate", default="1", choices=sorted(RATE_PROFILES))
    parser.add_argument("--segments-kept", type=int, default=6)
    args = parser.parse_args()

    profile = RATE_PROFILES[args.rate]
    width, height = profile.width, profile.height
    frame_bytes = width * height * 3
    rendering = args.out is None

    decoder = subprocess.Popen(
        decoder_command(args.source, json.loads(args.input_options), width, height),
        stdout=subprocess.PIPE, bufsize=frame_bytes * 4,
    )
    encoder = subprocess.Popen(
        mp4_encoder_command(width, height) if rendering else hls_encoder_command(args.out, width, height, args.segments_kept),
        stdin=subprocess.PIPE, bufsize=frame_bytes * 4,
    )
    incoming = queue.Queue(8)
    outgoing = queue.Queue(16)

    def read_frames():
        while True:
            data = decoder.stdout.read(frame_bytes)
            if len(data) < frame_bytes:
                incoming.put(None)
                return
            incoming.put(np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3))

    def write_frames():
        while True:
            frame = outgoing.get()
            if frame is None:
                encoder.stdin.close()
                return
            encoder.stdin.write(frame.tobytes())

    threading.Thread(target=read_frames, daemon=True).start()
    writer = threading.Thread(target=write_frames, daemon=True)
    writer.start()

    rife = Rife(gpuid=0, model=args.model, num_threads=2)
    budget = FrameBudget(source_frame_seconds(args.rate))
    between = profile.frames_per_source
    previous = incoming.get()
    generated = repeated = 0
    while previous is not None:
        current = incoming.get()
        if current is None:
            break
        started = time.perf_counter()
        outgoing.put(previous)
        # A download is not in real time, so it never trades frames for time.
        generate = rendering or budget.should_generate()
        for step in range(1, between):
            if generate:
                outgoing.put(np.asarray(rife.process_cv2(previous, current, timestep=step / between)))
                generated += 1
            else:
                outgoing.put(previous)
                repeated += 1
        budget.record(time.perf_counter() - started)
        previous = current
        if (generated + repeated) % REPORT_EVERY_FRAMES == 0:
            print(f"generated={generated} repeated={repeated} debt={budget.debt:.2f}s", file=sys.stderr, flush=True)
    print(f"source ended: generated={generated} repeated={repeated}", file=sys.stderr, flush=True)
    if previous is not None:
        outgoing.put(previous)
    outgoing.put(None)
    writer.join(timeout=30 if rendering else 5)
    if rendering:
        encoder.wait(timeout=30)
    # Not sys.exit: the Vulkan teardown at interpreter exit segfaults.
    os._exit(0)


if __name__ == "__main__":
    main()
