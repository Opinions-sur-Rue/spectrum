"""Explicit local-file CPU benchmark; never captures or records room audio.

Uses the worker's existing recognition path. Timings exclude model loading and
one warmup, but include VAD and local HTTP for Nemotron. Not a live latency test.
"""
import argparse
import json
import os
from pathlib import Path
import re
import statistics
import time
import unicodedata
import wave

from faster_whisper import WhisperModel

from nemotron import NemotronRecognizer
from worker import Worker


def words(text):
    return re.findall(r"\w+(?:'\w+)*", unicodedata.normalize("NFC", text).casefold().replace("’", "'"))


def word_error_rate(reference, hypothesis):
    expected, actual = words(reference), words(hypothesis)
    if not expected:
        raise ValueError("Reference must contain words")
    previous = list(range(len(actual) + 1))
    for row, word in enumerate(expected, 1):
        current = [row]
        for column, other in enumerate(actual, 1):
            current.append(min(previous[column] + 1, current[-1] + 1, previous[column - 1] + (word != other)))
        previous = current
    return previous[-1] / len(expected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wav", type=Path)
    parser.add_argument("--engine", choices=("whisper", "nemotron"), required=True)
    parser.add_argument("--language", choices=("fr", "en", "auto"), default="fr")
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--draft", action="store_true", help="Whisper beam 1 instead of final beam 5")
    parser.add_argument("--reference", type=Path, help="Optional manually verified UTF-8 transcript")
    parser.add_argument("--show-text", action="store_true", help="Explicitly print recognized fixture text")
    args = parser.parse_args()
    if not 1 <= args.repetitions <= 20:
        parser.error("repetitions must be between 1 and 20")
    with wave.open(str(args.wav), "rb") as wav:
        if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth(), wav.getcomptype()) != (16000, 1, 2, "NONE"):
            parser.error("Use uncompressed 16 kHz mono PCM16 WAV")
        if not 0 < wav.getnframes() <= 60 * 16000:
            parser.error("Use a fixture between 0 and 60 seconds")
        pcm = wav.readframes(wav.getnframes())
    worker = object.__new__(Worker)  # No room subscriptions or backend token.
    loaded = time.perf_counter()
    if args.engine == "nemotron":
        worker.model = NemotronRecognizer()
        worker.model.ready()
    else:
        worker.model = WhisperModel(
            os.environ.get("WHISPER_MODEL_PATH", "/models/whisper-small"),
            device="cpu", compute_type="int8", cpu_threads=4,
            num_workers=1, local_files_only=True,
        )
    load_seconds = time.perf_counter() - loaded
    try:
        worker.recognize(pcm, args.language, not args.draft)
        durations = []
        for _ in range(args.repetitions):
            start = time.perf_counter()
            text, language = worker.recognize(pcm, args.language, not args.draft)
            durations.append(time.perf_counter() - start)
        median = statistics.median(durations)
        result = {
            "engine": args.engine, "cpu_threads": 4, "language": language,
            "audio_seconds": len(pcm) / 32000, "draft": args.draft,
            "client_load_seconds": load_seconds, "inference_seconds": durations,
            "median_seconds": median, "real_time_factor": median / (len(pcm) / 32000),
            "text_characters": len(text),
        }
        if args.reference:
            result["wer"] = word_error_rate(args.reference.read_text(encoding="utf-8"), text)
        if args.show_text:
            result["text"] = text
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        if isinstance(worker.model, NemotronRecognizer):
            worker.model.close()


if __name__ == "__main__":
    main()
