"""Explicit online setup: download pinned public weights, never room data."""
import hashlib
import os
from pathlib import Path
import tempfile
import urllib.request

FILENAME = "nemotron-3.5-asr-streaming-0.6b.q8_0.gguf"
REVISION = "1c8deaecc64b91f034d73e08dd8b64625eb3395d"
SHA256 = "a5c435f294eea8f88ce68dd27b8c3bfea7f777cb2fbba04fcd30eaa555f429ae"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    target = Path(os.environ.get("NEMOTRON_MODEL_DIR", "/models")) / FILENAME
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if digest(target) != SHA256:
            raise ValueError("Existing model has unexpected checksum; not overwriting")
        print("Pinned Nemotron Q8 model already available.")
        return
    descriptor, name = tempfile.mkstemp(prefix="nemotron-", suffix=".download", dir=target.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as output, urllib.request.urlopen(
            f"https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/{REVISION}/{FILENAME}",
            timeout=60,
        ) as response:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        if digest(temporary) != SHA256:
            raise ValueError("Downloaded model checksum mismatch")
        temporary.chmod(0o644)  # Public weights must be readable by the unprivileged ASR service.
        temporary.rename(target)
    finally:
        temporary.unlink(missing_ok=True)
    print("Pinned public weights downloaded. Runtime is offline.")


if __name__ == "__main__":
    main()
