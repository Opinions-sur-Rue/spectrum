"""Download public model weights once. No room audio is involved."""
import os

# Runtime is offline. Only this explicit setup command may fetch model weights.
os.environ.pop("HF_HUB_OFFLINE", None)
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="Systran/faster-whisper-" + os.environ.get("WHISPER_MODEL", "small"),
    local_dir=os.environ.get("WHISPER_MODEL_PATH", "/models/whisper-small"),
    allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.*", "preprocessor_config.json"],
)
print("Model downloaded. Runtime recognition needs no internet.")
