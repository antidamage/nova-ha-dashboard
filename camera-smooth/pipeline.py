"""One run of the smooth pipeline: decode, generate frames, encode to HLS in RAM.

A process of its own, so that ending it is what returns the GPU memory. The service
starts and stops it. specs/camera-smooth-delivery.md.
"""

import argparse
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np
from rife_ncnn_vulkan_python import Rife

from core import FrameBudget

WIDTH, HEIGHT = 1280, 720
FRAME_BYTES = WIDTH * HEIGHT * 3
OUTPUT_FPS = 60
SEGMENT_SECONDS = 1
SEGMENTS_KEPT = 6
REPORT_EVERY_FRAMES = 1800


def decoder_command(source):
    # The downscale happens here, in the hardware decoder: the recording stays 1080p.
    return [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
        "-live_start_index", "-2",
        "-c:v", "h264_cuvid", "-resize", f"{WIDTH}x{HEIGHT}",
        "-i", source,
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]


def encoder_command(out_dir):
    return [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(OUTPUT_FPS), "-i", "-",
        "-c:v", "h264_nvenc", "-preset", "p4", "-tune", "ll", "-cq", "26", "-maxrate", "8M", "-bufsize", "8M",
        "-g", str(OUTPUT_FPS * SEGMENT_SECONDS), "-forced-idr", "1",
        "-f", "hls", "-hls_time", str(SEGMENT_SECONDS), "-hls_list_size", str(SEGMENTS_KEPT),
        "-hls_flags", "delete_segments+omit_endlist+independent_segments+temp_file",
        "-hls_segment_filename", str(out_dir / "seg_%06d.ts"),
        str(out_dir / "index.m3u8"),
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--model", required=True, help="Path to the RIFE model directory")
    args = parser.parse_args()

    decoder = subprocess.Popen(decoder_command(args.source), stdout=subprocess.PIPE, bufsize=FRAME_BYTES * 4)
    encoder = subprocess.Popen(encoder_command(args.out), stdin=subprocess.PIPE, bufsize=FRAME_BYTES * 4)
    incoming = queue.Queue(8)
    outgoing = queue.Queue(16)

    def read_frames():
        while True:
            data = decoder.stdout.read(FRAME_BYTES)
            if len(data) < FRAME_BYTES:
                incoming.put(None)
                return
            incoming.put(np.frombuffer(data, dtype=np.uint8).reshape(HEIGHT, WIDTH, 3))

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
    budget = FrameBudget()
    previous = incoming.get()
    generated = repeated = 0
    while previous is not None:
        current = incoming.get()
        if current is None:
            break
        started = time.perf_counter()
        if budget.should_generate():
            middle = np.asarray(rife.process_cv2(previous, current, timestep=0.5))
            generated += 1
        else:
            middle = previous
            repeated += 1
        outgoing.put(previous)
        outgoing.put(middle)
        budget.record(time.perf_counter() - started)
        previous = current
        if (generated + repeated) % REPORT_EVERY_FRAMES == 0:
            print(f"generated={generated} repeated={repeated} debt={budget.debt:.2f}s", flush=True)
    # The source ended, which a live source should not do. The service restarts this.
    print(f"source ended: generated={generated} repeated={repeated}", file=sys.stderr, flush=True)
    outgoing.put(None)
    writer.join(timeout=5)
    # Not sys.exit: the Vulkan teardown at interpreter exit segfaults.
    os._exit(1)


if __name__ == "__main__":
    main()
