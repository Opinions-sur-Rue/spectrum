"""Local CPU/Vulkan chunk-load experiment, not a native-streaming capacity claim.

Replays a public WAV in RAM as synchronized, continuously active speakers.
Reproduces worker queue admission (24 slots, stale drafts superseded, drafts
skipped under backlog). No LiveKit, VAD inference, backend, recording or cloud.
Only aggregate metrics are printed; recognized fixture text is discarded.
"""
import argparse
from collections import Counter, deque
from contextlib import contextmanager
from dataclasses import dataclass
import io
import json
import math
from pathlib import Path
import socket
import subprocess
import threading
import time
import urllib.request
import wave

from segmenter import FRAME_BYTES, Segmenter


@dataclass
class Job:
    speaker: int
    utterance: int
    due: float
    final: bool
    wav: bytes


class JobBuffer:
    def __init__(self, limit=24):
        self.limit = limit
        self.pending = deque()
        self.condition = threading.Condition()
        self.closed = False
        self.counts = Counter()

    def submit(self, job):
        with self.condition:
            self.counts["arrivals_final" if job.final else "arrivals_draft"] += 1
            retained = deque(item for item in self.pending if not (
                item.speaker == job.speaker and item.utterance == job.utterance and not item.final
            ))
            self.counts["superseded_drafts"] += len(self.pending) - len(retained)
            self.pending = retained
            if not job.final and len(self.pending) >= 2:
                self.counts["skipped_drafts"] += 1
                return
            if job.final and len(self.pending) >= self.limit:
                retained = deque(item for item in self.pending if item.final)
                self.counts["evicted_drafts"] += len(self.pending) - len(retained)
                self.pending = retained
            if len(self.pending) >= self.limit:
                self.counts["dropped_finals" if job.final else "dropped_drafts"] += 1
                return
            self.pending.append(job)
            self.counts["peak_queue"] = max(self.counts["peak_queue"], len(self.pending))
            self.condition.notify()

    def take(self):
        with self.condition:
            self.condition.wait_for(lambda: self.pending or self.closed)
            return self.pending.popleft() if self.pending else None

    def close(self):
        with self.condition:
            self.closed = True
            self.condition.notify_all()


def pcm_wav(pcm):
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(pcm)
    return output.getvalue()


def fixture_chunks(pcm):
    # Conservative all-active fixture: every source frame is voiced, followed
    # by 800 ms of silence. Actual recordings/VAD produce different traffic.
    voiced_frames = math.ceil(len(pcm) / FRAME_BYTES)

    class FixtureVAD:
        position = 0

        def is_speech(self, frame, rate):
            self.position += 1
            return self.position <= voiced_frames

    segmenter = Segmenter(FixtureVAD(), 0)
    frames = pcm.ljust(voiced_frames * FRAME_BYTES, b"\0") + bytes(FRAME_BYTES * 40)
    result = []
    for offset in range(0, len(frames), FRAME_BYTES):
        for chunk in segmenter.feed(frames[offset:offset + FRAME_BYTES]):
            result.append((chunk.end / 1000, chunk.final, pcm_wav(chunk.pcm)))
    return result, len(frames) / 32000


def transcribe(url, wav, language):
    boundary = "spectrum-load-fixture"
    fields = {"language": language, "response_format": "json"}
    body = b"".join(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
        for key, value in fields.items()
    )
    body += f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
    body += wav + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(url + "/v1/audio/transcriptions", data=body, headers={
        "Content-Type": "multipart/form-data; boundary=" + boundary,
    })
    # Ignore environment proxies; both endpoints are explicitly loopback.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=30) as response:
        raw = response.read(65537)
    result = json.loads(raw) if len(raw) <= 65536 else {}
    if not isinstance(result.get("text"), str) or not result["text"].strip():
        raise ValueError("Invalid local ASR response")


def distribution(values):
    if not values:
        return None
    ordered = sorted(values)
    return {key: round(ordered[min(len(ordered) - 1, math.ceil(len(ordered) * quantile) - 1)] * 1000, 1)
            for key, quantile in (("p50_ms", .5), ("p95_ms", .95), ("max_ms", 1))}


def run_load(url, chunks, cycle, streams, seconds, inflight, language):
    buffer = JobBuffer()
    results = []
    lock = threading.Lock()

    def consume():
        while (job := buffer.take()) is not None:
            started = time.monotonic()
            success = True
            try:
                transcribe(url, job.wav, language)
            except Exception:
                success = False
            finished = time.monotonic()
            with lock:
                results.append((job.final, success, started - job.due, finished - job.due, finished - started))

    workers = [threading.Thread(target=consume, daemon=True) for _ in range(inflight)]
    for worker in workers:
        worker.start()
    origin = time.monotonic()
    try:
        for utterance in range(math.ceil(seconds / cycle)):
            for release, final, wav in chunks:
                when = utterance * cycle + release
                if when >= seconds:
                    break
                time.sleep(max(0, origin + when - time.monotonic()))
                for speaker in range(streams):
                    buffer.submit(Job(speaker, utterance, origin + when, final, wav))
        time.sleep(max(0, origin + seconds - time.monotonic()))
    finally:
        buffer.close()
    deadline = time.monotonic() + 60
    for worker in workers:
        worker.join(max(0, deadline - time.monotonic()))
    if any(worker.is_alive() for worker in workers):
        raise TimeoutError("Load did not drain in 60 seconds")
    elapsed = time.monotonic() - origin
    good = [result for result in results if result[1]]
    finals = [result for result in good if result[0]]
    return {
        "streams": streams, "offered_seconds": seconds, "max_inflight": inflight,
        "wall_seconds_including_drain": round(elapsed, 3),
        "drain_seconds": round(max(0, elapsed - seconds), 3),
        "queue": dict(buffer.counts), "completed_finals": len(finals),
        "completed_drafts": sum(not result[0] for result in good),
        "request_errors": len(results) - len(good),
        "final_queue_wait": distribution([result[2] for result in finals]),
        "final_completion_after_release": distribution([result[3] for result in finals]),
        "request_service_time": distribution([result[4] for result in good]),
    }


@contextmanager
def local_server(runtime, model, device, inflight, batching="auto"):
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    command = [str(runtime), "--quiet", "serve", "--asr-model", str(model),
               "--device", device, "--asr.backend.threads", "4",
               "--threads", str(max(2, inflight + 1)), "--host", "127.0.0.1",
               "--port", str(port), "--no-ui", "--max-upload-mb", "4"]
    if batching != "auto":
        command += ["--asr.batching.enabled=" + ("true" if batching == "enabled" else "false")]
    process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        deadline = time.monotonic() + 90
        while True:
            if process.poll() is not None:
                raise RuntimeError(f"Local {device} runtime exited ({process.returncode})")
            try:
                with opener.open(url + "/ready", timeout=1) as response:
                    state = json.load(response)
                if state.get("ready"):
                    expected = "cpu" if device == "cpu" else "vulkan"
                    if not str(state.get("device", "")).startswith(expected):
                        raise RuntimeError("Requested backend not active; refusing fallback")
                    break
            except (OSError, ValueError):
                pass
            if time.monotonic() > deadline:
                raise TimeoutError("Local ASR startup timed out")
            time.sleep(.2)
        yield url, state
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wav", type=Path)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--device", choices=("cpu", "vulkan:0"), required=True)
    parser.add_argument("--streams", default="6,12,18")
    parser.add_argument("--seconds", type=float, default=20)
    parser.add_argument("--inflight", type=int, default=1)
    parser.add_argument("--batching", choices=("auto", "enabled", "disabled"), default="auto")
    parser.add_argument("--language", choices=("fr-FR", "en-US"), default="fr-FR")
    args = parser.parse_args()
    streams = [int(value) for value in args.streams.split(",")]
    if not streams or any(not 1 <= count <= 18 for count in streams) or not 5 <= args.seconds <= 60 or not 1 <= args.inflight <= 18:
        parser.error("Use 1–18 streams/inflight and 5–60 seconds per scenario")
    with wave.open(str(args.wav), "rb") as wav:
        if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth(), wav.getcomptype()) != (16000, 1, 2, "NONE") or not 1 <= wav.getnframes() <= 16000 * 12:
            parser.error("Use a 16 kHz mono PCM16 public fixture, at most 12 seconds")
        pcm = wav.readframes(wav.getnframes())
    chunks, cycle = fixture_chunks(pcm)
    with local_server(args.runtime.resolve(), args.model.resolve(), args.device, args.inflight, args.batching) as (url, state):
        transcribe(url, pcm_wav(pcm), args.language)  # Untimed warmup.
        print(json.dumps({"device_requested": args.device, "readiness": state, "batching": args.batching,
                          "fixture_seconds": len(pcm) / 32000, "cycle_seconds": cycle,
                          "note": "Chunked load only; no VAD inference, LiveKit or native streaming",
                          "runs": [run_load(url, chunks, cycle, count, args.seconds, args.inflight, args.language)
                                   for count in streams]}, indent=2), flush=True)


if __name__ == "__main__":
    main()
